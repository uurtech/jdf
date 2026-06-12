# Contributing to JDF

Thanks for considering a contribution. JDF is a small but ambitious project — every PR matters.

## Development setup

```bash
git clone https://github.com/uurtech/jdf.git
cd jdf
pnpm install
pnpm dev          # frontend hot-reload (Vite)
pnpm tauri        # full desktop app
```

Prerequisites:
- Node.js 20+
- pnpm 9+
- Rust (latest stable)
- macOS: Xcode Command Line Tools

## Project layout

```
spec/                 — JSON Schema + example .jdf files
packages/jdf-core/    — shared TypeScript types
apps/reader/          — Tauri v2 desktop app
  src/                — SolidJS frontend
  src-tauri/          — Rust backend (PDF/MD parse, export)
tools/jdf-cli/        — validate/import CLI
```

## Before opening a PR

1. **Type-check everything**: `pnpm typecheck` (covers `apps/reader` and `tools/jdf-cli`).
2. **Compile Rust**: `cd apps/reader/src-tauri && cargo check`.
3. **Validate the spec changes round-trip**: if you've touched the format, run `pnpm --filter @uurtech/jdf-cli start validate spec/examples/hello-world.jdf` and make sure it still passes.
4. Keep the diff focused. One feature or fix per PR.
5. Don't commit `.DS_Store`, `dist/`, `target/`, or anything in `.gitignore`.

## Where to start

Easy:
- New element renderer styles, edge cases in tables/lists.
- More example `.jdf` files in `spec/examples/`.
- Better PDF import heuristics (`apps/reader/src-tauri/src/commands/mod.rs::text_to_jdf`).

Medium:
- PDF export improvements (image embed, multi-page overflow, TOC pagination).
- Element insertion/deletion in the visual editor.
- VS Code extension scaffolding.

Hard / planned:
- WYSIWYG editor for element structure (insert / move / delete).
- True image extraction from PDF (`pdf-extract` only gives text).
- Windows/Linux build & GitHub Actions CI/CD.
- Web-based viewer (`apps/web`).

## Format changes

If you change the JDF format itself:

1. Update `packages/jdf-core/src/types.ts`.
2. Update `spec/jdf-schema.json` to match.
3. Bump the `$jdf` version in `spec/examples/hello-world.jdf` and document the breaking change.
4. Update the relevant renderer in `apps/reader/src/components/viewer/`.
5. Update `apps/reader/src-tauri/src/commands/mod.rs` (search `extract_text`, `export_pdf`).
6. Add an example to `spec/examples/`.

## Coding style

- TypeScript: strict mode, no `any` unless necessary.
- SolidJS: prefer `createSignal` + `createMemo`; avoid effects for derived state.
- Rust: `cargo fmt`, idiomatic error handling with `?` and `Result<_, String>` for Tauri commands.
- Keep components small. The `viewer/` element renderers should stay <100 lines each.

## License

By contributing you agree your code will ship under the [MIT License](LICENSE).
