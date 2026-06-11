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
  /** Called when the user navigates to a different page */
  onPageChange?: (pageIndex: number) => void;
  /** Called once the document finishes rendering */
  onLoad?: (doc: JdfDocument) => void;
  /** Called on any rendering error */
  onError?: (err: Error) => void;
}

export interface JDFViewerInstance {
  /** The container element */
  container: HTMLElement;
  /** The current document */
  document: JdfDocument;
  /** Get / set zoom (1 = 100%) */
  setZoom: (zoom: number) => void;
  getZoom: () => number;
  /** Navigate to a page (0-based) */
  goToPage: (pageIndex: number) => void;
  getCurrentPage: () => number;
  /** Replace the document */
  setDocument: (doc: JdfDocument) => void;
  /** Tear down — removes DOM and event listeners */
  destroy: () => void;
}

/**
 * Embed a JDF document into a container by URL.
 * The simplest "PDF.js-like" usage.
 */
export async function embed(
  container: HTMLElement | string,
  url: string,
  options: JDFViewerOptions = {}
): Promise<JDFViewerInstance> {
  const el = resolveContainer(container);
  el.classList.add("jdfjs-loading");
  try {
    const res = await fetch(url, { headers: { Accept: "application/json,application/jdf+json" } });
    if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
    const doc = (await res.json()) as JdfDocument;
    if (!doc?.$jdf) throw new Error("Not a valid JDF document (missing $jdf field)");
    el.classList.remove("jdfjs-loading");
    return render(el, doc, options);
  } catch (err) {
    el.classList.remove("jdfjs-loading");
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
  private options: Required<Pick<JDFViewerOptions, "zoom" | "sidebar" | "toolbar" | "darkMode" | "initialPage">> & JDFViewerOptions;
  private zoom: number;
  private currentPage: number;
  private pagesEl!: HTMLDivElement;
  private toolbarEl: HTMLDivElement | null = null;
  private sidebarEl: HTMLDivElement | null = null;
  private root!: HTMLDivElement;
  private observer: IntersectionObserver | null = null;

  constructor(container: HTMLElement, doc: JdfDocument, options: JDFViewerOptions = {}) {
    this.container = container;
    this.doc = doc;
    this.options = {
      zoom: options.zoom ?? 1,
      sidebar: options.sidebar ?? false,
      toolbar: options.toolbar ?? true,
      darkMode: options.darkMode ?? "auto",
      initialPage: options.initialPage ?? 0,
      ...options,
    };
    this.zoom = this.options.zoom;
    this.currentPage = this.options.initialPage;
    this.mount();
    queueMicrotask(() => this.options.onLoad?.(this.doc));
  }

  private mount() {
    this.container.innerHTML = "";
    this.container.classList.add("jdfjs");
    if (this.options.darkMode === "dark") this.container.classList.add("jdfjs-dark");
    else if (this.options.darkMode === "auto") {
      if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
        this.container.classList.add("jdfjs-dark");
      }
    }

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
    body.appendChild(this.pagesEl);

    this.root.appendChild(body);
    this.container.appendChild(this.root);
    this.renderAllPages();
    this.setupScrollObserver();
    if (this.currentPage > 0) this.scrollToPage(this.currentPage);
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
      const h = this.renderHeaderFooter(header, pageIndex, this.doc.pages.length, styles);
      h.classList.add("jdfjs-header");
      h.style.paddingTop = `${unitToPx(margins.top! / 2)}px`;
      h.style.paddingLeft = `${unitToPx(margins.left!)}px`;
      h.style.paddingRight = `${unitToPx(margins.right!)}px`;
      pageEl.appendChild(h);
    }

    const content = document.createElement("div");
    content.className = "jdfjs-page-content";
    content.style.position = "relative";
    content.style.paddingTop = `${unitToPx((margins.top || 0) + headerH)}px`;
    content.style.paddingRight = `${unitToPx(margins.right || 0)}px`;
    content.style.paddingBottom = `${unitToPx((margins.bottom || 0) + footerH)}px`;
    content.style.paddingLeft = `${unitToPx(margins.left || 0)}px`;

    page.elements.forEach((el, elIdx) => {
      const node = renderElement(el, {
        styles,
        resources: this.doc.resources,
        document: this.doc,
        path: ["pages", pageIndex, "elements", elIdx],
        onNavigatePage: (idx) => this.goToPage(idx),
      });
      if (node) content.appendChild(node);
    });
    pageEl.appendChild(content);

    if (footer) {
      const f = this.renderHeaderFooter(footer, pageIndex, this.doc.pages.length, styles);
      f.classList.add("jdfjs-footer");
      f.style.paddingBottom = `${unitToPx(margins.bottom! / 2)}px`;
      f.style.paddingLeft = `${unitToPx(margins.left!)}px`;
      f.style.paddingRight = `${unitToPx(margins.right!)}px`;
      pageEl.appendChild(f);
    }

    wrapper.appendChild(pageEl);
    return wrapper;
  }

  private renderHeaderFooter(hf: HeaderFooter, pageIndex: number, totalPages: number, styles: Record<string, Style>): HTMLDivElement {
    const div = document.createElement("div");
    if (hf.elements?.length) {
      hf.elements.forEach((el, idx) => {
        const node = renderElement(el, {
          styles,
          resources: this.doc.resources,
          document: this.doc,
          path: ["__hf__", pageIndex, idx],
          onNavigatePage: (i) => this.goToPage(i),
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
    this.pagesEl.querySelectorAll<HTMLElement>(".jdfjs-page").forEach((el) => {
      el.style.transform = `scale(${this.zoom})`;
      el.style.transformOrigin = "top center";
    });
  }

  setZoom(z: number) {
    this.zoom = Math.max(0.25, Math.min(3, z));
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

  destroy() {
    this.observer?.disconnect();
    this.container.innerHTML = "";
    this.container.classList.remove("jdfjs", "jdfjs-dark", "jdfjs-loading", "jdfjs-error");
  }

  getInstance(): JDFViewerInstance {
    return {
      container: this.container,
      document: this.doc,
      setZoom: (z) => this.setZoom(z),
      getZoom: () => this.getZoom(),
      goToPage: (i) => this.goToPage(i),
      getCurrentPage: () => this.getCurrentPage(),
      setDocument: (d) => this.setDocument(d),
      destroy: () => this.destroy(),
    };
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
