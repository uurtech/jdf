import type { JdfDocument, Element, Page, Style, StyleRef, HeaderFooter } from "@jdf/core";
import { getPageDimensions, unitToPx, DEFAULT_MARGINS } from "@jdf/core";
import { renderElement } from "./renderers/element";
import { resolveStyle } from "./utils/style";
import { resolveTemplate } from "./utils/template";

export interface JDFViewerOptions {
  /** Initial zoom level. 1 = 100%. Default: 1 */
  zoom?: number;
  /** Show the page sidebar. Default: false (most embeds want a clean look) */
  sidebar?: boolean;
  /** Show the toolbar (zoom, page nav, search). Default: true */
  toolbar?: boolean;
  /** Use dark mode. Default: follows `prefers-color-scheme` */
  darkMode?: "auto" | "light" | "dark";
  /** Initial page index (0-based). Default: 0 */
  initialPage?: number;
  /** Container width. Number = pixels. String = any CSS length ("100%", "60ch", "640px"). */
  width?: number | string;
  /** Container height. Number = pixels. String = any CSS length ("80vh", "600px"). Default: "600px". */
  height?: number | string;
  /** Page-fit strategy:
   *   "manual" — exact zoom from `zoom` option (default)
   *   "fit-width" — auto-zoom each page to fill container width
   *   "fit-page"  — auto-zoom so a whole page is visible
   */
  fit?: "manual" | "fit-width" | "fit-page";
  /** Called when the user navigates to a different page */
  onPageChange?: (pageIndex: number) => void;
  /** Called once the document finishes rendering */
  onLoad?: (doc: JdfDocument) => void;
  /** Called on any rendering error */
  onError?: (err: Error) => void;
  /**
   * Called when a form field's value changes. Useful for live previews,
   * dirty-state tracking, or auto-saving filled forms to a backend instead
   * of triggering a manual download.
   */
  onFormChange?: (doc: JdfDocument, change: { path: (string | number)[]; field: string; value: unknown }) => void;
  /**
   * Called when the user clicks an element. `id` is the element's `id`
   * (`data-jdf-id` in the DOM; the PDF importer writes `p<page>-e<n>`),
   * `path` its location in the document, `pageIndex` 0-based.
   */
  onElementClick?: (info: ElementClickInfo) => void;
}

export interface ElementClickInfo {
  id?: string;
  type: string;
  pageIndex: number;
  path: (string | number)[];
  element: Element;
  node: HTMLElement;
  event: MouseEvent;
}

/**
 * What `viewer.highlight()` accepts: an element id, or a box on a page in
 * document units (mm, relative to the page's content area — the same
 * coordinates the elements' `position`/`width`/`height` use). `page` is 0-based.
 */
export type HighlightTarget = string | { page: number; x: number; y: number; width: number; height: number; color?: string };
export interface HighlightOptions {
  /** Outline/background colour (any CSS colour). Default: amber. */
  color?: string;
  /** Remove previous highlights first. Default: true. */
  clear?: boolean;
  /** Scroll the first target into view. Default: true. */
  scroll?: boolean;
}

export interface JDFViewerInstance {
  /** The container element */
  container: HTMLElement;
  /** The current document — reflects user form input as the user types. */
  document: JdfDocument;
  /** Get / set zoom (1 = 100%) */
  setZoom: (zoom: number) => void;
  getZoom: () => number;
  /** Navigate to a page (0-based) */
  goToPage: (pageIndex: number) => void;
  getCurrentPage: () => number;
  /** Replace the document */
  setDocument: (doc: JdfDocument) => void;
  /**
   * Jump to a moment in a video element and start playing — the retrieval-side
   * counterpart of `jdf chunk`'s `media: { element, t0 }`. `elementId` is the
   * video element's `id`; `seconds` the offset. Scrolls the page into view.
   * Returns false when no such video exists.
   */
  seek: (elementId: string, seconds: number) => boolean;
  /**
   * Highlight elements (by `id`) or arbitrary boxes (mm on a page) — the
   * retrieval-side counterpart of `jdf chunk` / review annotations. Returns the
   * number of targets that were found. Previous highlights are cleared unless
   * `{ clear: false }`; the first target is scrolled into view unless
   * `{ scroll: false }`.
   */
  highlight: (target: HighlightTarget | HighlightTarget[], options?: HighlightOptions) => number;
  /** Remove every highlight added by `highlight()`. */
  clearHighlights: () => void;
  /** Scroll an element (by `id`) into view; `{ highlight: true }` also highlights it. Returns false when the id is unknown. */
  scrollToElement: (elementId: string, options?: { highlight?: boolean; block?: ScrollLogicalPosition }) => boolean;
  /** The DOM node rendered for an element id, or null. */
  getElementNode: (elementId: string) => HTMLElement | null;
  /** Subscribe to element clicks (in addition to the `onElementClick` option). Returns an unsubscribe function. */
  onElementClick: (listener: (info: ElementClickInfo) => void) => () => void;
  /** Tear down — removes DOM and event listeners */
  destroy: () => void;
  /**
   * Return the current document as a Blob — ready to attach to a form-data
   * upload, save through `URL.createObjectURL`, or hand to a Worker. The
   * blob reflects user form input (whatever the user has typed / ticked /
   * selected). Pass `{ pretty: false }` for a compact JSON.
   */
  exportJdf: (options?: { pretty?: boolean }) => Blob;
  /** Return the current document as a JSON string (form-filled state). */
  toJSON: (options?: { pretty?: boolean }) => string;
  /**
   * Trigger a browser download of the current document. The host page's
   * "Save" button can call this directly: `viewer.downloadJdf("form.jdf")`.
   * Default filename is `<title>.jdf` from `meta.title`.
   */
  downloadJdf: (filename?: string) => void;
  /** Read the value of a single form field by `name`. */
  getFormValue: (name: string) => unknown;
  /** Read every form field's value as a flat `{ [name]: value }` map. */
  getFormValues: () => Record<string, unknown>;
}

/**
 * Embed a JDF document into a container by URL.
 * The simplest "PDF.js-like" usage.
 */
// Per-container AbortController so a rapid `src` change cancels the previous
// fetch and the slower (older) response can't overwrite the newer document.
const FETCH_ABORTS = new WeakMap<HTMLElement, AbortController>();

export async function embed(
  container: HTMLElement | string,
  url: string,
  options: JDFViewerOptions = {}
): Promise<JDFViewerInstance> {
  const el = resolveContainer(container);

  // Abort any in-flight fetch for this element.
  const previous = FETCH_ABORTS.get(el);
  if (previous) previous.abort();
  const controller = new AbortController();
  FETCH_ABORTS.set(el, controller);

  el.classList.add("jdfjs-loading");
  try {
    // Detect .jdfx by extension first; if the URL has no extension hint
    // (signed URLs, ?download=...), fall back to Content-Type sniffing
    // after the response arrives.
    const extLooksJdfx = /\.jdfx(\?|#|$)/i.test(url);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: extLooksJdfx
        ? { Accept: "application/jdf+zip,application/zip" }
        : { Accept: "application/json,application/jdf+json,application/jdf+zip,application/zip" },
    });
    if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);

    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    const ctypeLooksJdfx = ctype.includes("zip") || ctype.includes("jdf+zip");

    let doc: JdfDocument;
    if (extLooksJdfx || ctypeLooksJdfx) {
      const { unpackJdfxToDocument } = await import("./jdfx");
      doc = await unpackJdfxToDocument(await res.arrayBuffer());
    } else {
      doc = (await res.json()) as JdfDocument;
    }
    if (!doc?.$jdf) throw new Error("Not a valid JDF document (missing $jdf field)");

    // Race guard: if another embed() started for this container while we were
    // parsing, a different controller is now stored — bail without rendering.
    if (FETCH_ABORTS.get(el) !== controller) {
      throw new DOMException("Superseded by a newer src change", "AbortError");
    }

    el.classList.remove("jdfjs-loading");
    return render(el, doc, options);
  } catch (err) {
    el.classList.remove("jdfjs-loading");
    if ((err as Error).name === "AbortError") throw err; // silent abort
    el.classList.add("jdfjs-error");
    el.innerHTML = `<div class="jdfjs-error-msg">${escapeHtml((err as Error).message)}</div>`;
    options.onError?.(err as Error);
    throw err;
  }
}

/**
 * Render a JDF document directly into a container. No fetch.
 */
export function render(
  container: HTMLElement | string,
  document: JdfDocument,
  options: JDFViewerOptions = {}
): JDFViewerInstance {
  const el = resolveContainer(container);
  return new JDFViewer(el, document, options).getInstance();
}

/**
 * Class form for advanced consumers (event subscriptions, custom toolbar wiring, etc).
 */
export class JDFViewer {
  private container: HTMLElement;
  private doc: JdfDocument;
  private options: Required<Pick<JDFViewerOptions, "zoom" | "sidebar" | "toolbar" | "darkMode" | "initialPage" | "fit">> & JDFViewerOptions;
  private zoom: number;
  private currentPage: number;
  private resizeObs: ResizeObserver | null = null;
  private pagesEl!: HTMLDivElement;
  private toolbarEl: HTMLDivElement | null = null;
  private sidebarEl: HTMLDivElement | null = null;
  private root!: HTMLDivElement;
  private observer: IntersectionObserver | null = null;
  private clickListeners = new Set<(info: ElementClickInfo) => void>();
  private highlightBoxes: HTMLElement[] = [];
  // System dark-mode subscription — needs explicit cleanup so a SPA route
  // change that destroys the viewer doesn't leave a listener attached to
  // the matchMedia query.
  private darkModeMql: MediaQueryList | null = null;
  private darkModeListener: ((e: MediaQueryListEvent) => void) | null = null;
  // Window resize fallback for fit-width / fit-page when the host element's
  // own size doesn't change but the viewport's does (flex re-layout, etc).
  private windowResizeListener: (() => void) | null = null;
  // Zoom the host asked for (option or toolbar). In "manual" fit mode the
  // effective zoom is capped so a page never renders wider than its
  // container — a 794 px A4 page inside a 390 px phone viewport used to be
  // cut in half with a sideways scroll. Once the user zooms by hand we stop
  // capping and let them scroll.
  private requestedZoom = 1;
  private userZoomed = false;

  constructor(container: HTMLElement, doc: JdfDocument, options: JDFViewerOptions = {}) {
    this.container = container;
    this.doc = doc;
    this.options = {
      zoom: options.zoom ?? 1,
      sidebar: options.sidebar ?? false,
      toolbar: options.toolbar ?? true,
      darkMode: options.darkMode ?? "auto",
      initialPage: options.initialPage ?? 0,
      fit: options.fit ?? "manual",
      ...options,
    };
    this.zoom = this.options.zoom;
    this.requestedZoom = this.options.zoom;
    this.currentPage = this.options.initialPage;
    this.applyContainerSize();
    this.mount();
    queueMicrotask(() => this.options.onLoad?.(this.doc));
  }

  private applyContainerSize() {
    const w = this.options.width;
    const h = this.options.height;
    if (w != null) {
      this.container.style.width = typeof w === "number" ? `${w}px` : w;
    }
    if (h != null) {
      this.container.style.height = typeof h === "number" ? `${h}px` : h;
    }
  }

  private mount() {
    ensureMetricFonts(this.doc);
    this.container.innerHTML = "";
    this.container.classList.add("jdfjs");
    this.applyDarkMode();

    this.root = document.createElement("div");
    this.root.className = "jdfjs-root";

    if (this.options.toolbar) {
      this.toolbarEl = this.buildToolbar();
      this.root.appendChild(this.toolbarEl);
    }

    const body = document.createElement("div");
    body.className = "jdfjs-body";

    if (this.options.sidebar) {
      this.sidebarEl = this.buildSidebar();
      body.appendChild(this.sidebarEl);
    }

    this.pagesEl = document.createElement("div");
    this.pagesEl.className = "jdfjs-pages";
    this.pagesEl.addEventListener("click", (ev) => this.handleElementClick(ev));
    body.appendChild(this.pagesEl);

    this.root.appendChild(body);
    this.container.appendChild(this.root);
    this.renderAllPages();
    this.setupScrollObserver();
    this.setupResizeObserver();
    this.applyFit();
    if (this.currentPage > 0) this.scrollToPage(this.currentPage);
  }

  private setupResizeObserver() {
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObs?.disconnect();
      this.resizeObs = new ResizeObserver(() => this.applyFit());
      this.resizeObs.observe(this.pagesEl);
      // Also observe the host container — flex re-layouts can change the
      // host width without changing pagesEl's computed size synchronously.
      this.resizeObs.observe(this.container);
    }
    // Window resize as a fallback for environments where the ResizeObserver
    // doesn't fire (older Safari + nested flex). Subscribe once and remove
    // on destroy.
    if (this.windowResizeListener == null && typeof window !== "undefined") {
      this.windowResizeListener = () => this.applyFit();
      window.addEventListener("resize", this.windowResizeListener);
    }
  }

  /**
   * Apply the current `darkMode` option to the container. For `auto`, also
   * subscribe to system colour-scheme changes so the embed flips when the
   * user toggles their OS theme. Replaces a one-shot read at mount that
   * froze the embed on its boot-time value.
   */
  private applyDarkMode() {
    // Tear down any previous subscription first — used during setDocument
    // and option changes.
    if (this.darkModeMql && this.darkModeListener) {
      this.darkModeMql.removeEventListener("change", this.darkModeListener);
      this.darkModeMql = null;
      this.darkModeListener = null;
    }

    const setDark = (on: boolean) => {
      this.container.classList.toggle("jdfjs-dark", on);
    };

    const mode = this.options.darkMode;
    if (mode === "dark") { setDark(true); return; }
    if (mode === "light") { setDark(false); return; }
    // mode === "auto"
    if (typeof window === "undefined" || !window.matchMedia) {
      setDark(false);
      return;
    }
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mql.matches);
    const listener = (e: MediaQueryListEvent) => setDark(e.matches);
    mql.addEventListener("change", listener);
    this.darkModeMql = mql;
    this.darkModeListener = listener;
  }

  /** Auto-zoom for fit modes (and the responsive cap in manual mode). */
  private applyFit() {
    const firstPage = this.pagesEl.querySelector<HTMLElement>(".jdfjs-page");
    if (!firstPage) return;
    // Read intrinsic page size from the inline width/min-height in px (set in renderPage)
    const pageWidth = parseFloat(firstPage.style.width || "0");
    const pageHeight = parseFloat(firstPage.style.minHeight || "0");
    if (!pageWidth || !pageHeight) return;
    const containerWidth = this.pagesEl.clientWidth - 32; // margin
    const containerHeight = this.pagesEl.clientHeight - 32;
    if (this.options.fit === "manual") {
      if (containerWidth <= 0) return;
      const maxFit = containerWidth / pageWidth;
      const next = this.userZoomed ? this.zoom : Math.min(this.requestedZoom, maxFit);
      if (Math.abs(next - this.zoom) > 0.001 || firstPage.style.transformOrigin !== "top left") {
        this.zoom = Math.max(0.25, Math.min(3, next));
        this.applyZoom();
        this.updateIndicators();
      }
      return;
    }
    if (this.options.fit === "fit-width") {
      this.zoom = Math.max(0.25, Math.min(3, containerWidth / pageWidth));
    } else if (this.options.fit === "fit-page") {
      this.zoom = Math.max(0.25, Math.min(3, Math.min(containerWidth / pageWidth, containerHeight / pageHeight)));
    }
    this.applyZoom();
    this.updateIndicators();
  }

  private buildToolbar(): HTMLDivElement {
    const tb = document.createElement("div");
    tb.className = "jdfjs-toolbar";
    tb.innerHTML = `
      <span class="jdfjs-title"></span>
      <div class="jdfjs-spacer"></div>
      <button class="jdfjs-btn" data-act="prev" title="Previous page">‹</button>
      <span class="jdfjs-page-indicator"></span>
      <button class="jdfjs-btn" data-act="next" title="Next page">›</button>
      <span class="jdfjs-divider"></span>
      <button class="jdfjs-btn" data-act="zoom-out" title="Zoom out">−</button>
      <span class="jdfjs-zoom-indicator"></span>
      <button class="jdfjs-btn" data-act="zoom-in" title="Zoom in">+</button>
    `;
    tb.querySelector(".jdfjs-title")!.textContent = this.doc.meta?.title ?? "Document";
    this.updateIndicators(tb);

    tb.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest("[data-act]");
      if (!target) return;
      const act = target.getAttribute("data-act");
      if (act === "prev") this.goToPage(this.currentPage - 1);
      else if (act === "next") this.goToPage(this.currentPage + 1);
      else if (act === "zoom-in") this.setZoom(this.zoom + 0.1);
      else if (act === "zoom-out") this.setZoom(this.zoom - 0.1);
    });
    return tb;
  }

  private buildSidebar(): HTMLDivElement {
    const sb = document.createElement("div");
    sb.className = "jdfjs-sidebar";
    this.doc.pages.forEach((_, idx) => {
      const btn = document.createElement("button");
      btn.className = "jdfjs-sidebar-thumb";
      btn.setAttribute("data-page", String(idx));
      btn.innerHTML = `<span class="jdfjs-sidebar-num">${idx + 1}</span>`;
      btn.addEventListener("click", () => this.goToPage(idx));
      sb.appendChild(btn);
    });
    return sb;
  }

  private updateIndicators(tb: HTMLElement = this.toolbarEl!) {
    if (!tb) return;
    const pageInd = tb.querySelector(".jdfjs-page-indicator");
    if (pageInd) pageInd.textContent = `${this.currentPage + 1} / ${this.doc.pages.length}`;
    const zoomInd = tb.querySelector(".jdfjs-zoom-indicator");
    if (zoomInd) zoomInd.textContent = `${Math.round(this.zoom * 100)}%`;
    if (this.sidebarEl) {
      this.sidebarEl.querySelectorAll(".jdfjs-sidebar-thumb").forEach((el) => {
        const idx = Number(el.getAttribute("data-page"));
        el.classList.toggle("jdfjs-sidebar-thumb-active", idx === this.currentPage);
      });
    }
  }

  private renderAllPages() {
    this.pagesEl.innerHTML = "";
    const styles = this.doc.styles ?? {};
    this.doc.pages.forEach((page, idx) => {
      const pageEl = this.renderPage(page, idx, styles);
      this.pagesEl.appendChild(pageEl);
    });
    this.applyZoom();
  }

  /** Seek a video element (by its `id`) to `seconds` and play; scrolls it into view. */
  seek(elementId: string, seconds: number): boolean {
    const video = this.pagesEl.querySelector<HTMLVideoElement>(`video[data-jdf-video="${elementId.replace(/"/g, '\\"')}"]`);
    if (!video) return false;
    const pageWrap = video.closest<HTMLElement>(".jdfjs-page-wrapper");
    const idx = pageWrap ? Number(pageWrap.getAttribute("data-page-index")) : NaN;
    if (!Number.isNaN(idx)) this.goToPage(idx);
    video.scrollIntoView({ block: "center" });
    const go = () => { video.currentTime = Math.max(0, seconds); video.play().catch(() => { /* autoplay policy — user can press play */ }); };
    if (video.readyState >= 1) go(); else video.addEventListener("loadedmetadata", go, { once: true });
    return true;
  }

  /** Wrapper node of the element with this id (both renderers write `data-jdf-id`). */
  getElementNode(elementId: string): HTMLElement | null {
    if (!this.pagesEl) return null;
    return this.pagesEl.querySelector<HTMLElement>(`[data-jdf-id="${String(elementId).replace(/["\\]/g, "\\$&")}"]`);
  }

  private pageIndexOf(node: HTMLElement): number {
    const wrap = node.closest<HTMLElement>(".jdfjs-page-wrapper");
    const idx = wrap ? Number(wrap.getAttribute("data-page-index")) : NaN;
    return Number.isNaN(idx) ? -1 : idx;
  }

  scrollToElement(elementId: string, options: { highlight?: boolean; block?: ScrollLogicalPosition } = {}): boolean {
    const node = this.getElementNode(elementId);
    if (!node) return false;
    const idx = this.pageIndexOf(node);
    if (idx >= 0 && idx !== this.currentPage) { this.currentPage = idx; this.options.onPageChange?.(idx); }
    node.scrollIntoView({ block: options.block ?? "center", inline: "nearest" });
    if (options.highlight) this.highlight(elementId, { scroll: false });
    return true;
  }

  highlight(target: HighlightTarget | HighlightTarget[], options: HighlightOptions = {}): number {
    if (options.clear !== false) this.clearHighlights();
    const targets = Array.isArray(target) ? target : [target];
    let found = 0;
    let first: HTMLElement | null = null;
    for (const t of targets) {
      if (typeof t === "string") {
        const node = this.getElementNode(t);
        if (!node) continue;
        node.classList.add("jdfjs-highlight");
        if (options.color) node.style.setProperty("--jdfjs-highlight-color", options.color);
        first = first ?? node; found++;
      } else {
        const pageWrap = this.pagesEl.querySelector<HTMLElement>(`.jdfjs-page-wrapper[data-page-index="${t.page}"] .jdfjs-page-content`);
        if (!pageWrap) continue;
        const box = document.createElement("div");
        box.className = "jdfjs-highlight-box";
        box.style.left = `${unitToPx(t.x)}px`;
        box.style.top = `${unitToPx(t.y)}px`;
        box.style.width = `${unitToPx(Math.max(0.5, t.width))}px`;
        box.style.height = `${unitToPx(Math.max(0.5, t.height))}px`;
        const color = t.color ?? options.color;
        if (color) box.style.setProperty("--jdfjs-highlight-color", color);
        pageWrap.appendChild(box);
        this.highlightBoxes.push(box);
        first = first ?? box; found++;
      }
    }
    if (first && options.scroll !== false) {
      const idx = this.pageIndexOf(first);
      if (idx >= 0 && idx !== this.currentPage) { this.currentPage = idx; this.options.onPageChange?.(idx); }
      first.scrollIntoView({ block: "center", inline: "nearest" });
    }
    return found;
  }

  clearHighlights() {
    if (!this.pagesEl) return;
    for (const n of Array.from(this.pagesEl.querySelectorAll<HTMLElement>(".jdfjs-highlight"))) {
      n.classList.remove("jdfjs-highlight");
      n.style.removeProperty("--jdfjs-highlight-color");
    }
    for (const b of this.highlightBoxes) b.remove();
    this.highlightBoxes = [];
  }

  onElementClick(listener: (info: ElementClickInfo) => void): () => void {
    this.clickListeners.add(listener);
    return () => { this.clickListeners.delete(listener); };
  }

  private handleElementClick(ev: MouseEvent) {
    if (!this.options.onElementClick && !this.clickListeners.size) return;
    const start = ev.target instanceof HTMLElement ? ev.target : null;
    const node = start?.closest<HTMLElement>("[data-jdf-type]");
    if (!node || !this.pagesEl.contains(node)) return;
    const pageIndex = this.pageIndexOf(node);
    if (pageIndex < 0) return;
    // Locate the element in the document: by id when it has one, otherwise by
    // its index among the page's top-level elements.
    const id = node.dataset.jdfId;
    const page = this.doc.pages[pageIndex];
    let path: (string | number)[] | null = null;
    let element: Element | undefined;
    const walk = (els: Element[], base: (string | number)[]) => {
      els.forEach((e, i) => {
        if (path) return;
        if (id != null && (e as any).id === id) { path = [...base, i]; element = e; return; }
        if ((e as any).elements) walk((e as any).elements, [...base, i, "elements"]);
      });
    };
    if (id != null) walk(page?.elements ?? [], ["pages", pageIndex, "elements"]);
    if (!path && node.parentElement?.classList.contains("jdfjs-page-content")) {
      const i = Array.prototype.indexOf.call(node.parentElement.children, node);
      const el = page?.elements?.[i];
      if (el) { path = ["pages", pageIndex, "elements", i]; element = el; }
    }
    if (!path || !element) return;
    const info: ElementClickInfo = { id, type: node.dataset.jdfType ?? (element as any).type, pageIndex, path, element, node, event: ev };
    this.options.onElementClick?.(info);
    for (const l of this.clickListeners) l(info);
  }

  private renderPage(page: Page, pageIndex: number, styles: Record<string, Style>): HTMLDivElement {
    const dim = getPageDimensions(
      page.pageSize ?? this.doc.meta?.pageSize ?? "A4",
      page.pageOrientation ?? this.doc.meta?.pageOrientation ?? "portrait"
    );
    const margins = { ...DEFAULT_MARGINS, ...(this.doc.meta?.margins || {}), ...(page.margins || {}) };

    const wrapper = document.createElement("div");
    wrapper.className = "jdfjs-page-wrapper";
    wrapper.setAttribute("data-page-index", String(pageIndex));

    const pageEl = document.createElement("div");
    pageEl.className = "jdfjs-page";
    pageEl.style.width = `${unitToPx(dim.width)}px`;
    pageEl.style.minHeight = `${unitToPx(dim.height)}px`;
    if (page.background) pageEl.style.backgroundColor = page.background;

    const header = page.header ?? this.doc.header;
    const footer = page.footer ?? this.doc.footer;
    const headerH = header?.height ?? 0;
    const footerH = footer?.height ?? 0;

    if (header) {
      const headerPath: (string | number)[] = page.header ? ["pages", pageIndex, "header"] : ["header"];
      const h = this.renderHeaderFooter(header, pageIndex, this.doc.pages.length, styles, headerPath);
      h.classList.add("jdfjs-header");
      h.style.paddingTop = `${unitToPx(margins.top! / 2)}px`;
      h.style.paddingLeft = `${unitToPx(margins.left!)}px`;
      h.style.paddingRight = `${unitToPx(margins.right!)}px`;
      pageEl.appendChild(h);
    }

    // Inner content box at margin offsets. We use absolute positioning + `inset`
    // (top/right/bottom/left) instead of padding because element children render
    // with `position: absolute` — and absolute children resolve `left/top` from
    // the *border edge* of their containing block, not the padding edge, so
    // padding on a `position: relative` parent is silently ignored by them.
    const content = document.createElement("div");
    content.className = "jdfjs-page-content";
    content.style.position = "absolute";
    content.style.top = `${unitToPx((margins.top || 0) + headerH)}px`;
    content.style.right = `${unitToPx(margins.right || 0)}px`;
    content.style.bottom = `${unitToPx((margins.bottom || 0) + footerH)}px`;
    content.style.left = `${unitToPx(margins.left || 0)}px`;

    page.elements.forEach((el, elIdx) => {
      const node = renderElement(el, {
        styles,
        resources: this.doc.resources,
        document: this.doc,
        path: ["pages", pageIndex, "elements", elIdx],
        onNavigatePage: (idx) => this.goToPage(idx),
        onFormChange: (path, field, value) => this.handleFormChange(path, field, value),
      });
      if (node) content.appendChild(node);
    });
    pageEl.appendChild(content);

    if (footer) {
      const footerPath: (string | number)[] = page.footer ? ["pages", pageIndex, "footer"] : ["footer"];
      const f = this.renderHeaderFooter(footer, pageIndex, this.doc.pages.length, styles, footerPath);
      f.classList.add("jdfjs-footer");
      f.style.paddingBottom = `${unitToPx(margins.bottom! / 2)}px`;
      f.style.paddingLeft = `${unitToPx(margins.left!)}px`;
      f.style.paddingRight = `${unitToPx(margins.right!)}px`;
      pageEl.appendChild(f);
    }

    wrapper.appendChild(pageEl);
    return wrapper;
  }

  private renderHeaderFooter(hf: HeaderFooter, pageIndex: number, totalPages: number, styles: Record<string, Style>, basePath: (string | number)[]): HTMLDivElement {
    const div = document.createElement("div");
    if (hf.elements?.length) {
      hf.elements.forEach((el, idx) => {
        const node = renderElement(el, {
          styles,
          resources: this.doc.resources,
          document: this.doc,
          // Real doc path so form-field mutations land on the right node and
          // survive exportJdf (was a synthetic ["__hf__", …] that
          // handleFormChange could not resolve).
          path: [...basePath, "elements", idx],
          onNavigatePage: (i) => this.goToPage(i),
          onFormChange: (path, field, value) => this.handleFormChange(path, field, value),
        });
        if (node) div.appendChild(node);
      });
    } else if (hf.content) {
      const text = resolveTemplate(hf.content, { pageNumber: pageIndex + 1, totalPages, title: this.doc.meta?.title ?? "", author: this.doc.meta?.author ?? "" });
      const span = document.createElement("div");
      span.textContent = text;
      Object.assign(span.style, resolveStyle(hf.style as StyleRef | undefined, styles));
      div.appendChild(span);
    }
    return div;
  }

  private setupScrollObserver() {
    if (typeof IntersectionObserver === "undefined") return;
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) {
          const idx = Number((visible[0].target as HTMLElement).getAttribute("data-page-index"));
          if (!isNaN(idx) && idx !== this.currentPage) {
            this.currentPage = idx;
            this.updateIndicators();
            this.options.onPageChange?.(idx);
          }
        }
      },
      { root: this.pagesEl, threshold: [0.25, 0.5, 0.75] }
    );
    this.pagesEl.querySelectorAll("[data-page-index]").forEach((el) => this.observer!.observe(el));
  }

  private scrollToPage(idx: number) {
    const el = this.pagesEl.querySelector(`[data-page-index="${idx}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  private applyZoom() {
    this.pagesEl.style.setProperty("--jdfjs-zoom", String(this.zoom));
    this.pagesEl.querySelectorAll<HTMLElement>(".jdfjs-page-wrapper").forEach((wrapper) => {
      const el = wrapper.querySelector<HTMLElement>(".jdfjs-page");
      if (!el) return;
      // `transform: scale()` does not take part in layout, so the wrapper
      // used to keep the page's unscaled 794 px footprint: on narrow hosts
      // the pages column scrolled sideways and the page sat off-centre.
      // Size the wrapper to the *rendered* box and scale from its corner.
      const w = parseFloat(el.style.width || "0") || el.offsetWidth;
      const h = el.offsetHeight;
      el.style.transform = `scale(${this.zoom})`;
      el.style.transformOrigin = "top left";
      wrapper.style.width = `${Math.round(w * this.zoom)}px`;
      wrapper.style.height = `${Math.round(h * this.zoom)}px`;
    });
  }

  setZoom(z: number) {
    this.zoom = Math.max(0.25, Math.min(3, z));
    this.requestedZoom = this.zoom;
    this.userZoomed = true;
    this.applyZoom();
    this.updateIndicators();
  }
  getZoom() { return this.zoom; }

  goToPage(idx: number) {
    const clamped = Math.max(0, Math.min(this.doc.pages.length - 1, idx));
    this.currentPage = clamped;
    this.scrollToPage(clamped);
    this.updateIndicators();
    this.options.onPageChange?.(clamped);
  }
  getCurrentPage() { return this.currentPage; }

  setDocument(doc: JdfDocument) {
    this.doc = doc;
    this.currentPage = 0;
    if (this.toolbarEl) {
      const t = this.toolbarEl.querySelector(".jdfjs-title");
      if (t) t.textContent = doc.meta?.title ?? "Document";
    }
    if (this.sidebarEl) {
      this.sidebarEl.innerHTML = "";
      const newSidebar = this.buildSidebar();
      newSidebar.querySelectorAll(".jdfjs-sidebar-thumb").forEach((c) => this.sidebarEl!.appendChild(c));
    }
    this.renderAllPages();
    this.setupScrollObserver();
    this.options.onLoad?.(doc);
  }

  /**
   * Apply a form-field value mutation to the in-memory document. Called by
   * every form renderer on every keystroke / toggle / selection — the
   * document carries the user's current state so `exportJdf()` returns a
   * filled JDF that's identical in shape to the source, just with values.
   *
   * No re-render: the DOM input already shows what the user typed, and a
   * full re-render mid-typing would lose focus. The mutation only matters
   * at export time.
   */
  private handleFormChange(path: (string | number)[], field: string, value: unknown) {
    const target = path.reduce<any>((acc, key) => (acc == null ? acc : acc[key]), this.doc as any);
    if (target == null) return;
    target[field] = value;
    this.options.onFormChange?.(this.doc, { path, field, value });
  }

  /**
   * Walk every page's elements — recursing into container elements
   * (collapsible / table cells / list items) and the doc + per-page
   * header/footer trees — and yield each form element with its resolved
   * name. Previously this only scanned top-level `page.elements`, so a
   * field nested inside a collapsible section or placed in a header was
   * silently dropped from getFormValues / downloadJdf.
   */
  private *iterFormFields(): Generator<{ name: string; field: any }> {
    const seen = new Set<any>();
    const walk = function* (node: any): Generator<{ name: string; field: any }> {
      if (!node || typeof node !== "object" || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const item of node) yield* walk(item);
        return;
      }
      const t = node.type;
      if (t === "input" || t === "textarea" || t === "checkbox" || t === "select" || t === "signature") {
        if (typeof node.name === "string" && node.name.length > 0) yield { name: node.name, field: node };
      }
      // Recurse into any nested element carriers.
      if (Array.isArray(node.elements)) yield* walk(node.elements);
      if (Array.isArray(node.items)) yield* walk(node.items);
      if (Array.isArray(node.rows)) {
        for (const row of node.rows) if (Array.isArray(row)) yield* walk(row);
      }
    };
    for (const page of this.doc.pages || []) {
      yield* walk(page.elements);
      yield* walk(page.header?.elements);
      yield* walk(page.footer?.elements);
    }
    yield* walk(this.doc.header?.elements);
    yield* walk(this.doc.footer?.elements);
  }

  toJSON(options: { pretty?: boolean } = {}): string {
    return options.pretty === false
      ? JSON.stringify(this.doc)
      : JSON.stringify(this.doc, null, 2);
  }

  exportJdf(options: { pretty?: boolean } = {}): Blob {
    return new Blob([this.toJSON(options)], { type: "application/jdf+json" });
  }

  downloadJdf(filename?: string): void {
    const name = filename
      || (this.doc.meta?.title ? `${this.doc.meta.title.replace(/[^\w\s.-]+/g, "_")}.jdf` : "document.jdf");
    const blob = this.exportJdf();
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = name;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    // Revoke after the click handler returns the file to the browser.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  getFormValue(name: string): unknown {
    for (const f of this.iterFormFields()) {
      if (f.name !== name) continue;
      if (f.field.type === "checkbox") return f.field.checked === true;
      if (f.field.type === "select" && f.field.multiple) return f.field.values || [];
      return f.field.value ?? "";
    }
    return undefined;
  }

  getFormValues(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of this.iterFormFields()) {
      if (f.field.type === "checkbox") out[f.name] = f.field.checked === true;
      else if (f.field.type === "select" && f.field.multiple) out[f.name] = f.field.values || [];
      else out[f.name] = f.field.value ?? "";
    }
    return out;
  }

  destroy() {
    this.observer?.disconnect();
    this.resizeObs?.disconnect();
    if (this.darkModeMql && this.darkModeListener) {
      this.darkModeMql.removeEventListener("change", this.darkModeListener);
      this.darkModeMql = null;
      this.darkModeListener = null;
    }
    if (this.windowResizeListener && typeof window !== "undefined") {
      window.removeEventListener("resize", this.windowResizeListener);
      this.windowResizeListener = null;
    }
    // Drop any in-flight fetch tied to this container so a late response
    // doesn't try to render into a destroyed DOM.
    const ctrl = FETCH_ABORTS.get(this.container);
    if (ctrl) { ctrl.abort(); FETCH_ABORTS.delete(this.container); }
    this.container.innerHTML = "";
    this.container.classList.remove("jdfjs", "jdfjs-dark", "jdfjs-loading", "jdfjs-error");
    this.container.style.removeProperty("width");
    this.container.style.removeProperty("height");
  }

  getInstance(): JDFViewerInstance {
    const self = this;
    // `document` is a getter so callers always see the up-to-date document
    // (including form values typed after the instance was returned), not a
    // snapshot from when getInstance() ran. The previous version used
    // `document: this.doc` which froze the reference at instance time.
    const inst = {
      container: this.container,
      get document() { return self.doc; },
      setZoom: (z: number) => this.setZoom(z),
      getZoom: () => this.getZoom(),
      goToPage: (i: number) => this.goToPage(i),
      seek: (elementId: string, seconds: number) => this.seek(elementId, seconds),
      highlight: (t: HighlightTarget | HighlightTarget[], o?: HighlightOptions) => this.highlight(t, o),
      clearHighlights: () => this.clearHighlights(),
      scrollToElement: (id: string, o?: { highlight?: boolean; block?: ScrollLogicalPosition }) => this.scrollToElement(id, o),
      getElementNode: (id: string) => this.getElementNode(id),
      onElementClick: (l: (info: ElementClickInfo) => void) => this.onElementClick(l),
      getCurrentPage: () => this.getCurrentPage(),
      setDocument: (d: JdfDocument) => this.setDocument(d),
      destroy: () => this.destroy(),
      exportJdf: (opts?: { pretty?: boolean }) => this.exportJdf(opts),
      toJSON: (opts?: { pretty?: boolean }) => this.toJSON(opts),
      downloadJdf: (n?: string) => this.downloadJdf(n),
      getFormValue: (n: string) => this.getFormValue(n),
      getFormValues: () => this.getFormValues(),
    };
    return inst as JDFViewerInstance;
  }
}

function resolveContainer(c: HTMLElement | string): HTMLElement {
  if (typeof c === "string") {
    const found = document.querySelector(c);
    if (!found) throw new Error(`jdfjs: container "${c}" not found`);
    return found as HTMLElement;
  }
  return c;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));
}

/**
 * The PDF importer maps fonts to metric-compatible open families (Carlito =
 * Calibri, Arimo = Arial, Tinos = Times New Roman, Cousine = Courier New,
 * Gelasio = Georgia, Caladea = Cambria) so converted lines keep their width.
 * Load them from Google Fonts once, only when a document uses them; offline
 * embeds fall through to the stack's next family.
 */
const METRIC_FAMILIES = ["Carlito", "Arimo", "Tinos", "Cousine", "Gelasio", "Caladea", "IBM Plex Sans", "IBM Plex Serif"];
function ensureMetricFonts(doc: JdfDocument) {
  if (typeof document === "undefined" || document.getElementById("jdfjs-metric-fonts")) return;
  let json: string;
  try { json = JSON.stringify(doc.styles ?? {}) + JSON.stringify(doc.pages ?? []); } catch { return; }
  const used = METRIC_FAMILIES.filter((f) => json.includes(f));
  if (!used.length) return;
  const link = document.createElement("link");
  link.id = "jdfjs-metric-fonts";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?" + used.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:ital,wght@0,400;0,700;1,400;1,700`).join("&") + "&display=swap";
  document.head.appendChild(link);
}
