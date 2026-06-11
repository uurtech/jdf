/**
 * Auto-initialization: scan the document on load for embed targets and render them.
 *
 * Three target forms are supported, all detected automatically:
 *
 *   1. Custom element (recommended):
 *      <jdf-viewer src="https://example.com/whitepaper.jdf"></jdf-viewer>
 *
 *   2. <jdf> tag (most concise, behaves like <img>/<video>):
 *      <jdf src="/docs/spec.jdf"></jdf>
 *
 *   3. Data attribute on any element (for retrofit into existing layouts):
 *      <div data-jdf="/whitepaper.jdf" data-jdf-zoom="1.2"></div>
 *
 * To opt out per-element, add `data-jdf-manual` to skip auto-init.
 * To opt out globally, set `window.JDFjsAutoInit = false` BEFORE loading jdfjs.
 */

import { embed, type JDFViewerOptions } from "./viewer";

const PROCESSED = new WeakSet<Element>();

function readOptions(el: Element): JDFViewerOptions {
  const opts: JDFViewerOptions = {};
  const get = (name: string) => el.getAttribute(`data-jdf-${name}`) ?? el.getAttribute(name);

  const zoom = get("zoom");
  if (zoom != null) {
    const n = Number(zoom);
    if (!isNaN(n)) opts.zoom = n;
  }
  const sb = get("sidebar");
  if (sb != null) opts.sidebar = sb !== "false" && sb !== "0";
  const tb = get("toolbar");
  if (tb != null) opts.toolbar = tb !== "false" && tb !== "0";
  const dm = get("dark-mode") || get("darkmode");
  if (dm === "auto" || dm === "light" || dm === "dark") opts.darkMode = dm;
  const page = get("page");
  if (page != null) {
    const n = Number(page);
    if (!isNaN(n)) opts.initialPage = n;
  }

  const w = get("width") || el.getAttribute("width");
  if (w != null) {
    const num = Number(w);
    opts.width = isNaN(num) ? w : num;
  }
  const h = get("height") || el.getAttribute("height");
  if (h != null) {
    const num = Number(h);
    opts.height = isNaN(num) ? h : num;
  }
  const fit = get("fit");
  if (fit === "manual" || fit === "fit-width" || fit === "fit-page") opts.fit = fit;

  return opts;
}

function pickContainer(el: Element): HTMLElement {
  // For <jdf>, <jdf-viewer> and similar tags, the element itself is the container.
  // For data-jdf, also use the element itself — its existing layout/dimensions
  // (set by the host page) become the viewer dimensions.
  if (!(el instanceof HTMLElement)) {
    throw new Error("jdfjs auto-init: target is not an HTMLElement");
  }
  return el;
}

function processElement(el: Element) {
  if (PROCESSED.has(el)) return;
  if (el.hasAttribute("data-jdf-manual")) return;
  const src = el.getAttribute("src") || el.getAttribute("data-jdf") || el.getAttribute("data-src");
  if (!src) return;
  PROCESSED.add(el);
  const container = pickContainer(el);
  const opts = readOptions(el);
  embed(container, src, opts).catch((err) => {
    console.error("[jdfjs] failed to embed", src, err);
    container.dispatchEvent(new CustomEvent("jdf-error", { detail: err, bubbles: true }));
  });
}

function scan(root: ParentNode = document) {
  // <jdf-viewer> custom element
  root.querySelectorAll("jdf-viewer").forEach(processElement);
  // <jdf> shorthand tag
  root.querySelectorAll("jdf").forEach(processElement);
  // data-jdf on any element
  root.querySelectorAll("[data-jdf]").forEach(processElement);
}

function watchForNewTargets() {
  if (typeof MutationObserver === "undefined") return;
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (n instanceof Element) {
          if (n.matches?.("jdf-viewer, jdf, [data-jdf]")) processElement(n);
          else scan(n);
        }
      });
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

/** Manually trigger a scan — useful for SPAs that mount content asynchronously. */
export function scanForJdfElements(root: ParentNode = document) {
  scan(root);
}

function autoInit() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if ((window as any).JDFjsAutoInit === false) return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { scan(); watchForNewTargets(); }, { once: true });
  } else {
    scan();
    watchForNewTargets();
  }
}

// Define the <jdf-viewer> custom element so its lifecycle slots into the DOM API.
if (typeof customElements !== "undefined" && !customElements.get("jdf-viewer")) {
  class JdfViewerElement extends HTMLElement {
    static get observedAttributes() { return ["src", "width", "height"]; }
    connectedCallback() { processElement(this); }
    attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null) {
      if (oldVal === newVal) return;
      if (name === "src" && newVal) {
        // Re-process: clear processed mark so it re-renders
        PROCESSED.delete(this);
        processElement(this);
      } else if (name === "width" && newVal) {
        const n = Number(newVal);
        this.style.width = isNaN(n) ? newVal : `${n}px`;
      } else if (name === "height" && newVal) {
        const n = Number(newVal);
        this.style.height = isNaN(n) ? newVal : `${n}px`;
      }
    }
  }
  customElements.define("jdf-viewer", JdfViewerElement);
}

autoInit();
