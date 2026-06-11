# JDF — Claude maintenance rules

This file is project-specific guidance for Claude (or any maintainer) when working on this repo. Follow the parity rules below or you will silently break the rest of the ecosystem.

## The repo is a 4-arm thing

JDF lives in **four runnable surfaces** that all consume the same JSON format. They MUST stay in feature parity.

```
┌──────────────────────┐    ┌─────────────────────────┐
│ packages/jdf-core    │    │ spec/jdf-schema.json    │
│  - TypeScript types  │    │  - JSON Schema spec      │
│  - mm/in/pt/px utils │    │  - source of truth        │
│  - page sizes        │    │                          │
└──────────────────────┘    └─────────────────────────┘
            │ imported by all four arms below
            ▼
┌────────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────────┐
│ apps/reader/   │ │ jdfjs/       │ │ tools/jdf-cli│ │ src-tauri/     │
│ (desktop app)  │ │ (web embed)  │ │ (validate +  │ │ (Rust backend, │
│ SolidJS render │ │ vanilla DOM  │ │  import)     │ │  PDF export)   │
└────────────────┘ └──────────────┘ └──────────────┘ └────────────────┘
```

## Hard parity rules

### When you ADD a new element type or attribute to the JDF format

Update **all five** locations in the same PR. Skipping any one creates silent divergence:

| # | File | What to add |
|---|---|---|
| 1 | `packages/jdf-core/src/types.ts` | TypeScript interface for the new element / field |
| 2 | `spec/jdf-schema.json` | JSON Schema definition with required / optional fields |
| 3 | `apps/reader/src/components/viewer/<Type>Element.tsx` | SolidJS renderer used by the desktop app |
| 4 | `jdfjs/src/renderers/element.ts` | Vanilla-DOM renderer used by the web embed |
| 5 | `apps/reader/src-tauri/src/commands/mod.rs` | Two functions: `extract_text` (for search) and `draw_element` (for PDF export) |

If the element appears in PDF imports, also walk:

| # | File | What to add |
|---|---|---|
| 6 | `apps/reader/src/import/pdfToJdf.ts` | PDF.js → JDF mapping for the new element |

### When you change a renderer behaviour (style, layout, spacing)

The desktop renderer (`apps/reader/src/components/viewer/`) and the web renderer (`jdfjs/src/renderers/element.ts`) **must end up with the same visual output**. They are independent codebases — one is SolidJS, the other vanilla DOM — but the rendered pixels should match within reasonable tolerance.

Steps:

1. Make the change in one renderer.
2. **Immediately** mirror it in the other.
3. Add a sample to `spec/examples/` that exercises the change.
4. Run both renderers against the sample (desktop: `pnpm tauri dev`, web: open `docs/examples/<name>.jdf` in the live site).

### When you change the PDF importer

The PDF importer lives in `apps/reader/src/import/pdfToJdf.ts` (frontend, browser-only, uses canvas for image extraction). It is the **single source of truth** for PDF→JDF.

If you ever extract this into a shared package (`packages/jdf-pdf-import/`), keep it there and have all consumers (desktop, CLI) import from one place. **Never duplicate the converter logic.**

### When you bump the JDF format version (`$jdf` field)

1. Bump `version` in `packages/jdf-core/package.json`.
2. Update `$jdf` field in `spec/examples/*.jdf` and `docs/examples/*.jdf`.
3. Update the example in `README.md`.
4. Document the breaking change in `CHANGELOG.md`.
5. Update the schema's `$id` URL.

## CLI commands (`tools/jdf-cli`)

The CLI must accept anything the desktop reader accepts:

| Command | Status | Path |
|---|---|---|
| `jdf validate <file.jdf>` | ✓ done | `tools/jdf-cli/src/commands/validate.ts` |
| `jdf import file.md` | ✓ done | `tools/jdf-cli/src/commands/import-md.ts` |
| `jdf import file.pdf` | ⏳ planned (currently placeholder) | `tools/jdf-cli/src/commands/import-pdf.ts` |

When implementing PDF import in the CLI:
- The frontend importer (`apps/reader/src/import/pdfToJdf.ts`) uses the browser DOM canvas. The CLI version needs `node-canvas` or a headless equivalent.
- Extract the shared logic into `packages/jdf-pdf-import/` with two entry points: `browser.ts` (canvas-based) and `node.ts` (node-canvas-based). Don't fork the algorithm.

## Web embed: `<jdf>` only

The single supported embed form is `<jdf src="..."></jdf>`. The library:

- Auto-init scans the page on `DOMContentLoaded` and on every DOM mutation.
- Custom element `<jdf>` is registered with reactive `src`, `width`, `height`, `zoom` attributes.
- Configuration via attributes: `width`, `height`, `zoom`, `sidebar`, `toolbar`, `dark-mode`, `page`, `fit`.

Do not add `<jdf-viewer>` or `data-jdf` variants — kullanıcı kararı, `<jdf>` tek form.

## Build & test before any release

```bash
pnpm typecheck          # TS across reader, jdfjs, jdf-cli
cd apps/reader/src-tauri && cargo check
pnpm --filter jdfjs build
pnpm --filter @jdf/cli start validate spec/examples/hello-world.jdf
```

If any of these fail, do not push.

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
- **Don't put `unpkg.com/jdfjs` URLs in HTML before npm publish succeeded.** The CDN 404s, demos break.
- **Don't commit `.env`.** It's gitignored along with `.env.example` (intentional — example contains placeholder secrets the user fills in locally).
- **Don't rename `apps/reader/` lightly.** It will cascade through Cargo.toml, Tauri config, lib name, DMG asset name, and every script path.
