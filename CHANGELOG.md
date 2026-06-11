# Changelog

All notable changes to JDF are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · semantic-ish.

## [Unreleased]

### Added
- Edit-in-place: double-click any element (text, heading, list item, table cell, table header, collapsible title, image src/alt) to edit it inline. Auto-saves to disk (~400 ms debounce) with a toolbar status indicator.
- Live JSON view (`View ↔ JSON` toggle). Two-way bound to the rendered document; edit JSON directly with `Cmd+S` or blur to commit.
- Native Markdown viewer with GFM (tables, blockquotes, code, task lists, images, hr) and `MD ↔ Paged` toggle.
- Welcome screen with recent files, drag-drop hint, and dark-mode coverage.
- Sidebar thumbnails (per-page mini layout preview).
- Search panel with multi-match highlighting and keyboard navigation.
- Help overlay (`?`) with grouped File / View / Edit & Navigate shortcuts.
- JSON Schema (`spec/jdf-schema.json`) and `spec/examples/hello-world.jdf`.
- CLI (`tools/jdf-cli/`): `validate` (Ajv-based), `import` (md→jdf).
- Header/footer with element children (not just template text).
- Internal link navigation (`#page-N` → jump to page N).
- TOC click-to-navigate with hierarchical depth filter.
- PDF export now respects `meta.pageSize`/`pageOrientation` (was hardcoded A4).
- PDF export now applies `style.color` to text via `set_fill_color`.
- PDF export TOC: iterates document headings into a real TOC (was placeholder).
- Auto-save flushes pending writes on window close (`onCloseRequested`).
- Recent files self-clean: invalid paths are removed on failed open.

### Fixed
- Type ↔ renderer mismatches that silently broke many features:
  - Heading: `heading: 1-6` now renders as `<h1>`-`<h6>` (was always `<p>`).
  - List: `listType: "ordered"` now renders `<ol>` (was always `<ul>`).
  - RichText: `bold`/`italic`/`underline`/`strikethrough`/`color`/`fontSize`/`fontFamily` per run.
  - Table: `headers` array, `borders: bool|object`, `alternatingRowColor`, column alignment.
  - Image: both `src` and `resource`, `fit` modes (`contain`/`cover`/`fill`/`none`).
  - Header/footer: `content` template variables (`{{pageNumber}}`, `{{title}}`, …) actually evaluated.
  - Shape: `stroke` accepts string or `{color, width}` object.
- `text.align` field now applied (was ignored — only `style.textAlign` worked).
- Footer no longer overlaps last element on long pages (page padding accounts for header/footer height).
- Markdown→JDF: tables, blockquotes, links, images, hr, GFM strikethrough/tasklists.
- `validate_document` performs element-level schema checks with `errors` and `warnings` separation.
- Untracked `.DS_Store` files removed from the repo.

### Removed
- The "Edit" mode toggle button. Editing is implicit on `.jdf` files via double-click; no global mode flag.

## [0.1.0] — 2026-06-10

### Added
- Initial release: JDF format spec, Tauri viewer, PDF/Markdown import, PDF export, search/sidebar/zoom/dark mode, file associations.
