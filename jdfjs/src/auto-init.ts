/**
 * Auto-init: scan the page for <jdf src="..."> tags and render each one.
 *
 *   <link rel="stylesheet" href="https://unpkg.com/jdfjs/dist/jdfjs.css">
 *   <script type="module" src="https://unpkg.com/jdfjs"></script>
 *   <jdf src="/whitepaper.jdf"></jdf>
 *
 * Configuration via attributes on <jdf>:
 *   <jdf src="..." width="800" height="600" zoom="1.2" sidebar="true" dark-mode="auto"></jdf>
 *
 * For SPAs that mount content async, call `jdf()` after the new DOM lands.
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
  applySizeAttrs(container);
  const opts = readOptions(el);
  embed(container, src, opts).catch((err) => {
    console.error("[jdf.js] failed to embed", src, err);
    container.dispatchEvent(new CustomEvent("jdf-error", { detail: err, bubbles: true }));
  });
  // Watch for attribute changes — re-render when src changes,
  // resize when width/height changes. Replaces the custom element
  // attributeChangedCallback (which we can't use because <jdf> isn't
  // a valid custom element name per the Web Components spec).
  observeAttributes(container);
}

function applySizeAttrs(el: HTMLElement) {
  const w = el.getAttribute("width");
  if (w != null) {
    const n = Number(w);
    el.style.width = isNaN(n) ? w : `${n}px`;
  }
  const h = el.getAttribute("height");
  if (h != null) {
    const n = Number(h);
    el.style.height = isNaN(n) ? h : `${n}px`;
  }
}

const ATTR_OBSERVED = new WeakSet<Element>();
function observeAttributes(el: Element) {
  if (ATTR_OBSERVED.has(el)) return;
  if (typeof MutationObserver === "undefined") return;
  ATTR_OBSERVED.add(el);
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== "attributes" || !m.attributeName) continue;
      const name = m.attributeName;
      if (name === "src") {
        // Re-render with the new src
        PROCESSED.delete(el);
        processElement(el);
      } else if (name === "width" || name === "height") {
        applySizeAttrs(el as HTMLElement);
      }
    }
  });
  obs.observe(el, { attributes: true, attributeFilter: ["src", "width", "height"] });
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
export function jdf(root: ParentNode = document) {
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

// We can't use `customElements.define("jdf", ...)` because the Web Components
// spec requires custom element names to contain a hyphen. Instead, we treat
// <jdf> as a plain HTMLUnknownElement and wire up reactive src/width/height
// attributes via a per-element MutationObserver inside processElement.

autoInit();
