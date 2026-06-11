/**
 * Auto-initialization: scan the page for <jdf src="..."> tags and render each one.
 *
 * Drop-in usage:
 *   <link rel="stylesheet" href="https://unpkg.com/jdfjs/dist/jdfjs.css">
 *   <script type="module" src="https://unpkg.com/jdfjs"></script>
 *   <jdf src="/whitepaper.jdf"></jdf>
 *
 * Configuration goes through attributes:
 *   <jdf src="..." width="800" height="600" zoom="1.2" sidebar="true" dark-mode="auto"></jdf>
 *
 * To opt out per-element add `manual`. To disable globally:
 *   window.JDFjsAutoInit = false   // before loading the script
 */

import { embed, type JDFViewerOptions } from "./viewer";

const PROCESSED = new WeakSet<Element>();

function readOptions(el: Element): JDFViewerOptions {
  const opts: JDFViewerOptions = {};
  const attr = (name: string) => el.getAttribute(name);

  const zoom = attr("zoom");
  if (zoom != null) {
    const n = Number(zoom);
    if (!isNaN(n)) opts.zoom = n;
  }
  const sb = attr("sidebar");
  if (sb != null) opts.sidebar = sb !== "false" && sb !== "0";
  const tb = attr("toolbar");
  if (tb != null) opts.toolbar = tb !== "false" && tb !== "0";
  const dm = attr("dark-mode") || attr("darkmode");
  if (dm === "auto" || dm === "light" || dm === "dark") opts.darkMode = dm;
  const page = attr("page");
  if (page != null) {
    const n = Number(page);
    if (!isNaN(n)) opts.initialPage = n;
  }
  const w = attr("width");
  if (w != null) {
    const n = Number(w);
    opts.width = isNaN(n) ? w : n;
  }
  const h = attr("height");
  if (h != null) {
    const n = Number(h);
    opts.height = isNaN(n) ? h : n;
  }
  const fit = attr("fit");
  if (fit === "manual" || fit === "fit-width" || fit === "fit-page") opts.fit = fit;

  return opts;
}

function processElement(el: Element) {
  if (PROCESSED.has(el)) return;
  if (el.hasAttribute("manual")) return;
  const src = el.getAttribute("src");
  if (!src) return;
  PROCESSED.add(el);
  const container = el as HTMLElement;
  const opts = readOptions(el);
  embed(container, src, opts).catch((err) => {
    console.error("[jdf.js] failed to embed", src, err);
    container.dispatchEvent(new CustomEvent("jdf-error", { detail: err, bubbles: true }));
  });
}

function scan(root: ParentNode = document) {
  root.querySelectorAll("jdf").forEach(processElement);
}

function watchForNewTargets() {
  if (typeof MutationObserver === "undefined") return;
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (n instanceof Element) {
          if (n.tagName.toLowerCase() === "jdf") processElement(n);
          else scan(n);
        }
      });
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

/** Manually trigger a scan — for SPAs that mount content asynchronously. */
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

// Define the <jdf> element as a custom element so its src attribute is reactive.
// Browsers treat it as HTMLElement, but registering it gives us attribute-change hooks.
if (typeof customElements !== "undefined" && !customElements.get("jdf")) {
  class JdfElement extends HTMLElement {
    static get observedAttributes() { return ["src", "width", "height", "zoom"]; }
    connectedCallback() { processElement(this); }
    attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null) {
      if (oldVal === newVal) return;
      if (name === "src" && newVal) {
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
  customElements.define("jdf", JdfElement);
}

autoInit();
