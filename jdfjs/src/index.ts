/**
 * jdfjs — render JDF (JSON Document Format) documents in the browser.
 *
 * Drop-in usage (auto-init):
 *   <link rel="stylesheet" href="https://unpkg.com/@uurtech/jdf@0.1.11/dist/jdfjs.css">
 *   <script type="module" src="https://unpkg.com/@uurtech/jdf@0.1.11"></script>
 *   <jdf src="/whitepaper.jdf"></jdf>
 *
 * Programmatic:
 *   import { embed, render } from "@uurtech/jdf";
 *   await embed("#viewer", "/doc.jdf", { zoom: 1.2 });
 */

import "./auto-init";

export { embed, render, JDFViewer } from "./viewer";
export { jdf } from "./auto-init";
export type { JDFViewerOptions, JDFViewerInstance } from "./viewer";
export type { JdfDocument, Element, Page } from "@jdf/core";
