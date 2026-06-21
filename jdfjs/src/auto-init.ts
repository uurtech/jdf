/**
 * Auto-init: scan the page for <jdf src="..."> tags and render each one.
 *
 *   <link rel="stylesheet" href="https://unpkg.com/@uurtech/jdf@0.1.11/dist/jdfjs.css">
 *   <script type="module" src="https://unpkg.com/@uurtech/jdf@0.1.11"></script>
 *   <jdf src="/whitepaper.jdf"></jdf>
 *
 * Configuration via attributes on <jdf>:
 *   <jdf src="..." width="800" height="600" zoom="1.2" sidebar="true" dark-mode="auto"></jdf>
 *
 * For SPAs that mount content async, call `jdf()` after the new DOM lands.
 * To opt out per-element add `manual`. To disable globally:
 *   window.JDFjsAutoInit = false   // before loading the script
 */

import { embed, type JDFViewerOptions, type JDFViewerInstance } from "./viewer";

const PROCESSED = new WeakSet<Element>();
// Track per-element resources so we can dispose them when the element leaves
// the DOM (SPA route changes, frameworks that re-render). Without this, every
// route mount adds a fresh JDFViewer instance and a MutationObserver while
// the previous ones are kept alive by the observer references.
const VIEWER_INSTANCES = new WeakMap<Element, JDFViewerInstance>();
const ATTR_OBSERVERS = new WeakMap<Element, MutationObserver>();

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
    // The `page` attribute is 1-based for users (matches the toolbar
    // indicator); JDFViewer's internal initialPage is 0-based. Convert
    // here so <jdf page="1"> opens on page 1, not page 2. Clamp to >= 0
    // so a typo'd `page="0"` doesn't crash navigation later.
    if (!isNaN(n)) opts.initialPage = Math.max(0, Math.floor(n) - 1);
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
  embed(container, src, opts)
    .then((inst) => {
      VIEWER_INSTANCES.set(el, inst);
      maybeAttachSaveButton(container, inst);
    })
    .catch((err) => {
      if ((err as Error)?.name === "AbortError") return; // src changed mid-fetch
      console.error("[jdf.js] failed to embed", src, err);
      container.dispatchEvent(new CustomEvent("jdf-error", { detail: err, bubbles: true }));
    });
  // Watch for attribute changes — re-render when src changes,
  // resize when width/height changes. Replaces the custom element
  // attributeChangedCallback (which we can't use because <jdf> isn't
  // a valid custom element name per the Web Components spec).
  observeAttributes(container);
}

/**
 * Wire up the optional save button. Two attributes opt in:
 *   <jdf src="form.jdf" save-button>                — adds a "Save" button
 *   <jdf src="form.jdf" save-button="Download form"> — custom label
 *   <jdf src="form.jdf" save-filename="filled.jdf"> — explicit filename
 *
 * The button is positioned in the embed's bottom-right corner via the
 * `jdfjs-save-button` class (themable from the host page). Clicking it
 * downloads the current document — including any form values the user
 * has typed — to the user's filesystem.
 */
function maybeAttachSaveButton(container: HTMLElement, inst: JDFViewerInstance) {
  if (!container.hasAttribute("save-button")) return;
  const labelAttr = container.getAttribute("save-button");
  const label = labelAttr && labelAttr.length > 0 && labelAttr !== "true" ? labelAttr : "Save";
  const filename = container.getAttribute("save-filename") || undefined;
  const btn = window.document.createElement("button");
  btn.type = "button";
  btn.className = "jdfjs-save-button";
  btn.textContent = label;
  btn.addEventListener("click", () => inst.downloadJdf(filename));
  // Make sure the host has positioning context for the absolutely-placed button.
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  container.appendChild(btn);
}

function disposeElement(el: Element) {
  const inst = VIEWER_INSTANCES.get(el);
  if (inst) {
    try { inst.destroy(); } catch { /* swallow */ }
    VIEWER_INSTANCES.delete(el);
  }
  const aobs = ATTR_OBSERVERS.get(el);
  if (aobs) {
    aobs.disconnect();
    ATTR_OBSERVERS.delete(el);
  }
  PROCESSED.delete(el);
  ATTR_OBSERVED.delete(el);
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
        // Re-render with the new src — dispose the previous viewer first so
        // its observers/listeners are torn down before the next one mounts.
        disposeElement(el);
        processElement(el);
      } else if (name === "width" || name === "height") {
        applySizeAttrs(el as HTMLElement);
      }
    }
  });
  obs.observe(el, { attributes: true, attributeFilter: ["src", "width", "height"] });
  ATTR_OBSERVERS.set(el, obs);
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
          else if (typeof n.querySelectorAll === "function") {
            // Limit to elements that look like roots, not viewer-internal
            // children — those are added by us and have no <jdf> tag inside.
            n.querySelectorAll("jdf").forEach(processElement);
          }
        }
      });
      m.removedNodes.forEach((n) => {
        if (n instanceof Element) {
          if (n.tagName.toLowerCase() === "jdf") disposeElement(n);
          else if (typeof n.querySelectorAll === "function") {
            n.querySelectorAll("jdf").forEach(disposeElement);
          }
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
