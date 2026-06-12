# jdf.js

[![npm](https://img.shields.io/npm/v/jdfjs.svg)](https://www.npmjs.com/package/@uurtech/jdf)
[![license](https://img.shields.io/npm/l/jdfjs.svg)](LICENSE)

Render [JDF (JSON Document Format)](https://github.com/uurtech/jdf) files in any web page with a single tag. Like PDF.js — but the file you point at is plain JSON, so you can also generate it, diff it, and edit it with any tool.

```html
<link rel="stylesheet" href="https://unpkg.com/@uurtech/jdf/dist/jdfjs.css">
<script type="module" src="https://unpkg.com/@uurtech/jdf"></script>

<jdf src="/whitepaper.jdf"></jdf>
```

That's the whole thing. Every `<jdf>` tag on the page is detected on load and rendered in place.

## Install

```bash
npm install @uurtech/jdf
```

Or via CDN — no install at all:

```html
<script type="module" src="https://unpkg.com/@uurtech/jdf"></script>
```

## Usage

```html
<jdf src="/doc.jdf"></jdf>

<!-- Configure with attributes -->
<jdf src="/doc.jdf"
     width="800"
     height="600"
     zoom="1.2"
     sidebar="true"
     dark-mode="auto"></jdf>
```

That is the only embed form. The `<jdf>` element is registered as a custom element with reactive attributes — change `src` programmatically and the embed updates:

```js
document.querySelector("jdf").setAttribute("src", "/other.jdf");
```

## Configuration

| Attribute | Type | Default | Notes |
|---|---|---|---|
| `src` | string | required | URL to a `.jdf` file |
| `width` | number (px) or any CSS length | — | e.g. `"800"` or `"100%"` |
| `height` | number (px) or any CSS length | `600px` | e.g. `"80vh"` |
| `zoom` | number | `1` | `1` = 100% |
| `fit` | `"manual"` · `"fit-width"` · `"fit-page"` | `"manual"` | Auto-zoom mode |
| `sidebar` | boolean | `false` | Show page-thumbnail sidebar |
| `toolbar` | boolean | `true` | Show toolbar (zoom, page nav) |
| `dark-mode` | `"auto"` · `"light"` · `"dark"` | `"auto"` | Follows OS by default |
| `page` | integer (0-based) | `0` | Initial page |
| `manual` | boolean | — | Skip auto-init for this element |

## Programmatic API

For full control, install via npm and call the JS API directly:

```js
import { embed, render, JDFViewer, jdf } from "@uurtech/jdf";
import "@uurtech/jdf/style.css";

// 1. Embed by URL into any container
const v = await embed("#viewer", "/doc.jdf", {
  zoom: 1.2,
  sidebar: true,
  width: "100%",
  height: "80vh",
  fit: "fit-width",
  onPageChange: (i) => console.log("on page", i),
  onLoad: (doc) => console.log("loaded", doc.meta.title),
});
v.goToPage(2);
v.setZoom(1.5);
v.destroy();

// 2. Render an in-memory document (no fetch)
import type { JdfDocument } from "@uurtech/jdf";
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
const el = document.getElementById("v")!;
const v3 = new JDFViewer(el, doc, { darkMode: "dark" });
v3.setDocument(otherDoc); // hot-swap
```

## SPAs / async content

Auto-init runs on `DOMContentLoaded` and watches the DOM with a `MutationObserver`, so `<jdf>` tags added later are picked up automatically. To trigger a manual scan after a route change:

```js
import { jdf } from "@uurtech/jdf";
jdf();                       // scan the whole document
jdf(myContainer);             // scan only inside myContainer
```

To opt out per element, add `manual`. To disable auto-init globally, set `window.JDFjsAutoInit = false` **before** loading the script.

## Hosting your `.jdf` file

JDF files are static JSON — every static host works. Suggested response headers:

```
Content-Type: application/json
Cache-Control: public, max-age=3600
Access-Control-Allow-Origin: *
```

The fetch needs CORS allowed if the JDF is on a different origin from your page.

## Browser support

Chrome 88+, Firefox 87+, Safari 14+, Edge 88+.

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

## License

MIT — see [LICENSE](https://github.com/uurtech/jdf/blob/master/LICENSE).

By [Ugur Kazdal](https://uurtech.com) ([@uurtech](https://github.com/uurtech)).
