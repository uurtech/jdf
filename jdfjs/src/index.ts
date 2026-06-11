/**
 * jdfjs — render JDF (JSON Document Format) documents in the browser.
 *
 * Quick start:
 *   <link rel="stylesheet" href="https://unpkg.com/jdfjs/dist/jdfjs.css">
 *   <script type="module">
 *     import { embed } from "https://unpkg.com/jdfjs";
 *     embed("#viewer", "https://example.com/whitepaper.jdf");
 *   </script>
 *
 * Programmatic:
 *   import { render } from "jdfjs";
 *   const doc = await fetch("doc.jdf").then(r => r.json());
 *   render(document.querySelector("#viewer"), doc, { zoom: 1.2 });
 */

export { embed, render, JDFViewer } from "./viewer";
export type { JDFViewerOptions, JDFViewerInstance } from "./viewer";
export type { JdfDocument, Element, Page } from "@jdf/core";
