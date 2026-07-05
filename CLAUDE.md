# JDF — Claude maintenance rules

This file is project-specific guidance for Claude (or any maintainer) when working on this repo. Follow the parity rules below or you will silently break the rest of the ecosystem.

## ⚠️ THE THREE-SURFACE RULE — READ THIS FIRST

**Every new feature must ship in all three surfaces, in the same change set: CLI (`tools/jdf-cli`), jdf.js web embed (`jdfjs/`), and the desktop reader (`apps/reader/`). No exceptions.**

If a feature only lives in one surface, the JDF promise breaks: a `.jdf` produced by the CLI won't render in jdfjs, a form filled in jdfjs won't open correctly in the reader, a reader-only feature can't enter a CI pipeline. The format is the contract; every surface honors it identically.

When you add or change a feature, walk this checklist before declaring done:

1. **Schema + types** — `packages/jdf-core/src/types.ts` + `spec/jdf-schema.json` carry the new field.
2. **CLI** (`tools/jdf-cli`) — import, validate, and export paths all handle it. PDF/JSON/MD importers emit it where applicable.
3. **jdf.js** (`jdfjs/src/renderers/element.ts` + `viewer.ts`) — renders it in the browser; if it has user interaction, the in-memory document is mutated and `exportJdf()` reflects it.
4. **Desktop reader** (`apps/reader/src/components/viewer/` + `apps/reader/src/edit/`) — SolidJS renderer with the same DOM/look as jdf.js; user interaction routes through the edit/undo/autosave pipeline.
5. **Rust backend** (`apps/reader/src-tauri/src/commands/mod.rs`) — `validate_document.valid_types`, `extract_text` (search), and `draw_element` (PDF export) all handle the new type.
6. **Editor mutations** (`apps/reader/src/edit/mutations.ts`) — `makeBlankElement` arm so the user can insert one from the toolbar.
7. **Sample** — at least one fixture in `spec/examples/` exercises the change; copy to `docs/examples/` if it powers a landing demo.
8. **Docs** — `docs/docs/forms.html`-style page or section update; landing page mention if it's a headline feature.

If you add it to one surface and skip another, the assistant has failed the user. Code review for any change must verify every checklist item — silent omissions are the #1 source of bugs in this repo.

## The repo is a 4-arm thing

JDF lives in **four runnable surfaces** that all consume the same JSON format. They MUST stay in feature parity. PDF→JDF conversion lives in a fifth, shared package — both the desktop reader and the CLI import it.

```
┌──────────────────────┐  ┌─────────────────────────┐  ┌────────────────────────┐
│ packages/jdf-core    │  │ spec/jdf-schema.json    │  │ packages/jdf-pdf-import│
│  - TypeScript types  │  │  - JSON Schema spec     │  │  - PDF → JDF algorithm │
│  - mm/in/pt/px utils │  │  - source of truth      │  │  - browser + node ents │
│  - page sizes        │  │                         │  │  - SHARED: reader+CLI  │
└──────────────────────┘  └─────────────────────────┘  └────────────────────────┘
            │ imported by all four arms below
            ▼
┌────────────────┐ ┌──────────────┐ ┌────────────────────┐ ┌────────────────┐
│ apps/reader/   │ │ jdfjs/       │ │ tools/jdf-cli      │ │ src-tauri/     │
│ (desktop app)  │ │ (web embed)  │ │ validate +         │ │ (Rust backend, │
│ SolidJS render │ │ vanilla DOM  │ │ pdf/json/md→jdf    │ │  PDF export)   │
└────────────────┘ └──────────────┘ └────────────────────┘ └────────────────┘
```

**The CLI's job is two-fold and matters for the wider story:**

- **PDF → JDF** for legacy ingestion: RAG pipelines, CI gates, build steps consuming structured documents instead of binary PDFs. PDF AcroForm widgets become real JDF form elements with their values intact.
- **JSON → JDF** for AI workflows: LLMs and agents emit JSON; the CLI wraps it into a validated `.jdf` (or `.jdfx`) so the output is always renderable, diffable, and grep-able.

`jdf convert file.md` exists for convenience but is not the headline use-case.

**JDF Forms.** Five element types — `input`, `textarea`, `checkbox`, `select`, `signature` — make a JDF document fillable. jdf.js renders real `<input>`/`<textarea>`/`<select>`/canvas elements; every keystroke mutates the in-memory doc. `viewer.exportJdf()` / `viewer.downloadJdf()` returns the form-filled JSON as a blob the user can save. Reader and Rust PDF export render the same fields with the user's values. Same algorithm, three runtimes, one source of truth: the `.jdf` file.

## Hard parity rules

### When you ADD a new element type or attribute to the JDF format

Update **all six** locations in the same PR. Skipping any one creates silent divergence:

| # | File | What to add |
|---|---|---|
| 1 | `packages/jdf-core/src/types.ts` | TypeScript interface for the new element / field |
| 2 | `spec/jdf-schema.json` | JSON Schema definition with required / optional fields |
| 3 | `apps/reader/src/components/viewer/<Type>Element.tsx` | SolidJS renderer used by the desktop app |
| 4 | `jdfjs/src/renderers/element.ts` | Vanilla-DOM renderer used by the web embed |
| 5 | `apps/reader/src-tauri/src/commands/mod.rs` | Three functions: `validate_document` (`valid_types`), `extract_text` (for search), `draw_element` (for PDF export) |
| 6 | `apps/reader/src/edit/mutations.ts` | `makeBlankElement` arm so the user can insert one from the toolbar |

If the element appears in PDF imports, also walk:

| # | File | What to add |
|---|---|---|
| 6 | `packages/jdf-pdf-import/src/core.ts` | PDF.js → JDF mapping for the new element. Both reader and CLI pick this up automatically. |

### When you change a renderer behaviour (style, layout, spacing)

The desktop renderer (`apps/reader/src/components/viewer/`) and the web renderer (`jdfjs/src/renderers/element.ts`) **must end up with the same visual output**. They are independent codebases — one is SolidJS, the other vanilla DOM — but the rendered pixels should match within reasonable tolerance.

Steps:

1. Make the change in one renderer.
2. **Immediately** mirror it in the other.
3. Add a sample to `spec/examples/` that exercises the change.
4. Run both renderers against the sample (desktop: `pnpm tauri dev`, web: open `docs/examples/<name>.jdf` in the live site).

### When you change the PDF importer

The PDF→JDF algorithm lives in **`packages/jdf-pdf-import/src/core.ts`** — a single, runtime-agnostic implementation. Two thin entry points wrap it:

| Entry point | Used by | What it provides |
|---|---|---|
| `packages/jdf-pdf-import/src/browser.ts` | `apps/reader/` | DOM `<canvas>`, Tauri filesystem plugin for path inputs, modern `pdfjs-dist/build/pdf.mjs` with a real Web Worker. |
| `packages/jdf-pdf-import/src/node.ts` | `tools/jdf-cli/` | `@napi-rs/canvas` (Rust-native, no system deps), `node:fs/promises` for path inputs, `pdfjs-dist/build/pdf.mjs` with `disableWorker: true` (the legacy build prints a one-line warning we suppress on init). |

**Both entry points run the same `core.ts`** — same heuristics, same field outputs, same fonts, same colours. Reader and CLI must produce bit-identical JDF for the same PDF. If you tweak the algorithm, edit `core.ts` only; do not fork.

The reader's `apps/reader/src/import/pdfToJdf.ts` is now a one-line re-export of the browser entry point — keep it that way.

### When you bump the JDF format version (`$jdf` field)

1. Bump `version` in `packages/jdf-core/package.json`.
2. Update `$jdf` field in `spec/examples/*.jdf` and `docs/examples/*.jdf`.
3. Update the example in `README.md`.
4. Document the breaking change in `CHANGELOG.md`.
5. Update the schema's `$id` URL.

## CLI commands (`tools/jdf-cli`)

The CLI's two headline paths are **PDF → JDF** (for RAG / CI ingestion) and **JSON → JDF** (for AI / agent output wrapping). Markdown is a convenience.

The headline verb is **`jdf convert`**. `jdf import` stays registered as a
back-compat alias (same code path) so older scripts keep working; new docs and
examples use `convert`.

| Command | Status | Path |
|---|---|---|
| `jdf validate <file.jdf>` | ✓ done | `tools/jdf-cli/src/commands/validate.ts` |
| `jdf convert file.pdf` | ✓ done — uses `@jdf/pdf-import/node` | `tools/jdf-cli/src/commands/import-pdf.ts` |
| `jdf convert file.json` | ✓ done — full doc / element array / partial | `tools/jdf-cli/src/commands/import-json.ts` |
| `jdf convert file.md` | ✓ done | `tools/jdf-cli/src/commands/import-md.ts` |
| `jdf import …` | ✓ alias of `convert` (back-compat) | same handlers |

Flags:
- `-o, --output <path>` — explicit output path (extension picks `.jdf` vs `.jdfx`).
- `--json` — force pure-JSON `.jdf` output even when the document carries images. Useful for RAG pipelines and CI gates that prefer one text file over a zip bundle.

When you touch the CLI:

- **Never fork the PDF algorithm.** The CLI imports `@jdf/pdf-import/node`. If you need a behavioural change, edit `packages/jdf-pdf-import/src/core.ts` so the reader inherits it.
- **JSON imports must validate.** `import-json.ts` runs `validate()` after emit and exits non-zero on schema failure — that's how CI consumers gate model output. Don't remove that step.
- **Exit cleanly.** PDF.js leaves fake-worker timers on the loop after `getDocument`. The `import` switch ends every branch with `process.exit(0)` so the CLI returns control instead of hanging.

## Web embed: `<jdf>` only

The single supported embed form is `<jdf src="..."></jdf>`. The library:

- Auto-init scans the page on `DOMContentLoaded` and on every DOM mutation.
- Custom element `<jdf>` is registered with reactive `src`, `width`, `height`, `zoom` attributes.
- Configuration via attributes: `width`, `height`, `zoom`, `sidebar`, `toolbar`, `dark-mode`, `page`, `fit`.

Do not add `<jdf-viewer>` or `data-jdf` variants — kullanıcı kararı, `<jdf>` tek form.

## Build & test before any release

```bash
pnpm typecheck          # TS across reader, jdfjs, jdf-cli, jdf-pdf-import
cd apps/reader/src-tauri && cargo check
pnpm --filter @uurtech/jdf build   # jdf.js embed (package name is @uurtech/jdf, not "jdfjs")
pnpm --filter @uurtech/jdf-cli start validate spec/examples/hello-world.jdf
pnpm --filter @uurtech/jdf-cli start validate spec/examples/flow-report.jdf
pnpm --filter @uurtech/jdf-cli start convert spec/examples/sample.pdf -o /tmp/sample.jdf --json
pnpm --filter @uurtech/jdf-cli start validate /tmp/sample.jdf
```

The last two steps prove the PDF ingestion path is alive — sample.pdf must produce a schema-valid `.jdf`. If it doesn't, the reader will break on the same input. Do not push.

## Release pipeline (`scripts/`)

| Script | What it does |
|---|---|
| `scripts/release.sh [patch\|minor\|major]` | Full pipeline: bump versions everywhere, build dmg, build jdfjs, GitHub release with dmg, update Homebrew Cask, npm publish |
| `scripts/publish-npm.sh [bump]` | Just builds + publishes `jdfjs` to npm (subset of `release.sh`) |
| `scripts/publish-dmg.sh [bump]` | Builds dmg, creates GitHub release, updates Homebrew Cask (subset of `release.sh`) |

All scripts read tokens from `/.env` (root) — `NPM_TOKEN` and `GITHUB_TOKEN` are required. See `/.env.example`.

## Working language

User talks Turkish. Replies in Turkish. Code comments, file paths, commit messages, technical terms remain in English.

## Memory of past mistakes

- **Don't duplicate the renderer logic between SolidJS (`apps/reader/`) and vanilla DOM (`jdfjs/`).** They are intentionally separate codebases (different runtime constraints) but the JDF spec they implement is one. Diverging silently → render bugs only one platform sees.
- **Don't fork the PDF importer.** The reader and CLI both import `@jdf/pdf-import` and that's the only place the algorithm lives. Forking once breaks parity forever — output will diverge between desktop and CLI for the same PDF.
- **PDF.js callbacks can hang on node.** `commonObjs.get(name, cb)` and `objs.get(name, cb)` are fire-and-forget — if the resource isn't ready, the callback never fires. The core uses `setTimeout` fallbacks (~100ms for fonts, ~250ms for images) so a missing callback can't wedge a 1000-page document. Don't remove these without a replacement strategy.
- **Don't put `unpkg.com/jdfjs` URLs in HTML before npm publish succeeded.** The CDN 404s, demos break.
- **Don't commit `.env`.** It's gitignored along with `.env.example` (intentional — example contains placeholder secrets the user fills in locally).
- **Don't rename `apps/reader/` lightly.** It will cascade through Cargo.toml, Tauri config, lib name, DMG asset name, and every script path.
- **`flow` is a PDF-export layout concern, not a renderer feature.** `page.flow` (default `meta.flow`) makes the Rust exporter (`export_pdf` / `measure_element` in `commands/mod.rs`) lay elements out top-to-bottom and auto-paginate overflow. The HTML renderers (jdf.js + reader) still position elements absolutely by `position.y` — flow is intentionally export-only, like edit/IO. When you touch flow, keep `measure_element` in sync with `draw_element`'s wrap/line-height maths or the page breaks land in the wrong place. Fixture: `spec/examples/flow-report.jdf`.
- **CLI markdown parity is hand-maintained, not shared.** `tools/jdf-cli/src/commands/import-md.ts` (TS, regex-based) and the reader's `markdown_to_jdf` (Rust `pulldown_cmark`) are two implementations of one spec — like the two renderers. They must emit the same element set (richtext/table/blockquote/nested-list/hr). If you add a markdown feature to one, add it to the other.
