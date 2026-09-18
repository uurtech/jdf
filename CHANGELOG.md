# Changelog

All notable changes to JDF are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · semantic-ish. Versions are shared by the desktop reader, `@uurtech/jdf` (jdf.js) and `@uurtech/jdf-cli`.

## [Unreleased]

### Added — real PDFs read like a human reads them
- **Multi-column reading order** in the PDF importer (`packages/jdf-pdf-import/src/columns.ts`): column gutters are detected from the body-text coverage histogram; text, rich text and tables are emitted column by column between full-width blocks (title, abstract, wide captions). Rendering is unchanged (absolute positions); `jdf chunk`, search and the TOC now see a two-column paper in order. Ground truth: `pnpm --filter @jdf/pdf-import verify:order` prints Chrome-generated 1/2/3-column pages and checks the sentence sequence (100% pairwise order on all layouts, single-column untouched); `verify:order some.pdf` dumps a real PDF's element order.
- Table detection knows about column gutters: two columns of justified prose (which form perfectly consistent x-bands) are no longer emitted as a 2-column table.
- **Paragraph folding** (`packages/jdf-pdf-import/src/paragraphs.ts`): consecutive body lines that visibly belong together (same face/size, one line apart, aligned left edge, unfinished previous line) become one `text`/`richtext` element. The PDF's own line breaks are kept as `\n` (both renderers use `white-space: pre-wrap`), `style.lineHeight` carries the measured pitch and an indented first line becomes the new `style.textIndent` (types, schema, jdf.js, reader), so every line still lands where the PDF put it while `jdf chunk`, search and LLMs get whole paragraphs. Whole-line citation links fold too (the link moves onto that line's run).
- Runs on a shifted baseline — subscripts, small caps ("BERT" + "LARGE"), footnote marks, inline formulae — now join their visual row instead of becoming stray elements.
- Real-corpus benchmark result (BM25, `jdf chunk --max-tokens 256`): converted JDF reaches parity with the best PDF parsers on real papers and whitepapers (96.9% vs 97.7–98.4% R@1k tokens, equal top-1) while handing the LLM the fewest tokens; the gap the labelled corpus shows comes from tables and structure, which real prose-heavy PDFs have less of. Numbers and caveats: `bench/README.md`.
- **Real-corpus benchmark** `bench/byoc.py`: JDF vs PDF parsers on public PDFs (arXiv incl. two-column, AWS whitepapers — downloaded at run time, listed in `bench/byoc/corpus.json`) or on any folder (`--pdf DIR`), with numeric-fact questions derived from the documents; same retrievers and hit rule as the main benchmark; results published into README + bench/README between `bench:byoc` markers.
- **Reader: Insert Image / Video opens a file picker**, and an image/video dropped onto an open document is inserted (bytes go into `resources.images/videos` as base64, same shape as the importer/jdfx; sized from the image's pixel dimensions). Previously an empty placeholder box was inserted.
- `release-notes/aws-cto-brief.md` and a README section "Drop into an existing ingestion pipeline" documenting the `.jdf-rag/index.jsonl` contract for teams with an existing RAG script.

### Added — three-surface parity gate
- `scripts/parity-check.mjs` (`pnpm parity`): for every element type in the schema, checks types, jdf.js renderer, reader renderer, Rust `valid_types`/`draw_element`/`extract_text`, reader insert + blank-element factory and `jdf chunk`; validates every fixture with the CLI and renders every fixture in Chrome through both jdf.js and the built desktop reader (Tauri IPC mocked), failing on page errors, `[unknown: …]` markers or a differing element set. `release.sh` runs it as Step 0 and aborts on red.
- `spec/examples/elements-gallery.jdf` — one fixture that uses all 14 element types.
- Reader Insert bar now offers the five form elements (Input, Textarea, Checkbox, Select, Signature) — `makeBlankElement` already knew them, the toolbar did not.
- Both renderers tag element wrappers with `data-jdf-type`; jdf.js now renders `[unknown: <type>]` for unknown element types instead of silently dropping them (same fallback the reader has always shown).

### Fixed
- Reader search (`extract_text`) indexes form labels, values and placeholders — a filled form is findable by what was typed.
- Reader `<video>` no longer requests CORS (`crossorigin="anonymous"`); a hosted mp4 without `Access-Control-Allow-Origin` played in jdf.js but stayed blank on desktop.
- Homebrew cask: dropped `depends_on macos: :catalina` — current Homebrew rejects it (and rewrites the `">= :catalina"` string form to the same rejected call), so the cask failed to load and `brew upgrade --cask jdf` reported the old install as up to date.

### Added — images are no longer blind spots for RAG
- `image.ocr` (`{language, source, created, blocks:[{text, bbox, confidence}]}`), `image.caption` / `captionSource`, `image.id` in types and schema — text in `document.json`, the picture stays an asset.
- `jdf describe`: OCR via tesseract.js (local WASM, cached language data) and captions via a local Ollama vision model (default `qwen2.5vl:3b`) or OpenAI; per-element, `--force`, `--ocr-language`.
- `jdf convert --ocr tesseract|openai`: pages without a text layer (scans) are detected and OCR'd during import; without the flag the CLI warns that RAG will skip them.
- `jdf chunk` indexes alt + caption + OCR text and warns per file about media without text. `jdf rag` fills missing transcripts/OCR/captions when providers are given, prints a media-coverage report, lists every element still without text in `manifest.json → mediaWithoutText`, and `--strict` fails the run on blind spots. Reader search indexes caption + OCR text.

## [0.2.1] — 2026-09-13

### Fixed — PDF importer (found on a FlowCV résumé)
- Half the body text imported as white: text↔operator colour matching picked a 0.75pt decorative "•" operator drawn from the same origin as the 11pt line. Matching now penalises font-size mismatch and never falls back to an operator of a clearly different size; sub-1.5pt runs (decoration) are dropped.
- Lines wrapped onto the next line and overlapped: element boxes were cut to the PDF's advance width, narrower than the rendering font. Single lines get 20% slack capped at the page edge and at the next run on the same baseline.
- Adjacent runs of different style on one baseline ("**Full Stack Developer,** Decktopus AI", "**İsa Tanış**, *CTO*, Decktopus AI") are now one `richtext` element with per-run bold/italic/colour/link instead of overlapping absolute boxes — also one retrieval unit for RAG.

## [0.2.0] — 2026-09-13

### Added — RAG benchmark (JDF vs PDF)
- `bench/`: reproducible, Python-only benchmark. 24 generated reports as JDF and as browser-printed PDF, 192 questions with ground truth. Accuracy (`rag_bench.py`): PyMuPDF / pdfplumber / pypdf / pdftotext + LangChain-style chunking vs `jdf chunk`, BM25 + any sentence-transformers or Ollama embedding model, Recall@k / MRR / R@1k-tokens, per-question ranks, `--verify`. Cost (`cost_bench.py`): 1,000 PDF vs 1,000 JDF files through the same RAG pipeline — chunks, embedding tokens/$, measured embedding time, vector-store payload, re-index cost after edits, per-query LLM context cost, with accuracy alongside; prices from `prices.json`.
- `demos/rag-benchmark/`: 25-second Remotion presentation of the benchmark (`rag-benchmark.mp4`), every number read from `docs/bench.json`.
- Landing page hero: bun.com-style benchmark card (per-retriever tabs, metric switch, measured cost strip); RAG section, new `docs/benchmark.html` page and README carry the full tables. All generated from `bench/results/*.json`.

### Added — video RAG: transcripts, `jdf transcribe`, `jdf rag`
- `video.transcript` (`{language, source, created, segments:[{t0,t1,text,speaker?}]}`) and `video.chapters` (`[{t,title}]`) in types and schema — text in `document.json`, never an asset, so `.jdf`/`.jdfx` selection is unchanged.
- `jdf chunk` cuts transcripts into time windows (`--window`, default 45 s; segments never split; chapter changes start a new window) and stamps each chunk with `media: {element, t0, t1}` plus a `[mm:ss–mm:ss]` prefix in the text. `jdf embed` inherits it.
- `jdf transcribe`: `--from` SRT/VTT/JSON import (offline), `--provider whisper-cli` (whisper.cpp + ffmpeg, local) or `--provider openai` (audio API); `--prompt` passes Whisper's vocabulary hint; `--chapters`; `--element` for multi-video documents. Resolves the clip from bundle asset, data URL, local path or URL.
- `jdf rag <dir>`: one command over a folder — transcribe (optional), chunk, embed incrementally, `.jdf-rag/index.jsonl` + `manifest.json`; defaults from `jdf.rag.json`; `--dry-run`, `--no-embed`.
- `demos/video-rag/`: 25-second Remotion walkthrough of the video-RAG flow (`video-rag.mp4`, embedded in the CLI docs).
- jdf.js: transcript rendered as a WebVTT captions track; new `viewer.seek(elementId, seconds)` jumps a video to a retrieval hit. Reader: same captions track; search indexes transcript and chapter text. Examples `spec/examples/video.jdfx` and `docs/examples/video.jdf` now carry transcripts + chapters.

### Added — `video` element
- New element type `video`: plays inline in jdf.js and the desktop reader (HTML5 `<video>`, controls on by default, autoplay implies muted). Source is a bundled `.jdfx` asset (`resource` → `resources.videos[id]`, stored under `assets/`) or a `src` URL / data URI; optional `poster` (URL, data URI or image resource id), `title`, `fit`, `loop`. PDF export draws a dark poster placeholder with a play glyph and the title. `jdf chunk` indexes the title as `[video: …]`; the reader's Insert bar has a Video button. Examples: `spec/examples/video.jdfx` (bundled 3-second clip), `docs/examples/video.jdf` (hosted `src`). Schema, types, both bundle packers (reader + CLI), jdf.js unpacker and the Rust validator/exporter updated together.

### Added — PDF importer: real tables
- `jdf convert file.pdf` (and the reader's drag-and-drop import) now rebuilds tables from page geometry and emits real `table` elements — headers, rows, column widths, right-aligned numeric columns, header background, alternating row colour, borders — instead of dozens of loose text runs. Pure geometry (row baselines → column bands, drawn cell borders/backgrounds as hints), no ML, same code in CLI and reader (`packages/jdf-pdf-import/src/tables.ts`). Verified against the benchmark corpus: 24 browser-printed PDFs, 120 tables, 3,432 cells → 120/120 tables found, 99.3% cells exact (`pnpm --filter @jdf/pdf-import verify:tables`). Opt out with `detectTables: false`.
- Headings are detected relative to the page's body font size (bold and ≥1.2× body) instead of a fixed 16pt, and a heading wrapped onto two lines is folded back into one. Benchmark consequence: `PDF → jdf convert → jdf chunk` now retrieves like native JDF (top-1 80.2% vs 76.6% native vs 63.5% best raw-PDF pipeline; answer-in-first-1k-tokens 99.0% for both JDF paths) — the benchmark has a third pipeline for it.
- Fixed: rectangles packed inside PDF.js `constructPath` (how PDF.js 4.x emits `re`) were never parsed — every filled/stroked box drawn that way (table borders/backgrounds in browser-printed PDFs, most boxes from modern generators) was silently dropped.
- Fixed: text runs from browser-printed PDFs stayed one glyph per element ("R", "egi", "on"). Runs are now merged across font *subsets* of the same face, and the stretched trailing-space width PDF.js reports is no longer trusted (glyph advance calibrated per page).
- Page-background fills and off-page shapes are no longer emitted.

### Changed — CLI chunking
- `jdf chunk --strategy section` no longer emits heading-only chunks: a title directly followed by the first section heading (or an empty H2) is merged into the section that follows. Title-only fragments were a retrieval magnet with no content (found by the benchmark). Chunk ids of the first section change accordingly.
- `jdf embed` embeds the heading breadcrumb + chunk text (`embeddingInput()`), so vectors carry document/section context; chunk hashes unchanged. New `--cache <path>` flag for `--incremental` (was accepted by the library but not wired into the CLI).

### Fixed — jdf.js
- Zoom no longer leaves the page's unscaled footprint in layout: the page wrapper is sized to the rendered box and scaled from its corner, so pages stay centred and the pages column doesn't scroll sideways. In `fit="manual"` (the default) the zoom is capped so a page never renders wider than its container — an A4 page in a phone viewport used to be cut in half. Zooming by hand lifts the cap.

### Fixed — website (mobile)
- Landing: gradient headline wraps on phones, copy-command box and CLI/embed demo blocks scroll inside themselves instead of widening the page.
- Docs: tables (element reference, forms field table, comparison table) scroll inside their own box; tighter gutters; next/prev cards stack.
- Docs sub-pages loaded a pinned old CDN build (`@uurtech/jdf@0.1.11`); they now use the local bundle that `release.sh` refreshes, like the landing page.

## [0.1.26] — 2026-09-12

### Fixed — desktop reader
- **Recent Files / Finder / drag-drop from any folder.** Files opened from outside `~/Downloads`, `~/Documents`, `~/Desktop` failed with "forbidden path" on the next open and silently vanished from the recent list. All reads and writes now go through the app's own Rust commands (`read_text_file`, `read_binary_file`, `write_binary_file`, `open_document`, `save_document`) with no directory allow-list.
- **Editing a `.jdfx` no longer destroys its images.** Zip assets are bound into `resources.images[id].data` on open, so the autosave re-packs every asset (the old blob-URL rebind produced a bundle with zero assets and dead `blob:` links).
- **Rich text and links render.** Bold/italic/colour runs and internal/external links were flattened to plain text whenever a document was loaded; they now render in the same markup as jdf.js while staying double-click editable.
- Cmd+Z / Cmd+S / Cmd+F while typing in the JSON view, a form field or an inline editor no longer trigger document undo / Save As / search. Arrow keys inside `<select>` no longer flip pages.
- Malformed JSON committed from the JSON view (`pages: 5`, page without `elements`, missing `meta`) is normalised or rejected instead of crashing the viewer and being autosaved.
- Header/footer elements are editable — edits addressed the non-existent path `["__hf__", …]` and were dropped while still creating undo entries.
- No-op mutations (move-up on the first element, undo with an empty stack) no longer mark the document dirty or add history entries.
- Pending autosave is flushed before another file is opened (the last edit to the previous file was lost).
- Table header edits on tables that define headers via `columns[*].header` write to the right place; empty headers no longer shift column indices.
- Search tolerates `null` table cells / non-array rows (same leniency as the renderers).
- Scroll-based page detection works under zoom and no longer snaps the viewport back to the page top; zoom uses CSS `zoom` so the left edge stays reachable and the scroll area grows with the pages (Markdown view too).
- Signature pad strokes land under the cursor at any zoom.
- `resources.images[*].path` images load through Tauri's asset protocol.
- Print outputs the whole document, not just the visible viewport.

### Fixed — jdf.js
- Opening a `.jdfx` binds assets into `resources.images` instead of `blob:` URLs, so `viewer.exportJdf()` / `downloadJdf()` keep the images.

### Added — PDF import (shared by reader + CLI, `@jdf/pdf-import`)
- **Form XObject transforms.** Content placed with `Do` (logos, headers, InDesign/Word artwork) now honours its `/Matrix`; previously it landed at the wrong position or off-page.
- **Per-word text colour by position.** Text items are matched to the operator that painted them instead of by index, which drifted as soon as PDF.js merged two runs. Measured against rendered pixels on a mixed corpus: 401→555 of 563 correct (SoW), 79→100 of 128 (sign-off form), 2024→2835 of 2986 (77-page AWS guide).
- **Images**: inline images (`BI … EI`), 1-bit stencil masks painted in the current fill colour, repeated XObjects (`paintImageXObjectRepeat`), ImageBitmap fallback. Node runtime gains `DOMMatrix` / `Path2D` / `ImageData` polyfills from `@napi-rs/canvas`, so `page.render()` no longer fails silently on pages with clips or gradients — images on those pages were missing from CLI output (sample.pdf: 2 → 14 image placements).
- **Gradient fills** (axial/radial shading patterns) become their average colour instead of inheriting the previous solid colour.
- **Internal links** resolve destinations to `#page-N`; external links unchanged.
- **Bookmarks/outline** promote matching text to headings with `tocEntry` / `tocLevel`.
- **Document info** → `meta.author`, `created`, `modified`, `keywords`, `language`.
- **Encrypted PDFs**: `password` / `onPassword` options; CLI `--password <pw>`; the reader shows a password prompt (retries on a wrong password).
- **Scanned PDFs**: invisible OCR text (rendering mode 3) is kept with `opacity: 0` so search / `jdf chunk` / `jdf embed` see the words; CLI `--drop-invisible-text` restores the old behaviour. Clip-only text (mode 7) is dropped.
- Annotation appearance streams are excluded from the operator walk (form widgets are emitted from `getAnnotations()` already), removing duplicated widget borders and text-colour misalignment on filled forms.
- Node runtime passes `standardFontDataUrl` / `cMapUrl`, so non-embedded standard fonts and CJK CMaps resolve without warnings. `stopAtErrors: false` and `isOffscreenCanvasSupported: false` are set explicitly for lenient, host-independent output.

### Changed — release tooling
- `scripts/publish-dmg.sh` notarizes and staples **the dmg itself** (`notarytool submit --wait` + `stapler staple`), verifies with `spctl`, and computes the Cask sha256 *after* stapling. Tauri only notarized the `.app` inside; the dmg container was "Unnotarized Developer ID", which is what produced the "Apple could not verify… / Move to Trash" dialog for direct downloads and `brew install --cask jdf`.
- Tauri: `protocol-asset` feature + `assetProtocol` enabled for `path`-backed image resources.

## [0.1.25] — 2026-09-01
- Signed + notarized release; Homebrew tap install for `jdf-cli` documented; Cargo.lock synced.

## [0.1.24] — 2026-08-31
- PDF import: correct CTM composition order for nested transforms (`cm` prepends) — images/shapes were sent off-page by nested matrices.
- First Developer ID signed + notarized dmg; the Cask's `xattr -cr` workaround was removed.
- Presentation deck and contributor avatars on the docs site.

## [0.1.23] / [0.1.22] — 2026-07-05 … 07-06
- RAG in the CLI: `jdf chunk` (deterministic; section/element/fixed; jsonl/json/inline) and `jdf embed` (Ollama default, OpenAI optional, `--incremental`). Optional top-level `index` block in the schema.
- Table column widths and per-cell `align` / `style` across jdf.js, reader and Rust export.
- Rust PDF export: word-wrap, real table grid, `measure_element`, `flow` auto-pagination (`page.flow` / `meta.flow`).
- CLI Markdown importer at parity with the reader's `pulldown_cmark` path (richtext, table, blockquote, nested list, hr).
- jdf.js `renderTable` tolerates non-array rows / null cells (a null cell used to abort the whole page render on the web only).
- Docs: CLI page, format pages, landing showcase for RAG.

## [0.1.21] / [0.1.20] — 2026-06-24
- JDF Forms: `input`, `textarea`, `checkbox`, `select`, `signature` in all surfaces; PDF AcroForm widgets import as form elements with their values; `viewer.exportJdf()` / `downloadJdf()` in jdf.js.
- `.jdfx` zip bundle (document.json + manifest + assets) in reader, jdf.js and CLI; `--json` to force inline output.
- `jdf convert` as the headline verb (`jdf import` kept as alias); `jdf convert file.json` for LLM/agent output.
- Wording/rebranding pass on README and site; Homebrew install flow.

## [0.1.16] … [0.1.19] — 2026-06-15 … 06-21
- jdf.js `<jdf src>` custom element with auto-init, MutationObserver-based discovery, sidebar/toolbar/dark-mode attributes; npm publish as `@uurtech/jdf`.
- Docs site on GitHub Pages; landing demos; multi-OS release workflow.

## [0.1.4] … [0.1.8] — 2026-06-12
- Reader: fixed double-click open, close button, margin-vs-absolute page layout.
- Edit-in-place (double-click any text, list item, table cell, collapsible title, image src/alt) with autosave; live two-way JSON view; native Markdown viewer with GFM; welcome screen with recent files; sidebar thumbnails; search panel; help overlay.
- Header/footer elements and template variables (`{{pageNumber}}`, `{{title}}`, …); internal `#page-N` links; TOC navigation.
- PDF export honours `meta.pageSize` / `pageOrientation`, text colour, real TOC.
- JSON Schema (`spec/jdf-schema.json`) and CLI `validate`; renderer/type mismatches fixed (heading levels, ordered lists, richtext runs, table headers/borders, image `fit`, shape stroke objects).

## [0.1.0] — 2026-06-10
- Initial release: JDF format spec, Tauri viewer, PDF/Markdown import, PDF export, search/sidebar/zoom/dark mode, file associations.
