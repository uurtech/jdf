# JDF — JSON Document Format

**PDF sucks. We built something better.**

JDF is a modern document format based on JSON. It renders like PDF but you can read, edit, diff, and generate it with zero special tools. Open a `.jdf` file in VS Code — you see clean JSON. Open it in JDF Viewer — you see a beautifully rendered document.

---

## Why JDF?

PDF was designed in 1993 for laser printers. It's binary, opaque, and hostile to everything modern developers care about:

- **Can't diff it** — PDF changes are invisible in git
- **Can't read it** — you need proprietary software to see what's inside
- **Can't edit it** — one small fix requires Adobe Acrobat ($$$)
- **Can't generate it** — complex libraries, weird coordinate systems
- **Can't search it** — binary streams need special parsing

JDF fixes all of this:

| | PDF | JDF |
|---|---|---|
| Format | Binary blob | Human-readable JSON |
| Version control | Meaningless diffs | Clean, reviewable diffs |
| Edit with | Adobe Acrobat ($240/yr) | VS Code, vim, any text editor |
| Generate from code | Complex libraries (reportlab, pdfkit) | `JSON.stringify()` |
| Viewer size | ~250MB (Adobe Reader) | ~10MB (JDF Viewer) |
| Interactive elements | Static only | Collapsible sections, live search, clickable TOC |
| Schema validation | None | JSON Schema with autocomplete |
| File associations | Locked to Adobe | Opens with JDF Viewer or any editor |

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

### Document Rendering
- **Rich text** — bold, italic, underline, strikethrough, colors, fonts, sizes
- **Page layout** — A4, Letter, custom sizes, margins, headers/footers with page numbers
- **Tables** — styled headers, alternating rows, borders, column alignment
- **Lists** — ordered, unordered, nested
- **Images** — embedded (base64) or file-referenced
- **Shapes** — rect, circle, ellipse, line, SVG path
- **Code blocks** — monospace font, background color

### Interactive (things PDF can't do)
- **Collapsible sections** — expand/collapse content
- **Full-text search** — Cmd+F, highlights results across pages
- **Auto-generated TOC** — clickable table of contents
- **Internal links** — jump between pages/sections

### Import & Export
- **PDF → JDF** — drag a PDF onto the viewer or use Open dialog
- **Markdown → JDF** — open .md files directly, renders with proper formatting
- **JDF → PDF** — export as PDF for sharing with people who don't have JDF Viewer
- **JDF → JDF** — save/edit the JSON directly

### Desktop App
- **Native macOS app** — Dock icon, Cmd+Tab, native menus
- **File associations** — double-click `.jdf` or `.md` to open in JDF Viewer
- **Drag & drop** — drop files onto the window
- **Dark mode** — Cmd+D
- **Print** — Cmd+P
- **~10MB** — not 250MB like Adobe Reader

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+O` | Open file (.jdf, .pdf, .md) |
| `Cmd+S` | Save as .jdf |
| `Cmd+Shift+E` | Export as PDF |
| `Cmd+F` | Search document |
| `Cmd+B` | Toggle page sidebar |
| `Cmd+D` | Toggle dark mode |
| `Cmd+P` | Print |
| `Cmd+=` / `Cmd+-` | Zoom in/out |
| `Cmd+0` | Reset zoom |
| `←` / `→` | Previous/next page |

---

## Project Structure

```
jdf/
├── spec/                    # Format specification
│   ├── jdf-schema.json     # JSON Schema
│   └── examples/           # Sample .jdf files
├── packages/
│   └── jdf-core/           # Shared TypeScript types & utilities
├── apps/
│   └── viewer/             # Tauri desktop app
│       ├── src/            # SolidJS frontend (UI, renderers)
│       └── src-tauri/      # Rust backend (PDF parse, export, search)
└── tools/
    └── jdf-cli/            # CLI: validate, import, convert
```

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Desktop runtime | [Tauri v2](https://tauri.app) | 10MB binary, native webview, file associations |
| Frontend | [SolidJS](https://solidjs.com) | Fine-grained reactivity, no vDOM overhead |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) | Utility-first, fast |
| Backend | Rust | PDF parsing, full-text search, export |
| PDF parsing | `pdf-extract` crate | Text extraction from PDF |
| PDF export | `printpdf` crate | Generate PDF from JDF |
| Markdown | `pulldown-cmark` crate | CommonMark parsing |
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

### Element Types

| Type | What it renders |
|------|----------------|
| `text` | Text block with styling |
| `richtext` | Inline formatting (bold parts, links within text) |
| `image` | Embedded or referenced image |
| `table` | Rows, columns, headers, borders |
| `list` | Ordered/unordered with nesting |
| `shape` | rect, circle, line, SVG path |
| `collapsible` | Expandable/collapsible section |
| `toc` | Auto-generated table of contents |

### Positioning

- All positions are in **millimeters** (default) — same as PDF
- Font sizes are in **points (pt)** — same as Word/PDF
- Origin is top-left of the content area (after margins)
- A4 content area: 166mm wide × 247mm tall (with default margins)

---

## CLI Usage

```bash
cd tools/jdf-cli

# Validate a .jdf file
npx tsx src/index.ts validate ../../spec/examples/hello-world.jdf

# Import PDF to JDF
npx tsx src/index.ts import document.pdf -o document.jdf

# Import Markdown to JDF
npx tsx src/index.ts import README.md -o readme.jdf
```

---

## Contributing

1. Fork the repo
2. Create a feature branch (`feat/my-feature`)
3. Make changes, ensure `pnpm typecheck` passes
4. Open a PR

### Areas to contribute:
- **Element renderers** — improve table/image/shape rendering
- **PDF import** — better structure detection, image extraction
- **Editor mode** — WYSIWYG editing (planned, not yet built)
- **New platforms** — Windows/Linux testing and CI
- **Format extensions** — new element types, style properties

---

## Roadmap

- [x] Viewer with all element types
- [x] PDF import (text extraction)
- [x] Markdown import
- [x] PDF export
- [x] Search, sidebar, zoom, dark mode
- [x] File associations (.jdf, .md)
- [ ] WYSIWYG editor mode
- [ ] Image extraction from PDF
- [ ] Table detection from PDF
- [ ] Windows/Linux builds
- [ ] GitHub Actions CI/CD
- [ ] VS Code extension (JDF preview)
- [ ] Online viewer (web version)

---

## License

MIT — see [LICENSE](LICENSE)

---

Built by [@uurtech](https://github.com/uurtech)
