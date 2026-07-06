# JDF
## JSON Document Standard

> *the AI-native document standard*

A JSON document format built for the AI era. PDFs were designed for humans and printers; JDF is designed for the systems that read, write, and reason over documents next. Open `.jdf` in any text editor and you see the source. Open it in JDF Reader and you see a rendered page. Edit either side, the other reflects it. When the document carries embedded assets (images, fonts) it ships as `.jdfx` — a zip bundle around the same JSON, so a single file still travels self-contained.

<p align="center">
  <img src="docs/screenshot1.png" alt="JDF Reader rendered view">
<br>
 <img src="docs/screenshot3.png" alt="JDF Reader web element view">
</p>

JDF runs in three places:

| Surface | What it is | Install |
|---|---|---|
| **JDF Reader** | Native macOS app — read, edit, import PDF/MD, export PDF | `brew tap uurtech/jdf && brew install jdf` |
| **jdf.js** | JavaScript library — embed `.jdf` files on any web page | `npm install @uurtech/jdf` or `<script src="https://unpkg.com/@uurtech/jdf@0.1.23">` |
| **`@uurtech/jdf-cli`** | CLI — validate, convert PDF/JSON/MD→JDF, and RAG-native `chunk` + `embed` | `brew install uurtech/jdf/jdf-cli`, `npm i -g @uurtech/jdf-cli`, or `npx @uurtech/jdf-cli convert paper.pdf` |

## Why JDF

It's JSON. Every consequence below falls out of that:

- `cat`, `grep`, `jq`, VS Code, every linter — they all work, no plugin.
- `git diff` shows the actual change, line-level.
- Generating a doc is `JSON.stringify(doc)`.
- A JSON Schema validates structure (`spec/jdf-schema.json`) and powers IDE autocomplete.
- Search is text search. `grep "TODO" *.jdf` works.
- No vendor, no proprietary parser. Opens the same way today and in 20 years.

## The endgame — documents stop being storage, start being interfaces

If an AI-native document format gets global adoption, it becomes a base layer for knowledge. Then:

- Documents stop being "static files" — they become live, addressable structures.
- Everything becomes machine-readable by default — no parser stage, no OCR fallback.
- AI search becomes near-instant and accurate — retrieval against a real structure, not a guess at one.
- PDFs fade out the way fax did once email arrived.
- Every app plugs into the same document structure — one tree, every consumer.

**The shift:** instead of *"AI trying to understand humans' files"*, humans start writing in a format already built for AI reasoning.

What that unlocks:

- **Education** content becomes instantly interactive.
- **Legal & finance** documents become queryable in real time.
- **Knowledge graphs** form automatically from documents.
- **Every system** becomes interoperable by default.

The real endgame: **documents stop being storage → they become interfaces.** That is the world-change scenario this format aims at.

## Install

### Desktop · macOS

```bash
brew tap uurtech/jdf
brew install jdf
```

`brew` clones the tap, downloads the latest `.dmg` from the GitHub release, installs `JDF Reader.app` into `/Applications`, and automatically strips the macOS quarantine attribute so the app launches on first run.

**Manual install (without Homebrew).** Download the `.dmg` directly from the [latest release](https://github.com/uurtech/jdf/releases/latest), drag `JDF Reader.app` into `/Applications`, then either:

- **Right-click → Open** (one-time), confirm "Open" in the dialog. macOS remembers the choice.
- Or run once in Terminal:
  ```bash
  xattr -cr "/Applications/JDF Reader.app"
  open "/Applications/JDF Reader.app"
  ```

> **Why this step?** The `.dmg` is **unsigned** — JDF doesn't pay Apple's $99/yr Developer Program fee. macOS Gatekeeper blocks unsigned apps with a "damaged" or "unverified developer" dialog on first launch. The commands above remove the quarantine attribute macOS adds to downloads; the app itself is unchanged. The Homebrew Cask runs the same command automatically in its `postflight` step.

Upgrade later:

```bash
brew upgrade --cask jdf
```

The Cask formula lives in a separate tap repo: [`uurtech/homebrew-jdf/Casks/jdf.rb`](https://github.com/uurtech/homebrew-jdf/blob/main/Casks/jdf.rb). A reference copy is also kept in this repo at [`Casks/jdf.rb`](Casks/jdf.rb).

The **CLI** ships through the same tap as a Homebrew Formula (`brew install uurtech/jdf/jdf-cli`), so you can grab it without Node/npm — the canonical recipe is [`Formula/jdf-cli.rb`](Formula/jdf-cli.rb), mirrored into the tap on every release.

Linux and Windows builds (`.deb`, `.AppImage`, `.rpm`, `.msi`, `.exe`) are produced by the GitHub Actions release workflow on every tag — see the [latest release](https://github.com/uurtech/jdf/releases/latest).

### Web · jdf.js

Embed JDF documents on any web page with one tag:

```html
<link rel="stylesheet" href="https://unpkg.com/@uurtech/jdf@0.1.23/dist/jdfjs.css">
<script type="module" src="https://unpkg.com/@uurtech/jdf@0.1.23"></script>

<jdf src="/whitepaper.jdf"></jdf>
```

Or via npm for full programmatic control:

```bash
npm install @uurtech/jdf
```

```js
import { embed } from "@uurtech/jdf";
import "@uurtech/jdf/style.css";

await embed("#viewer", "/doc.jdf", { zoom: 1.2, sidebar: true });
```

See **[the jdf.js README](jdfjs/README.md)** and the **[embed documentation](docs/docs/embed/index.html)** for the full API, attribute reference, and framework integrations (React / Vue / Svelte).

### Build from source

```bash
git clone https://github.com/uurtech/jdf.git
cd jdf
pnpm install
pnpm tauri build      # produces .app + .dmg in apps/reader/src-tauri/target/release/bundle/
```

Requires Node 20+, pnpm 9+, Rust stable, Xcode CLT (macOS).

## Open & edit

**Open**: drag any `.jdf`, `.jdfx`, `.pdf`, or `.md` onto the welcome screen, double-click in Finder (file associations are registered for both `.jdf` and `.jdfx`), or `Cmd+O`.

**Edit a paragraph**: double-click it. The whole paragraph (or heading, list item, table cell, collapsible title, image src/alt) becomes an inline editor. Type. Press `Enter` or click anywhere else — the change saves to disk in ~150 ms.

**Restructure**: hover any element. A floating toolbar pops up in the top-right corner with **↑ Move up · ↓ Move down · ⧉ Duplicate · × Delete**. No right-click, no menu hunting.

**Insert new elements**: the Insert bar at the top of every page lets you append a Text / Rich text / List / Table / Shape / Image / Section / TOC element with a single click.

**Pages**: the sidebar shows a thumbnail preview of every page. Click `+` for a new page. Hover any thumbnail and click the red `×` to delete it.

**Undo / redo**: `⌘Z` / `⌘⇧Z` — 100-step history. Includes every text edit, structural change, and JSON view commit.

**Multiple windows**: `⌘N` or the toolbar "New" button. Compare two documents side-by-side.

**Memory model**:
- A `.jdf` or `.jdfx` opens in memory and **auto-saves** to its source file on every commit.
- A `.pdf` or `.md` is converted to JDF in memory only — the original file is never touched. The toolbar shows `● Unsaved (in memory)` while you edit. If you close the window with unsaved changes, you get a prompt to save it (`.jdfx` if it has assets, `.jdf` otherwise) or discard.
- The JSON view is a live two-way bind. Edit JSON, blur or `Cmd+S`, and the rendered view follows. Edit visually, the JSON updates as you go.

## Feature matrix — what runs where

JDF lives in three runnable surfaces. They all consume both `.jdf` (plain JSON) and `.jdfx` (zip bundle) but expose different feature sets — the desktop Reader is the only place you edit, jdf.js is a renderer, the CLI is for validation and conversion.

Legend: ✓ supported · ◐ partial / planned · — not applicable

### Document rendering (the bits that turn JSON into pixels)

All three renderers walk the same JSON. The desktop Reader and jdf.js are kept at strict feature parity for everything below.

| Capability | JDF Reader | jdf.js | CLI |
|---|:---:|:---:|:---:|
| `text` element (heading 1-6, align, link, tocEntry, style) | ✓ | ✓ | — |
| `richtext` element (per-run bold/italic/underline/strikethrough/color/font/link) | ✓ | ✓ | — |
| `image` element (base64 resource OR src URL/path; `fit` modes) | ✓ | ✓ | — |
| `table` element (headers, colspan/rowspan, alternating rows, borders, column align) | ✓ | ✓ | — |
| `list` element (ordered/unordered, nested with per-item type override) | ✓ | ✓ | — |
| `shape` element (rect, circle, ellipse, line, SVG path; fill/stroke/opacity) | ✓ | ✓ | — |
| `collapsible` element (expandable section with nested elements) | ✓ | ✓ | — |
| `toc` element (auto-generated, hierarchical, click-to-navigate) | ✓ | ✓ | — |
| Page sizes A4/A3/A5/Letter/Legal/Tabloid + custom `{width,height}` | ✓ | ✓ | — |
| Portrait / landscape (doc-level + per-page override) | ✓ | ✓ | — |
| Margins (doc-level merged with per-page) | ✓ | ✓ | — |
| Headers / footers (template strings AND full element trees) | ✓ | ✓ | — |
| Internal links (`#page-N` navigation) | ✓ | ✓ | — |
| External links (open in new tab) | ✓ | ✓ | — |
| Named styles (`styles.foo` referenced as string / array / inline) | ✓ | ✓ | — |
| Dark mode | ✓ | ✓ | — |
| Multi-page scroll + page indicator | ✓ | ✓ | — |
| Sidebar with page thumbnails | ✓ | ✓ (opt-in via `sidebar`) | — |
| Toolbar (zoom, page nav, search) | ✓ | ✓ (opt-in via `toolbar`) | — |
| Fit modes (`fit-width`, `fit-page`, manual zoom) | ✓ | ✓ | — |
| Reactive attributes — change `src`/`width`/`zoom` and the viewer updates | — | ✓ | — |

### Editing (read/write workflow)

Editing lives in the desktop Reader only — jdf.js is a viewer, the CLI is non-interactive.

| Capability | JDF Reader | jdf.js | CLI |
|---|:---:|:---:|:---:|
| Double-click any element to edit in place | ✓ | — | — |
| Inline editor for headings, paragraphs, list items, table cells, collapsible titles, image src/alt | ✓ | — | — |
| Auto-save to disk (~150 ms after edit) | ✓ | — | — |
| Hover toolbar — Move up / Move down / Duplicate / Delete (no right-click) | ✓ | — | — |
| Insert bar — Text / Rich text / List / Table / Shape / Image / Section / TOC | ✓ | — | — |
| Page management (add page, delete page, drag thumbnails) | ✓ | — | — |
| Undo / redo (`⌘Z` / `⌘⇧Z`, 100-step history) | ✓ | — | — |
| Live JSON view with two-way bind | ✓ | — | — |
| Multiple windows (`⌘N`) | ✓ | — | — |
| File associations (double-click `.jdf` in Finder) | ✓ | — | — |

### Import & convert

| Capability | JDF Reader | jdf.js | CLI |
|---|:---:|:---:|:---:|
| Open `.jdf` from disk | ✓ | ✓ (via `<jdf src>` / `embed()`) | ✓ (`validate`) |
| Import `.md` → `.jdf` | ✓ | — | ✓ (`jdf convert file.md`) |
| Import `.pdf` → `.jdf` (full fidelity: positions, fonts, colors, shapes, embedded images) | ✓ | — | ✓ (`jdf convert file.pdf`) — same algorithm via `@jdf/pdf-import` |
| Wrap raw / LLM JSON → validated `.jdf` | — | — | ✓ (`jdf convert file.json`) — full doc, element array, or `{ pages: [...] }` partial |
| JSON Schema validation | ✓ (live, in-app) | — | ✓ (`jdf validate file.jdf`) |
| Markdown viewer (native render, no conversion) | ✓ | — | — |

### Export

| Capability | JDF Reader | jdf.js | CLI |
|---|:---:|:---:|:---:|
| Export to PDF (`Cmd+Shift+E`) — preserves text, images, vector shapes, fonts, colors | ✓ | — | ◐ (planned) |
| Save edits back to source `.jdf` | ✓ (auto) | — | — |
| Save imported PDF/MD as `.jdf` | ✓ | — | — |

### Distribution / install

| Surface | How to get it |
|---|---|
| **JDF Reader** (macOS) | `brew tap uurtech/jdf && brew install jdf` — DMG / `.app`, signed via GitHub release |
| **JDF Reader** (Linux / Windows) | `.deb` / `.AppImage` / `.rpm` / `.msi` / `.exe` from the [latest release](https://github.com/uurtech/jdf/releases/latest) |
| **jdf.js** | `npm install @uurtech/jdf` or `<script src="https://unpkg.com/@uurtech/jdf@0.1.23">` |
| **`@uurtech/jdf-cli`** | `brew install uurtech/jdf/jdf-cli`, `npm i -g @uurtech/jdf-cli`, or `npx @uurtech/jdf-cli validate file.jdf` (no install) |

## Page model

Page sizes: A4, A3, A5, Letter, Legal, Tabloid, custom (`{width, height}` in mm). Portrait or landscape — set at the document level (`meta.pageOrientation`) or per-page. Margins are merged: doc-level `meta.margins` + per-page overrides. Headers and footers accept either a template string (`{{pageNumber}} {{totalPages}} {{title}} {{author}}`) or a full element tree.

Element-by-element capabilities are listed in the [Feature matrix](#feature-matrix--what-runs-where) above; the JSON Schema in [`spec/jdf-schema.json`](spec/jdf-schema.json) is the source of truth.

## PDF import: full fidelity

Drag a `.pdf` onto the viewer and you get an editable JDF copy that **looks identical to the original** — no "best effort", no placeholders.

The same algorithm runs from the CLI for unattended pipelines:

```bash
# headless conversion — RAG ingestion, CI gate, build step
jdf convert contract.pdf -o contract.jdf --json
jdf validate contract.jdf      # exit 1 on schema failure → CI fails the build
```

Both the desktop reader and the CLI import `@jdf/pdf-import` from `packages/jdf-pdf-import/` — there's a single algorithm. Reader uses the browser entry point (DOM canvas, real Web Worker); the CLI uses the node entry point (`@napi-rs/canvas`, in-process). Output is bit-identical for the same PDF.

Per text run, the importer extracts:
- **position** (mm) — via PDF.js `viewport.convertToViewportPoint`, accounting for rotation, CropBox, and MediaBox offset.
- **font family** — looked up from PDF.js `commonObjs` cache, mapped to `Inter / Times New Roman / JetBrains Mono` based on the original font name.
- **font size** in points (from the text matrix scale).
- **bold / italic** — detected from the real font name (`Helvetica-Bold`, `Times-Italic`, etc).
- **color** — from `setFillRGBColor / setFillGray / setFillCMYKColor` walked over the operator list, snapshotted at each text-show op.
- **opacity** — from `ca` / `CA` in `setGState`.
- **invisible text** — text rendering mode 3 (used for OCR layers) is filtered out.
- **link annotations** — `getAnnotations()` rectangles are matched to text runs and emitted as JDF `link`s.

For graphics:
- **Vector shapes**: rectangles, lines, and arbitrary paths from `constructPath` are emitted as `shape: rect | line | path` with their fills, strokes, stroke widths, and `opacity`. Cubic and quadratic Bezier curves preserved as SVG `C` segments.
- **Embedded images**: `paintImageXObject` ops are followed back to `page.objs`, decoded into RGBA via canvas, encoded to base64 PNG, stored in `resources.images`, and placed at their original transform on the page.

The result: PDF heading → JDF heading element with right size, right font, right color, right position. PDF table → individual cell text elements at the right grid coordinates. PDF logo → embedded base64 image at its real placement. Then you double-click any of it to edit.

## PDF export

Round-trip back to `.pdf` via the toolbar (or `Cmd+Shift+E`). Respects:
- `meta.pageSize` and `pageOrientation` (A4 / A3 / A5 / Letter / Legal / Tabloid / custom; portrait / landscape; doc-level + per-page overrides).
- `style.color` on every text element via `set_fill_color`.
- Text, richtext, lists, tables, collapsibles, shapes — all rendered.
- **Embedded images**: base64 → image crate decoder → printpdf `ImageXObject`. The Markdown / PDF imports' images come back out the other end.
- TOC — iterated from the document's headings into a real PDF table-of-contents.

## Markdown

`.md` opens with a continuous-scroll, GitHub-style render (`marked`, full GFM: tables, blockquotes, code, links, images, task lists, hr, strikethrough). Toolbar toggle flips to the paged JDF render of the same content. `Cmd+F` highlights matches inline with `<mark>` tags in the live MD output, line-by-line.

**Images in Markdown** — `![alt](path/to/picture.png)` works with relative paths (`komojam_target_architecture.drawio.png`), absolute paths, and `http(s)://` URLs. On import the relative ones are read from disk and base64-embedded into the document so the resulting `.jdf` is self-contained and portable. Both the JDF Reader app and the CLI (`jdf convert file.md`) follow the same rule.

## Images & assets — `.jdf` vs `.jdfx`

JDF ships in **two file shapes** for the same schema. Both open the same way; the difference is how binary assets are stored.

| Shape | Layout | When it's used | Why |
|---|---|---|---|
| **`.jdf`** | Single JSON file | No embedded assets — only text, http URLs, or trivially small inline data | Stays diffable, `cat`/`grep`/`jq` work on the file directly |
| **`.jdfx`** | ZIP bundle: `document.json` + `manifest.json` + `assets/*` | One or more embedded images / fonts | Self-contained (one file to share), no base64 bloat in JSON, RAG can decide per-element whether to fetch the binary |

The reader, jdf.js web embed, CLI, and PDF exporter all open both. The save flow picks `.jdfx` automatically when the document has any embedded asset; you can override the choice in the Save As dialog.

### `.jdfx` layout

```
hello.jdfx                  (zip)
├── document.json           ← JDF document — same schema as a standalone .jdf
├── manifest.json           ← format metadata: version, generator, asset listing
└── assets/
    ├── asset-1.png
    └── asset-2.jpg
```

**Scope rule:** `document.json.meta` owns *content* metadata (title, author, keywords, description). `manifest.json` owns *format* metadata (version, generator, asset listing). They never duplicate fields — `document.json` is the source of truth. Manifest schema: [`spec/jdfx-manifest-schema.json`](spec/jdfx-manifest-schema.json).

### Three ways to reference an image

| Form | Used in | Example |
|---|---|---|
| Bundle resource | `.jdfx` (default) | `{ "type": "image", "resource": "asset-1", "alt": "..." }` — bytes live in `assets/asset-1.png` |
| `data:` URL | Inline in `.jdf` (small images / no zip) | `{ "type": "image", "src": "data:image/png;base64,iVBORw0KGgo..." }` |
| `http(s)://` URL | CDN-hosted, shared figures | `{ "type": "image", "src": "https://cdn.example.com/diagram.png" }` |

`fit` accepts `contain` (default), `cover`, `fill`, `none`. The renderer in the desktop app, the web embed, and the PDF exporter all resolve the three forms identically — no missing-image fallbacks anywhere in the pipeline.

### Markdown imports

`![alt](komojam_target_architecture.drawio.png)` works with relative paths, absolute paths, and `http(s)://` URLs. On import:

1. Relative paths are resolved against the Markdown file's directory and read from disk.
2. Bytes get embedded into the document.
3. If at least one image was embedded, the importer writes a `.jdfx`; otherwise a plain `.jdf`. Same rule in the desktop reader and `jdf convert file.md`.

## RAG / AI ingestion

JDF removes most of the work a typical retrieval-augmented-generation pipeline does on PDFs. The structure that PDF parsers try to reconstruct is already in the file, so several pipeline stages become trivial or vanish entirely:

| Stage | PDF | JDF |
|---|---|---|
| **Parse / extract** | `pdfplumber` / `pymupdf` / `unstructured` — layout analysis, font heuristics, OCR fallback for image-only pages | `JSON.parse(content)` — no layout reconstruction, the structure is already in the file |
| **Chunking** | Token-windowed splits that frequently slice through tables, lists, footnotes | Each element (`text`, `richtext`, `table`, `list`, `image`) is a natural retrieval unit — no chunker config |
| **Metadata** | Synthesized after the fact (page number, "is this a heading?") and often wrong | First-class on every element: `type`, `heading`, page index, position, link target |
| **Embedding noise** | Repeated page headers / footers / page numbers leak into chunks | `header` and `footer` live in their own tree, never in content chunks |
| **Re-indexing on edit** | Re-parse + re-chunk + re-embed the whole PDF | Diff the JSON, re-embed only the changed elements |
| **Tables** | Cells smear across columns; multi-row headers collapse | `{ headers: [...], rows: [[...]] }` — every cell at its real coordinate |
| **Images** | Dropped or stubbed as `[image]` | Stored in `resources.images` with alt text and an anchor element — a vision step can fetch the image at the exact retrieval point |

> **Benchmarks coming.** The wins above are *structural* — pipeline stages JDF removes entirely — not measured timings. We're running benchmarks on a public corpus (academic PDFs, financial filings, scanned reports) covering parse, chunk, embed, and retrieval cost; this section will be updated with the numbers as soon as they're ready. Real-world speedup depends on your PDFs (text-only vs. scanned), parser, and chunker — if you run a comparison on your own corpus first, please [open an issue](https://github.com/uurtech/jdf/issues) with the methodology and we'll include it.

A minimal RAG ingestor for JDF is a single loop — no PDF library, no layout heuristics, no chunker config:

```ts
import fs from "node:fs/promises";
import type { JdfDocument } from "@jdf/core";

const doc: JdfDocument = JSON.parse(await fs.readFile("paper.jdf", "utf8"));

for (const [pageIndex, page] of doc.pages.entries()) {
  for (const el of page.elements) {
    const text =
      el.type === "text" || el.type === "richtext" ? el.content :
      el.type === "list"  ? el.items.map(i => i.content).join("\n") :
      el.type === "table" ? [el.headers, ...el.rows].map(r => r.join(" | ")).join("\n") :
      null;
    if (!text) continue;

    await index.upsert({
      id: `${doc.meta?.title}-p${pageIndex}-${el.type}`,
      vector: await embed(text),
      metadata: {
        type: el.type,
        heading: (el as any).heading ?? null,
        page: pageIndex + 1,
        title: doc.meta?.title,
      },
    });
  }
}
```

The same pipeline against a PDF needs `pdfplumber` (or equivalent), a layout heuristic to detect headings, a chunker that respects tables, and an OCR fallback for image-only pages — and still loses fidelity at every step.

See [`docs/docs/why-ai.html`](docs/docs/why-ai.html) for the long-form discussion of why every modern LLM reads JDF more easily than PDF.

## Format

```json
{
  "$jdf": "1.0.0",
  "meta": { "title": "...", "pageSize": "A4", "unit": "mm" },
  "styles": { "heading": { "fontSize": 22, "fontWeight": "bold" } },
  "resources": { "images": { "logo": { "data": "<base64>", "mimeType": "image/png" } } },
  "header": { "content": "{{title}}" },
  "footer": { "content": "page {{pageNumber}} / {{totalPages}}" },
  "pages": [
    {
      "elements": [
        { "type": "text", "content": "Hello", "heading": 1, "position": { "x": 0, "y": 5 }, "width": 166 },
        { "type": "list", "listType": "unordered", "items": [{ "content": "one" }, { "content": "two" }], "position": { "x": 0, "y": 25 }, "width": 166 }
      ]
    }
  ]
}
```

Positions in mm (default), font sizes in pt. A4 content area: 166 × 247 mm with the default 22 / 25 mm margins.

### Flow layout & auto-pagination

Set `"flow": true` on a page (or `meta.flow` for the whole document) and you no longer pin every element's `position.y` by hand. In flow mode the PDF exporter lays elements out top-to-bottom, word-wraps long text inside the content width, and breaks any overflow onto a fresh page instead of clipping it. Leave `flow` unset (the default) and authored positions are honoured exactly as before — mix both across pages in one document.

```json
{
  "pages": [
    { "flow": true, "elements": [
      { "type": "text", "content": "Title", "heading": 1, "width": 166 },
      { "type": "text", "content": "A long paragraph that wraps and paginates automatically…", "width": 166 }
    ] }
  ]
}
```

Full schema: [`spec/jdf-schema.json`](spec/jdf-schema.json). Working examples: [`spec/examples/hello-world.jdf`](spec/examples/hello-world.jdf) (absolute layout) and [`spec/examples/flow-report.jdf`](spec/examples/flow-report.jdf) (flow + auto-pagination).

Internal navigation: `link: "#page-3"` or `link: { type: "internal", target: "#page-3" }` on text/richtext.

## jdf.js — embed on the web

**`@uurtech/jdf`** (sources in [`jdfjs/`](jdfjs/)) is a small JavaScript library that turns any `.jdf` URL into a fully styled, scrollable, searchable embed in a web page. Like PDF.js — but the file is plain JSON.

### Usage

```html
<jdf src="/doc.jdf"></jdf>

<!-- Configure via attributes -->
<jdf src="/doc.jdf"
     width="800"
     height="600"
     zoom="1.2"
     sidebar="true"
     dark-mode="auto"></jdf>
```

That's the only embed form. Every `<jdf>` tag on the page is auto-detected on `DOMContentLoaded` and rendered. New tags added later (SPAs, async content) are picked up by a `MutationObserver`. To opt out per element: add `manual`. To disable globally: `window.JDFjsAutoInit = false` before loading the script.

### Configuration

| Attribute | Type | Default |
|---|---|---|
| `src` | string | required |
| `width` | number (px) or any CSS length | — |
| `height` | number (px) or any CSS length | `600px` |
| `zoom` | number | `1` |
| `fit` | `"manual"` · `"fit-width"` · `"fit-page"` | `"manual"` |
| `sidebar` | boolean | `false` |
| `toolbar` | boolean | `true` |
| `dark-mode` | `"auto"` · `"light"` · `"dark"` | `"auto"` |
| `page` | integer (0-based) | `0` |
| `manual` | boolean | — |

### Programmatic API

```js
import { embed, render, JDFViewer } from "@uurtech/jdf";
import "@uurtech/jdf/style.css";

// 1. Embed by URL
const v = await embed("#viewer", "/doc.jdf", {
  zoom: 1.2,
  sidebar: true,
  darkMode: "auto",
  width: "100%",
  height: "80vh",
  fit: "fit-width",
  onPageChange: (i) => console.log("page", i),
});
v.goToPage(2);
v.setZoom(1.5);

// 2. Render an in-memory document (no fetch)
import type { JdfDocument } from "@uurtech/jdf";
const doc: JdfDocument = { $jdf: "1.0.0", meta: { title: "Hi" }, pages: [...] };
render("#out", doc);
```

The library bundles to `dist/jdfjs.js` (~25 kB minified + gzipped). No framework, no build dependencies. Browser support: Chrome 88+, Firefox 87+, Safari 14+, Edge 88+.

Full reference: [`jdfjs/README.md`](jdfjs/README.md) · [`docs/docs/embed/`](docs/docs/embed/index.html).

## CLI

The CLI is the bridge between **legacy documents** (PDFs everywhere), **AI workflows** (LLMs emit JSON), and **RAG pipelines** (chunk + embed, incrementally):

```bash
# run on demand (no install)
npx @uurtech/jdf-cli validate doc.jdf

# PDF → JDF — same algorithm the desktop reader uses, headless
npx @uurtech/jdf-cli convert paper.pdf -o paper.jdf --json

# JSON → JDF — wrap raw JSON (LLM output, generated reports) into a validated doc
npx @uurtech/jdf-cli convert response.json -o response.jdf

# Markdown → JDF (convenience)
npx @uurtech/jdf-cli convert README.md

# JDF → retrieval-ready chunks (offline, deterministic)
npx @uurtech/jdf-cli chunk paper.jdf                 # → paper.chunks.jsonl

# JDF → embeddings (local via Ollama by default; incremental)
npx @uurtech/jdf-cli embed paper.jdf --incremental

# or install globally
npm install -g @uurtech/jdf-cli
jdf validate doc.jdf
```

### Commands

| Command | What it does |
|---|---|
| `jdf validate <file>` | Validate a `.jdf` / `.jdfx` against the schema. Non-zero exit on failure. |
| `jdf convert <file>` | PDF / JSON / Markdown → validated JDF. (alias: `import`) |
| `jdf chunk <file>` | Split a JDF document into retrieval-ready chunks. Offline, deterministic. |
| `jdf embed <file>` | Compute embeddings for the chunks. Local (Ollama) by default; incremental. |

### Why this CLI exists

- **PDF → JDF for RAG / CI ingestion.** Pipelines that want structured documents stop fighting `pdfplumber` / `pymupdf` heuristics — `jdf convert file.pdf --json` produces a tree your retriever can chunk by element type. The algorithm is shared with the desktop reader (`@jdf/pdf-import` package), so the CLI's output and the reader's output are bit-identical for the same input.
- **JSON → JDF for AI agents.** Models naturally emit JSON. `jdf convert response.json` accepts three shapes: a full JDF document (validated and optionally re-emitted), a bare element array (wrapped into a single-page A4 doc), or a `{ elements: [...] }` / `{ pages: [...] }` partial. The output is always validated against `spec/jdf-schema.json` — a non-zero exit makes it safe to drop into CI as a gate on model output.
- **JDF → chunks + embeddings for retrieval.** `jdf chunk` reads JDF's heading hierarchy and typed elements to produce section-aware chunks (tables serialized as `Header: value` rows, so column meaning survives). `jdf embed` turns those into vectors — **locally by default (Ollama, no data leaves your machine)** or via a remote API. Both are separate, opt-in steps: the converter never chunks or embeds, stays pure and offline.
- **One file in, one renderable file out.** `validate` runs after every `convert`, so if the JSON is malformed, the build breaks — there is no "shipping a broken document" path.

### Flags

| Flag | Commands | What it does |
|---|---|---|
| `-o, --output <path>` | all | Explicit output path. For `convert`, the extension picks `.jdf` vs `.jdfx`. |
| `--json` | convert | Force pure-JSON `.jdf` output even when the document carries images. |
| `--strategy <s>` | chunk, embed | `section` (default) · `element` · `fixed`. |
| `--format <f>` | chunk | `jsonl` (default) · `json` · `inline` (write an `index` block into the `.jdf`). |
| `--max-tokens <n>` | chunk, embed | Soft cap per chunk (default 512). |
| `--provider <p>` | embed | `ollama` (default, local) · `openai` (remote API). |
| `--model <name>` | embed | Model id (default `nomic-embed-text` / `text-embedding-3-small`). |
| `--incremental` | embed | Skip chunks whose content hash is unchanged — re-embed only what changed. |

### RAG ingestion, incrementally

`jdf chunk` and `jdf embed` exist because JDF is diffable JSON with a real structure. Chunking is **deterministic** — same document + same options → byte-identical chunks and stable content hashes. That is what makes `--incremental` embedding work: edit one paragraph in a 500-page document and you re-embed one chunk, not five hundred.

```bash
# section-aware chunks, ready for any vector store
jdf chunk report.jdf                      # → report.chunks.jsonl
#   {"id":"p3e7","text":"…","path":["Report","Pricing"],"page":3,"types":["text","table"],"tokens":142,"hash":"ab12cd"}

# embed locally (Ollama auto-starts via Docker if needed), skipping unchanged chunks
jdf embed report.jdf --incremental        # → report.embeddings.json

# or inline the chunk index into the document itself (renderers ignore it; still schema-valid)
jdf chunk report.jdf --format inline
```

Embeddings are **cache, never source of truth** — delete and regenerate at will. The document `.jdf` stays pure; the RAG layer lives beside it.

### CI gate

```yaml
# .github/workflows/docs.yml
- name: Validate model-emitted document
  run: |
    npx @uurtech/jdf-cli convert dist/output.json -o dist/output.jdf
    npx @uurtech/jdf-cli validate dist/output.jdf
```

If the model produces JSON that doesn't fit the schema, the workflow fails with the exact JSON path of the violation. Same shape for converted PDFs.

### Dev entry point

When working from a clone of this repo, the dev entry point is `pnpm --filter @uurtech/jdf-cli start <subcommand>` — same arguments, runs from source via `tsx`.

## JDF Forms — fillable, downloadable, machine-readable

JDF documents can carry **interactive form fields**. Embed a `.jdf` form on a web page with `jdf.js`, the user fills it in the browser, clicks Save, and gets the same `.jdf` back with all values inline. The downloaded file is plain JSON — your backend stores it, your RAG indexes it, your auditor diffs it the same way as any other JDF.

### Element types

| Type | Use for | Schema fields |
|---|---|---|
| `input` | single-line text, email, number, date, etc. | `name`, `inputType`, `value`, `placeholder`, `pattern`, `label`, `required`, `readonly` |
| `textarea` | multi-line text | `name`, `value`, `placeholder`, `rows`, `label`, `required`, `readonly` |
| `checkbox` | boolean toggle | `name`, `checked`, `label`, `required`, `readonly` |
| `select` | single or multi-select dropdown | `name`, `options[]`, `value` (single) or `values[]` (multi), `multiple`, `label`, `required`, `readonly` |
| `signature` | drawn signature pad | `name`, `value` (base64 PNG), `label`, `required`, `readonly` |

Every field has a stable `name` — that's the key both code and RAG pipelines use to look the value up. Open a partly-filled form in any text editor; the values are right there next to the field declarations.

### Embed a fillable form

```html
<link rel="stylesheet" href="https://unpkg.com/@uurtech/jdf@latest/dist/jdfjs.css">
<script type="module" src="https://unpkg.com/@uurtech/jdf@latest"></script>

<jdf src="customer-form.jdf"
     save-button="Save form"
     save-filename="filled.jdf"
     height="640"></jdf>
```

`save-button` adds a one-click download in the corner. `save-filename` overrides the default (`<title>.jdf`).

### Programmatic API

```js
import { embed } from "@uurtech/jdf";

const viewer = await embed("#form", "/customer-form.jdf");

// Live read of the user's current input
console.log(viewer.getFormValues());
// → { fullName: "Jane Doe", email: "jane@example.com", newsletter: true }

// Subscribe to every change (auto-save to your backend, dirty tracking, etc.)
const v = await embed("#form", "/customer-form.jdf", {
  onFormChange: (doc, change) => {
    fetch("/api/draft", { method: "POST", body: JSON.stringify(doc) });
  },
});

// Trigger a download programmatically
viewer.downloadJdf("filled-form.jdf");

// Or hand the blob to anything else (file upload, IndexedDB, etc.)
const blob = viewer.exportJdf();
```

### PDF AcroForm import

`jdf convert existing-form.pdf` walks the PDF's AcroForm widget annotations and emits matching JDF form elements:

| PDF field type | JDF element |
|---|---|
| `Tx` (text), single-line | `input` |
| `Tx` (text), multi-line | `textarea` |
| `Btn` (checkbox) | `checkbox` |
| `Ch` (choice, single) | `select` |
| `Ch` (choice, multi) | `select` with `multiple: true` |
| `Sig` (signature) | `signature` |

Existing values in the PDF flow through — partially-filled PDFs round-trip with their data intact.

### Why this matters for AI workflows

A filled `.jdf` form is **structured data your RAG can index per field**. No more parsing PDF widget streams, no more brittle regex on rendered text. `viewer.getFormValues()` returns a flat `{ name → value }` map that drops straight into a database row, an LLM tool call, or a CI gate.

```bash
# CI gate: every submitted form must validate against the schema
jdf validate inbox/*.jdf || exit 1
# Then jq the responses straight into your retriever
jq -s 'map(.. | select(.type=="input" or .type=="select") | {name, value})' inbox/*.jdf
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+O` / `Cmd+W` | Open / close |
| `Cmd+N` | New window |
| `Cmd+S` / `Cmd+Shift+E` | Save As `.jdf` / Export PDF |
| `Cmd+Z` / `Cmd+Shift+Z` | Undo / redo |
| `Cmd+F` | Search |
| `Cmd+B` | Sidebar |
| `Cmd+D` | Dark mode |
| `Cmd+P` | Print |
| `Cmd+=` `Cmd+-` `Cmd+0` | Zoom |
| `←` `→` | Page nav |
| Double-click | Edit element |
| `Enter` / `Esc` / `Cmd+Enter` | Commit / cancel / multi-line commit |
| `?` | Shortcut overlay |

## Project layout

```
spec/                     JSON Schema + examples
packages/jdf-core/        TypeScript types + utils
packages/jdf-pdf-import/  PDF → JDF algorithm (browser + node entry points; shared)
jdfjs/                    jdf.js — web embed library (npm: @uurtech/jdf)
apps/reader/              Tauri v2 app
  src/
    components/           element renderers, JSON view, MD view, sidebar, toolbar
    edit/                 mutation API + undo/redo history
    import/pdfToJdf.ts    one-line re-export of @jdf/pdf-import/browser
  src-tauri/              Rust backend (MD parse, PDF export with image embed, search)
tools/jdf-cli/            Ajv validate + PDF/JSON/MD → JDF importer (uses @jdf/pdf-import/node)
Casks/               Homebrew cask formula
.github/workflows/   CI (typecheck, schema validate, cargo check on 3 OSes)
                     + release (tag → multi-OS bundles)
```

Stack: Tauri v2, SolidJS, Tailwind v4, Vite, Rust (`pdf-extract`, `printpdf`, `pulldown-cmark`, `image`), Ajv, marked, pdfjs-dist.

## Status

Done:
- Full element rendering, edit-in-place + auto-save, JSON view, Markdown viewer.
- PDF import with positions, fonts, colors, opacity, links, vector shapes, embedded images.
- PDF export with page size, orientation, colors, real TOC, **embedded images**.
- Structural editing: hover action bar (move / duplicate / delete), Insert bar, page add/delete in sidebar.
- Undo / redo (100 steps, all mutations).
- Multiple windows (`⌘N`).
- macOS / Linux / Windows builds via GitHub Actions release workflow.
- JSON Schema, CLI validate, CI on all three OSes.
- Homebrew tap (`uurtech/jdf`).
- **jdf.js — web embed library** with auto-init, single `<jdf src="...">` form, feature parity with the desktop renderer.
- Published to npm as [`@uurtech/jdf`](https://www.npmjs.com/package/@uurtech/jdf) — install via `npm install @uurtech/jdf` or load from CDN at `https://unpkg.com/@uurtech/jdf@0.1.23` (always pin a version in production).
- **`.jdfx` zip bundles** — automatic for documents with embedded images/fonts. Reader, jdf.js, and CLI all read and write the format; manifest schema at [`spec/jdfx-manifest-schema.json`](spec/jdfx-manifest-schema.json).
- **Markdown image imports** — `![alt](relative.png)` works in both the desktop importer and `jdf convert file.md`. Relative paths are resolved against the source file's directory and embedded into the output bundle.
- **RAG tooling in the CLI** — `jdf chunk` (deterministic, section-aware, offline) and `jdf embed` (local via Ollama or remote via OpenAI, with `--incremental` re-embedding). Tables serialize as `Header: value` rows; chunk index can be inlined into the `.jdf`.

See [`CHANGELOG.md`](CHANGELOG.md) for the per-release log.

## Roadmap

The next surface area, grouped by theme. Items at the top of each group are scheduled first.

### RAG / AI tooling

- **Public benchmark suite** — parse / chunk / embed / retrieval cost measured on a shared corpus (academic PDFs, financial filings, scanned reports). Results published at `docs/docs/benchmarks.html` and linked from the RAG section. Backs the structural claims in [`docs/docs/why-ai.html`](docs/docs/why-ai.html) with real numbers.
- **`@uurtech/jdf-rag`** — the CLI's `chunk` / `embed` logic as a published library (programmatic `chunkDocument()` / `embedDocument()`), so an ingestor can call it in-process instead of shelling out. The CLI commands already ship today; this packages them for embedding in apps.
- **`@uurtech/jdf-llm`** — structured-output helpers for the major LLM APIs (OpenAI `response_format`, Anthropic `tools`, Google `responseSchema`). Ships the JDF JSON Schema as a guaranteed-valid generation target plus prompt scaffolding for "produce a one-page report" workflows.

### CLI parity with the desktop reader

- **`jdf export file.jdf -o file.pdf`** — PDF export in the CLI. Wraps the Rust exporter as a standalone binary or ports it to JS. (PDF import, chunk, and embed already ship in the CLI.)

### Rendering & import quality

- **PDF table detection** — geometry-based row/column grouping during PDF import. Today the importer emits cells as positioned `text` elements; this pass groups them into real `table` elements with `headers` + `rows`. The single biggest fidelity win for RAG retrieval and export round-trips.
- **Editing in jdf.js** — opt-in editor mode (`<jdf src="..." editable>`) that mirrors the desktop reader's inline editing, hover action bar, and `Cmd+S` save. Today jdf.js is strictly a renderer.

### Editor & ecosystem

- **VS Code extension** — `.jdf` preview pane, JSON Schema-driven autocomplete, outline tree, click-to-jump from the JSON to the rendered element.
- **Format version 1.1** — additive: more `style` properties (text shadow, gradient fills), `footnote` element, `column` layout primitive, `resources.fonts` (loaded from `assets/` in `.jdfx` bundles). Schema bump documented in `CHANGELOG.md` per the parity rules in [`CLAUDE.md`](CLAUDE.md).

### Distribution & release

- **Apple notarization** — notarized macOS build silences Gatekeeper entirely. Removes the `xattr -cr` workaround currently shipped in the Homebrew Cask.
- **Linux & Windows code signing** — sign `.deb` / `.rpm` / `.msi` / `.exe` artifacts in the GitHub Actions release workflow.
- **Auto-bump CDN pins on release** — `scripts/release.sh` rewrites every `unpkg.com/@uurtech/jdf@<old>` reference in `README.md`, `jdfjs/README.md`, and `docs/**/*.html` to the new version before tagging. Removes a class of "demo broke after release" bugs.

## Contributing

JDF is open source — fork the repo, hack on it, open a pull request. `CONTRIBUTING.md` has the full guide; the short version:

1. Fork → branch → make your change.
2. `pnpm typecheck` and `cargo check` (in `apps/reader/src-tauri/`) must pass.
3. Add a sample to `spec/examples/` if your change affects rendering.
4. Open a PR against `master`. CI runs the same checks on every PR.

When adding a new JDF element type or attribute, update **all five** locations: `packages/jdf-core/src/types.ts`, `spec/jdf-schema.json`, `apps/reader/src/components/viewer/`, `jdfjs/src/renderers/element.ts`, and `apps/reader/src-tauri/src/commands/mod.rs`. See [`CLAUDE.md`](CLAUDE.md) for the full parity checklist.

Bug reports, feature requests, and design discussions all welcome in [GitHub Issues](https://github.com/uurtech/jdf/issues).

## Contributors

Thanks to everyone who has helped shape JDF — code, design, docs, feedback.

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/uurtech" title="uurtech">
        <img src="https://images.weserv.nl/?url=avatars.githubusercontent.com/u/5675890&w=72&h=72&mask=circle&fit=cover" width="72" height="72" alt="uurtech" /><br />
        <sub><b>uurtech</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/feyzademirel" title="feyzademirel">
        <img src="https://images.weserv.nl/?url=avatars.githubusercontent.com/u/46006881&w=72&h=72&mask=circle&fit=cover" width="72" height="72" alt="feyzademirel" /><br />
        <sub><b>feyzademirel</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/rcpzen" title="rcpzen">
        <img src="https://images.weserv.nl/?url=avatars.githubusercontent.com/u/24500147&w=72&h=72&mask=circle&fit=cover" width="72" height="72" alt="rcpzen" /><br />
        <sub><b>rcpzen</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/uguracikgoz" title="uguracikgoz">
        <img src="https://images.weserv.nl/?url=avatars.githubusercontent.com/u/17970755&w=72&h=72&mask=circle&fit=cover" width="72" height="72" alt="uguracikgoz" /><br />
        <sub><b>uguracikgoz</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/EienMosu" title="EienMosu">
        <img src="https://images.weserv.nl/?url=avatars.githubusercontent.com/u/82905592&w=72&h=72&mask=circle&fit=cover" width="72" height="72" alt="EienMosu" /><br />
        <sub><b>EienMosu</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/nanda1505" title="nanda1505">
        <img src="https://images.weserv.nl/?url=media.licdn.com/dms/image/v2/C4D03AQFRbXy2gcdv4Q/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1516253878455?e=1784764800%26v=beta%26t=WhcFqYUVXvfaDJ_lFFGJrg66nSYfG_AZidiX0roBR38&w=72&h=72&mask=circle&fit=cover" width="72" height="72" alt="nanda1505" /><br />
        <sub><b>nanda1505</b></sub>
      </a>
    </td>
  </tr>
</table>

[@uurtech](https://github.com/uurtech) · [@feyzademirel](https://github.com/feyzademirel) · [@rcpzen](https://github.com/rcpzen) · [@uguracikgoz](https://github.com/uguracikgoz) · [@EienMosu](https://github.com/EienMosu) · [@nanda1505](https://github.com/nanda1505)

## License

MIT — [`LICENSE`](LICENSE).
