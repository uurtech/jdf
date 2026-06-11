# JDF — JSON Document Format

**PDF sucks. We built something better.**

JDF is a modern document format based on JSON. It renders like PDF but you can read, edit, diff, and generate it with zero special tools. Open a `.jdf` file in VS Code — you see clean JSON. Open it in JDF Viewer — you see a beautifully rendered document. **Double-click any line, table cell, or list item to edit it in place. It saves automatically.**

---

## Why does JDF matter?

Every PDF you've ever touched has the same problems. Adobe knew this in 1993, and the format hasn't moved on. Meanwhile every other format we use daily — code, configs, prose — has gone the opposite direction: text-based, diffable, scriptable, free to edit.

JDF is what happens when documents finally catch up:

- **Documents are not artifacts. They are state.** A contract, an invoice, a whitepaper — these change. PDF treats every change as a re-print job. JDF treats them like code: a `git diff` shows you exactly which clause moved, which figure got a typo fix, which row changed. Reviewing a 30-page proposal becomes reviewing 12 lines of JSON.
- **Authoring should be free.** Adobe Acrobat costs $240/year. The smallest "fix this typo" task currently requires either that subscription, a roundtrip through a Word file, or some janky online converter you don't trust with your data. JDF opens in any text editor on the planet. The viewer is open source and 10 MB.
- **Generating documents should be one line of code.** PDF generation involves byte streams, fonts encoded as Type 1 dictionaries, cross-reference tables, and at least one library that hasn't been updated since 2017. JDF is `JSON.stringify(doc)`. Your invoice service can be a 30-line script.
- **Reading should not require a runtime.** A binary PDF tells you nothing without a parser. A JDF tells you everything: open it, read it, grep it, search it with `jq`. Documents become first-class data again.
- **Trust comes from transparency.** When you sign a PDF, you're trusting the renderer. Tampering, hidden layers, fonts that don't exist on your machine — all invisible. With JDF the *entire* document is human-auditable. There's no "extra layer".
- **Documents should outlive their software.** A `.jdf` from today will still open in 50 years, the same way a `.txt` from 1975 still opens. JSON has no proprietary owner. PDF technically doesn't either, but in practice "renders correctly" depends on Adobe's evolving Reader.

That's the bet: documents should be code-shaped — readable, editable, diffable, scriptable, and yours.

---

## What's new: edit-in-place + auto-save

PDF can't do this. Word kind of can but only after rendering through its own runtime. JDF lets you:

1. Open a `.jdf` file in JDF Viewer.
2. **Double-click** any text, heading, list item, table cell, or collapsible title — an inline editor opens for that element only (a paragraph edits as a whole, a heading as one line).
3. Type. Press `Enter` to commit (or `Esc` to cancel; `Cmd+Enter` for multi-line commit).
4. The file saves itself to disk. No mode toggle, no "Save As" dialog, no menu hunting. The disk truth and the visual truth never drift apart.

Switch to **JSON view** in the toolbar at any time to see the underlying document update live as you edit. Or edit the JSON directly — it commits back to the rendered document on blur.

The double-click is the trick: you don't think about *where* you are in some XML tree, you just edit the thing you can see. And because the file is JSON, every keystroke that lands on disk produces a clean `git diff` you'd be happy to commit.

---

## Recent updates

Things shipped in the latest build, beyond the edit-in-place feature above:

- **Live JSON view** — flip `View ↔ JSON` in the toolbar. Edit the JSON directly; it commits back to the rendered document on blur or `Cmd+S`. Two-way bound.
- **Markdown search with live highlights** — `Cmd+F` while in Markdown view searches the raw MD line-by-line and renders yellow `<mark>` highlights inline; no more switching to Paged view to search.
- **PDF export honors page size and orientation** — A4 / A3 / A5 / Letter / Legal / Tabloid / custom, portrait or landscape. Doc-level and per-page overrides both work. Text colors come from `style.color`. TOC is iterated into a real table-of-contents (no more `[Table of Contents]` placeholder).
- **Headers and footers with element trees** — beyond `{{pageNumber}}`/`{{title}}` template strings, header/footer `elements[]` lets you put any JDF element (text, image, shape) into the header band. Page padding auto-accounts for `header.height` / `footer.height`, so footers no longer collide with the last element on long pages.
- **Auto-save flush on close** — if there's a pending edit when you `Cmd+W` or close the window, the save completes before the window destroys itself. No silent data loss.
- **Recent files self-clean** — open a moved or deleted file from the welcome screen and it's automatically removed from the list when the open fails.
- **`text.align` is real** — `align: "left"|"center"|"right"|"justify"` on text elements works (used to be silently ignored in favor of `style.textAlign`).
- **JSON Schema + CLI validation** — `spec/jdf-schema.json` is a complete draft-07 schema; `jdf validate file.jdf` (Ajv) reports path-level errors with warnings vs hard failures separated.
- **GitHub Actions CI** — every PR runs `pnpm typecheck`, schema-validates `spec/examples/`, and `cargo check`s the Tauri backend.
- **Drop-zone hint, sidebar thumbnails, dark mode everywhere, keyboard shortcut overlay (`?`)** — small UX touches that add up.

See [`CHANGELOG.md`](CHANGELOG.md) for the full list.

---

## The PDF → JDF comparison

|  | PDF | JDF |
|---|---|---|
| Format | Binary blob | Human-readable JSON |
| Open with | Adobe Reader (~250 MB) | Any text editor or JDF Viewer (~10 MB) |
| Edit a typo | Adobe Acrobat ($240/yr) | Double-click → type → done |
| Auto-save while editing | ❌ | ✅ (debounced, with toolbar status indicator) |
| Toggle raw view | ❌ | Live, two-way bound JSON view |
| `git diff` | Meaningless binary noise | Clean, reviewable, line-level |
| Generate from code | `reportlab`, `pdfkit`, weeks of struggle | `JSON.stringify(doc)` |
| Validate / schema check | None | JSON Schema (draft-07) + Ajv CLI |
| Search programmatically | Custom binary parsing | `grep`, `jq`, `ripgrep` |
| In-app search | Linear text search | Multi-match highlight in JDF; live `<mark>` highlights in MD view |
| Interactive elements | Static | Collapsible sections, clickable TOC, internal `#page-N` links |
| Headers/footers | Static text | Template vars (`{{pageNumber}}`, …) **or** full element trees |
| Vendor lock-in | Adobe | None — it's just JSON |

---

## Quick Start

### Install (macOS)

```bash
brew tap uurtech/jdf
brew install --cask jdf-viewer
```

### Build from Source

```bash
git clone https://github.com/uurtech/jdf.git
cd jdf
pnpm install
pnpm dev          # development mode with hot reload
pnpm tauri build  # production .app bundle
```

### Prerequisites (for building)

- [Node.js](https://nodejs.org) 20+
- [pnpm](https://pnpm.io) 9+
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- macOS: Xcode Command Line Tools

---

## What a JDF File Looks Like

```json
{
  "$jdf": "1.0.0",
  "meta": {
    "title": "My Document",
    "author": "Ugur Kazdal",
    "pageSize": "A4"
  },
  "styles": {
    "heading": { "fontSize": 22, "fontWeight": "bold", "color": "#0f172a" },
    "body": { "fontSize": 10.5, "lineHeight": 1.6, "color": "#334155" }
  },
  "pages": [
    {
      "elements": [
        {
          "type": "text",
          "content": "Hello, World!",
          "style": "heading",
          "heading": 1,
          "position": { "x": 0, "y": 10 },
          "width": 166
        },
        {
          "type": "list",
          "listType": "unordered",
          "position": { "x": 0, "y": 30 },
          "width": 166,
          "items": [
            { "content": "Human-readable JSON" },
            { "content": "Git-friendly diffs" },
            { "content": "10MB viewer" }
          ]
        }
      ]
    }
  ]
}
```

That's it. No binary headers, no compression streams, no cross-reference tables. Just JSON.

---

## Features

### ✏️ Edit-in-place (the killer feature)
- **Double-click** any element to edit it: text, headings, list items, table cells, table headers, collapsible titles, image src/alt. No mode toggle — just double-click and type.
- The editor wraps **only the element you clicked** — a paragraph edits as one whole text field (multi-line if needed), a heading as a single line, a list item as just that item.
- **Auto-save** to disk on every commit (debounced ~400ms), with a "✓ Saved" indicator in the toolbar.
- **Two-way binding** between rendered view and JSON — flip to JSON view to watch your edits land live.
- **Edit JSON directly** in the JSON viewer — `Cmd+S` (or blur) parses and commits back.
- `Enter` commits, `Esc` cancels, `Cmd+Enter` commits in multi-line mode.

### Document rendering
- **Rich text** — bold, italic, underline, strikethrough, colors, fonts, sizes (per-run formatting in `richtext` elements)
- **Headings** — `h1`-`h6` with proper semantic tags (use `heading: 1-6` on text elements)
- **Text alignment** — `align: left|center|right|justify` on text elements (also via `style.textAlign`)
- **Page layout** — A4, A3, A5, Letter, Legal, Tabloid, custom sizes, portrait/landscape, per-page or doc-level overrides, margins
- **Headers & footers** — repeating across pages with template variables (`{{pageNumber}}`, `{{totalPages}}`, `{{title}}`, `{{author}}`) **or** full element children (text, image, shape — anything you can put on a page)
- **Tables** — styled headers, alternating rows, configurable inner/outer borders with custom color/width, column alignment, header/row/alternate row styles
- **Lists** — ordered (`<ol>`), unordered (`<ul>`), mixed nested (a child `listType` overrides its parent)
- **Images** — embedded (base64) or file-referenced, with `contain`/`cover`/`fill`/`none` fit
- **Shapes** — rect, circle, ellipse, line, SVG path; stroke as string or `{color, width}` object
- **Code blocks** — monospace font, background color, padding, border radius

### Interactive (things PDF can't do)
- **Collapsible sections** — expand/collapse content
- **Full-text search** — `Cmd+F` over the full document; multi-match highlighting in JDF view, line-by-line in Markdown view (live `<mark>` highlights in the rendered MD)
- **Auto-generated TOC** — clickable, hierarchical (`tocLevel` / `heading` level-aware), `depth` filter
- **Internal links** — `link: "#page-3"` or `link: { type: "internal", target: "#page-3" }` jumps to that page, no tooling needed

### Import & Export
- **PDF → JDF** — drag a PDF onto the viewer or use Open dialog (Rust `pdf-extract`)
- **Markdown → JDF** — open `.md` files; full GFM: tables, blockquotes, fenced code, links, images, task lists, horizontal rules, strikethrough; bold/italic emit as `richtext` runs
- **Native Markdown viewer** — switch between paged JDF render and a continuous-scroll, GitHub-style MD render with `MD ↔ Paged` toggle in the toolbar
- **JDF → PDF** — respects `meta.pageSize` and `pageOrientation` (A4 / A3 / A5 / Letter / Legal / Tabloid / custom, portrait or landscape); applies `style.color` to text; renders text, richtext, lists, tables, collapsibles, shapes, real TOC; image is a labelled placeholder

### Desktop App
- **Native macOS app** — Dock icon, Cmd+Tab, native menus
- **File associations** — double-click `.jdf` or `.md` to open in JDF Viewer
- **Drag & drop** — drop files onto the window or the welcome screen, with a visible drop-zone hint
- **Recent files** — last 10 documents on the welcome screen; broken paths are auto-cleaned when an open fails
- **Sidebar with thumbnails** — per-page colored mini-layout previews of every element on the page
- **Dark mode** — `Cmd+D`, full coverage including the markdown body
- **Auto-save flush on close** — pending edits are saved before the window is destroyed; no silent data loss
- **Help overlay** — press `?` for a grouped File / View / Edit & Navigate keyboard shortcut sheet
- **Print** — `Cmd+P` (toolbar and sidebar are hidden in print)
- **~10MB** — not 250MB like Adobe Reader

### Format & validation
- **JSON Schema** — `spec/jdf-schema.json` (draft-07) covers every element type, style, and resource — works as autocomplete in VS Code
- **CLI** — `tools/jdf-cli` runs Ajv-based schema validation with path-level error reporting, plus `import` for Markdown→JDF
- **CI-ready** — GitHub Actions workflow (`.github/workflows/ci.yml`) runs `pnpm typecheck`, schema validation against `spec/examples/`, and `cargo check` on every PR

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+O` | Open file (.jdf, .pdf, .md) |
| `Cmd+S` | Save as .jdf |
| `Cmd+Shift+E` | Export as PDF |
| `Cmd+W` | Close document |
| `Cmd+F` | Search document |
| `Cmd+B` | Toggle page sidebar |
| `Cmd+D` | Toggle dark mode |
| `Cmd+P` | Print |
| `Cmd+=` / `Cmd+-` | Zoom in/out |
| `Cmd+0` | Reset zoom |
| `←` / `→` | Previous/next page |
| `dbl-click` | Edit the element under cursor (.jdf only) |
| `Enter` / `Esc` | Commit / cancel edit |
| `Cmd+Enter` | Commit edit in multi-line mode |
| `?` | Show keyboard shortcuts overlay |

---

## Project Structure

```
jdf/
├── spec/                       # Format specification
│   ├── jdf-schema.json        # JSON Schema (draft-07)
│   └── examples/              # Sample .jdf files
│       └── hello-world.jdf
├── packages/
│   └── jdf-core/              # Shared TypeScript types & utilities
├── apps/
│   └── viewer/                # Tauri desktop app
│       ├── src/               # SolidJS frontend
│       │   ├── components/
│       │   │   ├── viewer/    # Element renderers (text, table, list, ...)
│       │   │   ├── markdown/  # Native MD viewer
│       │   │   ├── json/      # Raw JSON view (editable)
│       │   │   └── shared/    # Toolbar, Sidebar, SearchPanel, Editable, ...
│       │   └── edit/          # Edit context + path-based update logic
│       └── src-tauri/         # Rust backend (PDF parse, MD parse, export)
└── tools/
    └── jdf-cli/               # CLI: validate, import
```

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Desktop runtime | [Tauri v2](https://tauri.app) | 10MB binary, native webview, file associations |
| Frontend | [SolidJS](https://solidjs.com) | Fine-grained reactivity, no vDOM overhead |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) | Utility-first, fast |
| Markdown render | [marked](https://marked.js.org) | GFM support, fast |
| Backend | Rust | PDF parsing, full-text search, export |
| PDF parsing | `pdf-extract` crate | Text extraction from PDF |
| PDF export | `printpdf` crate | Generate PDF from JDF |
| Markdown | `pulldown-cmark` crate | CommonMark + GFM parsing |
| Validation | [Ajv](https://ajv.js.org) | JSON Schema validator (CLI) |
| Build | Vite + pnpm workspaces | Fast HMR, monorepo |

---

## JDF Format Spec

Every JDF document has:

| Field | Required | Description |
|-------|----------|-------------|
| `$jdf` | Yes | Version string (e.g. "1.0.0") |
| `meta` | Yes | Title, author, page size, margins |
| `styles` | No | Named reusable style definitions |
| `resources` | No | Embedded fonts and images |
| `header` | No | Repeating header with template vars |
| `footer` | No | Repeating footer with page numbers |
| `pages` | Yes | Array of pages, each with elements |

Full JSON Schema: [`spec/jdf-schema.json`](spec/jdf-schema.json).

### Element Types

| Type | What it renders |
|------|----------------|
| `text` | Text block with styling and optional `heading: 1-6` |
| `richtext` | Inline runs with bold/italic/underline/color/link per run |
| `image` | Embedded (`resource` + base64) or referenced (`src` URL/path) |
| `table` | Headers, rows, borders, alternating rows, column alignment |
| `list` | Ordered / unordered with nesting and per-item type override |
| `shape` | rect, circle, ellipse, line, SVG path |
| `collapsible` | Expandable section with nested elements |
| `toc` | Auto-generated table of contents with depth filter |

### Positioning

- All positions are in **millimeters** (default) — same as PDF
- Font sizes are in **points (pt)** — same as Word/PDF
- Origin is top-left of the content area (after margins)
- A4 content area: 166mm wide × 247mm tall (with default margins)

### Template variables (header/footer)

`{{pageNumber}}`, `{{totalPages}}`, `{{title}}`, `{{author}}` are interpolated in `header.content` / `footer.content` strings.

### Internal links

Use `link: "#page-3"` or `link: { type: "internal", target: "#page-3" }` on text/richtext to make a clickable jump.

---

## CLI Usage

```bash
cd tools/jdf-cli

# Validate a .jdf file against the JDF schema
pnpm start validate ../../spec/examples/hello-world.jdf

# Import Markdown to JDF
pnpm start import README.md
pnpm start import README.md -o readme.jdf
```

The `validate` command uses the `spec/jdf-schema.json` JSON Schema and reports specific path-level errors.

---

## Contributing

1. Fork the repo
2. Create a feature branch (`feat/my-feature`)
3. Make changes, ensure `pnpm typecheck` passes (and `cargo check` in `apps/viewer/src-tauri`)
4. Open a PR

### Areas to contribute

- **Element renderers** — improve table/image/shape rendering
- **PDF import** — better structure detection, image extraction, table detection
- **Editor mode** — add new element insertion / deletion / reordering UI
- **PDF export** — handle pageSize/orientation, embed images, render TOC, multi-page overflow
- **New platforms** — Windows/Linux testing and CI
- **Format extensions** — new element types, style properties (with schema bump)

---

## Roadmap

- [x] Viewer with all element types
- [x] PDF import (text extraction)
- [x] Markdown import + native MD viewer
- [x] PDF export (text, list, table, collapsible, shape)
- [x] Search, sidebar with thumbnails, zoom, dark mode
- [x] File associations (.jdf, .md, .pdf)
- [x] **Edit-in-place + auto-save** (double-click any element, saves to disk)
- [x] **Live JSON view** with two-way editing
- [x] JSON Schema + Ajv-based CLI validation
- [x] Native Markdown viewer with in-doc search highlighting
- [x] Multi-page-size & landscape PDF export with `style.color` and real TOC
- [x] Header/footer with element children (not just template strings)
- [x] Auto-save flush on window close + recent-file self-clean
- [x] GitHub Actions CI (`typecheck`, schema-validate, `cargo check`)
- [ ] Insert / delete / reorder elements visually
- [ ] Image extraction from PDF
- [ ] Table detection from PDF
- [ ] Windows/Linux builds
- [ ] VS Code extension (JDF preview)
- [ ] Online viewer (web version)

---

## License

MIT — see [LICENSE](LICENSE)

---

Built by [@uurtech](https://github.com/uurtech) — because every fix-a-typo-in-a-PDF moment is a small reminder that documents shouldn't work this way.
