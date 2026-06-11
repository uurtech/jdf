# jdf.js

[![npm](https://img.shields.io/npm/v/jdfjs.svg)](https://www.npmjs.com/package/jdfjs)
[![license](https://img.shields.io/npm/l/jdfjs.svg)](LICENSE)
[![size](https://img.shields.io/bundlephobia/minzip/jdfjs)](https://bundlephobia.com/package/jdfjs)

A small JavaScript library that turns any [JDF (JSON Document Format)](https://github.com/uurtech/jdf) file into a fully styled, scrollable, searchable embed in your web page. Like PDF.js — but the file you point at is plain JSON, so you can also generate it, diff it, and edit it with any tool.

```html
<link rel="stylesheet" href="https://unpkg.com/jdfjs/dist/jdfjs.css">
<script type="module" src="https://unpkg.com/jdfjs"></script>

<jdf src="/whitepaper.jdf"></jdf>
```

That's the whole thing. Every `<jdf>`, `<jdf-viewer>`, or `[data-jdf]` element on the page is auto-detected and rendered.

## Install

```bash
npm install jdfjs
# or
pnpm add jdfjs
# or via CDN
# <script type="module" src="https://unpkg.com/jdfjs"></script>
```

## Three ways to embed

### 1. Custom element `<jdf-viewer>` — recommended

```html
<jdf-viewer src="/doc.jdf"></jdf-viewer>
```

Standards-compliant Web Component. The `src` attribute is reactive — change it via JS and the embed re-renders.

```js
document.querySelector("jdf-viewer").setAttribute("src", "/other.jdf");
```

### 2. Shorthand tag `<jdf>`

```html
<jdf src="/doc.jdf"></jdf>
```

Most concise. Behaves like `<img>` or `<video>`.

### 3. Data attribute `[data-jdf]` — retrofit into existing layouts

```html
<div data-jdf="/doc.jdf"
     data-jdf-zoom="1.2"
     data-jdf-sidebar="true"
     style="height: 800px"></div>
```

Drop into any element you already have. Useful for CMS templates and component frameworks where you can't add new tag names.

## Configuration

All three forms accept the same options. As HTML attributes, prefix with `data-jdf-`:

| Attribute | JS option | Type | Default |
|---|---|---|---|
| `src` | `(url arg)` | string | required |
| `data-jdf-zoom` | `zoom` | number | `1` |
| `data-jdf-sidebar` | `sidebar` | boolean | `false` |
| `data-jdf-toolbar` | `toolbar` | boolean | `true` |
| `data-jdf-dark-mode` | `darkMode` | `"auto"` · `"light"` · `"dark"` | `"auto"` |
| `data-jdf-page` | `initialPage` | integer (0-based) | `0` |
| `width` / `data-jdf-width` | `width` | number (px) or any CSS length | — |
| `height` / `data-jdf-height` | `height` | number (px) or any CSS length | `600px` |
| `data-jdf-fit` | `fit` | `"manual"` · `"fit-width"` · `"fit-page"` | `"manual"` |

## Programmatic API

For full control, install via npm and use the JS API directly:

```js
import { embed, render, JDFViewer } from "jdfjs";
import "jdfjs/style.css";

// 1. Embed by URL
const v1 = await embed("#viewer", "/doc.jdf", {
  zoom: 1.2,
  sidebar: true,
  width: "100%",
  height: "80vh",
  fit: "fit-width",
  onPageChange: (i) => console.log("on page", i),
  onLoad: (doc) => console.log("loaded", doc.meta.title),
});
v1.goToPage(2);
v1.setZoom(1.5);
v1.destroy(); // tear down

// 2. Render an in-memory document (no fetch)
import type { JdfDocument } from "jdfjs";

const doc: JdfDocument = {
  $jdf: "1.0.0",
  meta: { title: "Generated", pageSize: "A4" },
  pages: [{
    elements: [
      { type: "text", content: "Hello", heading: 1, position: { x: 0, y: 5 }, width: 166 }
    ],
  }],
};
render("#out", doc);

// 3. Class form for advanced wiring
const el = document.getElementById("v");
const v3 = new JDFViewer(el, doc, { darkMode: "dark" });
v3.setDocument(otherDoc); // hot-swap
```

## SPA / async content

The auto-init scanner watches the DOM with a `MutationObserver`, so embed targets added later are picked up automatically. To trigger a manual scan after a route change:

```js
import { scanForJdfElements } from "jdfjs";
scanForJdfElements();
```

To opt out of auto-init for a specific element, add `data-jdf-manual`. To disable it globally, set `window.JDFjsAutoInit = false` **before** loading the script.

## Hosting your `.jdf` file

JDF files are static JSON — every static host works. Suggested response headers:

```
Content-Type: application/json
Cache-Control: public, max-age=3600
Access-Control-Allow-Origin: *
```

The fetch needs CORS allowed if cross-origin. JDF files compress well (~80% gzip), so set `Content-Encoding: gzip` on your CDN.

## Browser support

Chrome 88+, Firefox 87+, Safari 14+, Edge 88+. Uses ES modules, `IntersectionObserver`, `customElements`, and the `fetch` API — all baseline since early 2021.

## Feature parity with the desktop reader

jdf.js renders every JDF element type the [desktop Reader](https://github.com/uurtech/jdf) does:

- `text` (with `heading: 1-6`, `align`, `tocEntry`, internal/external `link`)
- `richtext` (per-run `bold`/`italic`/`underline`/`strikethrough`/`color`/`fontSize`/`fontFamily`/`link`)
- `image` (embedded base64 or URL/path; `fit: contain|cover|fill|none`)
- `table` (headers, alternating rows, configurable borders, column alignment, cell-level styles)
- `list` (ordered / unordered, mixed nested)
- `shape` (rect, circle, ellipse, line, SVG path; fill, stroke, opacity)
- `collapsible` (expandable section)
- `toc` (auto-generated, hierarchical, click-to-navigate)

Plus headers/footers (template strings or full element trees), custom page sizes, doc-level / per-page orientation, and internal `#page-N` link navigation.

## Project structure

This package lives inside the JDF monorepo at [`jdfjs/`](https://github.com/uurtech/jdf/tree/master/jdfjs). The renderers and import logic stay in lockstep with the desktop Reader at [`apps/reader/`](https://github.com/uurtech/jdf/tree/master/apps/reader) — see [`CLAUDE.md`](./CLAUDE.md) for the parity rules.

## License

MIT — see [LICENSE](https://github.com/uurtech/jdf/blob/master/LICENSE).

By [Ugur Kazdal](https://uurtech.com) ([@uurtech](https://github.com/uurtech)).
