# JDF — JSON Document Format

A document format that's just JSON. Open `.jdf` in any text editor and you see the source. Open it in JDF Viewer and you see a rendered page. Edit either side, the other reflects it.

## Why JDF

It's JSON. Every consequence below falls out of that:

- `cat`, `grep`, `jq`, VS Code, every linter — they all work, no plugin.
- `git diff` shows the actual change, line-level.
- Generating a doc is `JSON.stringify(doc)`.
- A JSON Schema validates structure (`spec/jdf-schema.json`) and powers IDE autocomplete.
- Search is text search. `grep "TODO" *.jdf` works.
- No vendor, no proprietary parser. Opens the same way today and in 20 years.

## Install

macOS, no extra repo needed:

```bash
brew install --cask https://raw.githubusercontent.com/uurtech/jdf/master/Casks/jdf-viewer.rb
```

That's it — `brew` reads the Cask straight from this repo, downloads the `.dmg` from the GitHub release, and installs `JDF Viewer.app` into `/Applications`.

To upgrade later, run the same command again.

Or build from source:

```bash
git clone https://github.com/uurtech/jdf.git
cd jdf
pnpm install
pnpm tauri build   # produces .app + .dmg in apps/viewer/src-tauri/target/release/bundle/
```

Requires Node 20+, pnpm 9+, Rust stable, Xcode CLT (macOS).

## What it does

**Render**

`text` (with `heading: 1-6`), `richtext` (per-run bold/italic/underline/color/fontSize/link), `image` (`src` URL or `resource` base64; `fit: contain|cover|fill|none`), `table` (headers, rows, borders, alternating rows, column alignment), `list` (ordered, unordered, nested with per-item type override), `shape` (rect, circle, ellipse, line, SVG path), `collapsible`, `toc`.

Page sizes: A4, A3, A5, Letter, Legal, Tabloid, custom. Portrait or landscape, doc-level or per-page. Margins, headers, footers (template strings with `{{pageNumber}} {{totalPages}} {{title}} {{author}}`, or full element trees).

**Edit**

Double-click any element in the viewer — text, heading, list item, table cell, header, collapsible title, image src/alt. Inline editor opens for that element only. `Enter` commits, `Esc` cancels, `Cmd+Enter` for multi-line. Auto-saves to disk after a short debounce.

Or flip to **JSON view** in the toolbar and edit the JSON directly. Both paths land at the same file on disk.

**Import**

- `.md` — opens with native Markdown render (continuous scroll), or toggle to paged JDF view. Full GFM.
- `.pdf` — full-fidelity import via PDF.js. Every text run keeps its **position** (mm), **font family**, **size**, **weight**, **style**, **color**. Embedded raster images are extracted, base64'd into `resources.images`, and placed at their original position/size. Background rectangles, lines, and stroked paths land as `shape` elements with their fill/stroke colors. Heading levels are inferred from font size. The result opens identical to the PDF and is fully editable.

**Export**

- `.jdf` save (auto-save while editing, plus `Cmd+S` for "Save As").
- `.pdf` export — respects page size, orientation, text colors, real TOC. Renders text/richtext/list/table/collapsible/shape. Image embeds are placeholders for now.

**Search**

`Cmd+F`. In paged JDF view: multi-match results across pages. In Markdown view: line-by-line with live `<mark>` highlights in the rendered output.

## Format

Every JDF doc has these top-level fields:

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

Positions in mm (default), font sizes in pt. A4 content area: 166×247 mm with the default 22/25 mm margins.

Full schema: [`spec/jdf-schema.json`](spec/jdf-schema.json). Working example: [`spec/examples/hello-world.jdf`](spec/examples/hello-world.jdf).

Internal navigation: `link: "#page-3"` or `link: { type: "internal", target: "#page-3" }` on text/richtext.

## CLI

```bash
cd tools/jdf-cli

pnpm start validate ../../spec/examples/hello-world.jdf
pnpm start import README.md            # → README.jdf
pnpm start import README.md -o out.jdf
```

`validate` runs Ajv against the JSON Schema and reports path-level errors plus warnings.

## Keyboard shortcuts

| | |
|---|---|
| `Cmd+O` / `Cmd+W` | Open / close |
| `Cmd+S` / `Cmd+Shift+E` | Save As `.jdf` / Export PDF |
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
spec/                JSON Schema + examples
packages/jdf-core/   TypeScript types
apps/viewer/         Tauri v2 app
  src/               SolidJS + Tailwind v4 frontend
  src-tauri/         Rust backend (PDF/MD parse, export, search)
tools/jdf-cli/       Validate + import CLI
```

Stack: Tauri v2, SolidJS, Tailwind v4, Vite, Rust (`pdf-extract`, `printpdf`, `pulldown-cmark`), Ajv, marked.

## Status

What's there:
- Full element rendering, edit-in-place + auto-save, JSON view, Markdown viewer.
- PDF/MD import, PDF export with page size/orientation/colors/TOC.
- JSON Schema, CLI validate, GitHub Actions CI (typecheck, schema, cargo check).

What's not (yet):
- Insert / delete / reorder elements visually.
- PDF table detection (cells come in as separate text elements).
- Image embed in PDF export (the importer extracts images; the exporter doesn't yet write them back).
- Multi-page overflow on PDF export.
- Undo/redo.
- Multiple windows.
- Windows / Linux build.
- VS Code extension.
- Web viewer.

See [`CHANGELOG.md`](CHANGELOG.md) for what shipped.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md). Short version: `pnpm typecheck` + `cargo check` must pass.

## License

MIT — [`LICENSE`](LICENSE).
