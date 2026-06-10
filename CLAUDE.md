# JDF — Claude Notes

Bu dosya repo'ya özgü kalıcı notları tutar. Konuşmalar arası referans için.

## Proje özeti

**JDF (JSON Document Format)** — PDF alternatifi olarak konumlandırılmış, JSON tabanlı human-readable / git-friendly belge formatı. Manifest: PDF binary ve opaque; JDF düz JSON, `JSON.stringify()` ile üretilir, VS Code'da editlenir, diff'lenir.

Yaratıcı/maintainer: **Ugur Kazdal** (`@uurtech`). Solo proje, MIT, GitHub: `https://github.com/uurtech/jdf`. Homebrew tap: `uurtech/jdf` (canlı olduğu doğrulanmadı).

## Repo yapısı (pnpm monorepo)

- `packages/jdf-core` (`@jdf/core`) — sadece TS types + page-size/unit util (defaults.ts). Build adımı yok, `src/index.ts` doğrudan export.
- `apps/viewer` (`@jdf/viewer`) — Tauri v2 + SolidJS + Tailwind v4 desktop app.
  - Frontend: `src/App.tsx`, `components/viewer/*` (element renderer'ları), `components/shared/*` (Toolbar, Sidebar, SearchPanel, WelcomeScreen).
  - Backend: `src-tauri/src/commands/mod.rs` — Tauri commands: `open_document`, `save_document`, `validate_document`, `search_document`, `import_pdf`, `import_markdown`, `export_pdf`.
  - Rust deps: `tauri 2`, `tauri-plugin-dialog/fs`, `pdf-extract 0.7`, `printpdf 0.7`, `pulldown-cmark 0.12`, `libc` (stderr suppress).
- `tools/jdf-cli` — şu an sadece `src/commands/import-md.ts` (package.json/entry yok — bkz. eksikler).
- `spec/` — boş (schema/examples yok — bkz. eksikler).

## Format konvansiyonları

- Pozisyon birimi **mm**, font boyutu **pt**.
- A4 content area: 166mm × 247mm (default 22/25mm margin'larla).
- Element tipleri: `text`, `richtext`, `image`, `table`, `list`, `shape`, `collapsible`, `toc`.
- Üst düzey alanlar: `$jdf`, `meta`, `styles`, `resources`, `header`, `footer`, `pages`.
- Viewer state: SolidJS `createSignal` + `localStorage` (recent files, dark mode).
- File açma: `tauri-plugin-dialog` + `tauri://drag-drop` event + CLI argv (lib.rs:20-32, 500ms gecikmeyle `open-file` event'i).

## Yeni element eklerken güncellenecek yerler

1. `packages/jdf-core/src/types.ts` — TS interface
2. `apps/viewer/src/components/viewer/ElementRenderer.tsx` — dispatch
3. `apps/viewer/src/components/viewer/XxxElement.tsx` — UI
4. `apps/viewer/src-tauri/src/commands/mod.rs` — `extract_text` (search için) + `export_pdf` (PDF render)
5. `spec/jdf-schema.json` — schema (henüz yok)

## Bilinen eksikler / boşluklar (2026-06-10)

**Spec katmanı:**
- `spec/jdf-schema.json` **yok**. README "JSON Schema with autocomplete" diye reklam ediyor.
- `spec/examples/` **boş** (`.DS_Store` hariç). README `hello-world.jdf` örneğinden bahsediyor; CLI komut örnekleri buna referans veriyor.

**CLI (`tools/jdf-cli/`) tamamen kırık:**
- `package.json` yok.
- `src/index.ts` (entry) yok.
- README'deki `npx tsx src/index.ts validate/import` komutları **çalışmaz**.
- `validate` ve PDF `import` komutları implement edilmemiş; sadece `import-md.ts` var.

**Kod tarafı:**
- `export_pdf` (`commands/mod.rs:77`) yalnızca `text` + `richtext` basıyor; `image`/`table`/`list`/`shape`/`collapsible`/`toc` PDF export'ta sessizce atlanıyor.
- `validate_document` çok yüzeysel — sadece `$jdf`/`meta`/`pages` varlığı, element-level şema doğrulaması yok.
- `import_pdf` text-only (pdf-extract crate'i image/table çıkaramaz; roadmap'te todo).

**Test/CI:**
- Hiç test yok (Rust unit, TS, e2e).
- GitHub Actions yok.

**Hijyen:**
- `.DS_Store` dosyaları repo içinde (`/.DS_Store`, `spec/.DS_Store`, `spec/examples/.DS_Store`) — `.gitignore`'da listeli ama tracked olabilir. Kontrol: `git ls-files | grep DS_Store`.
- `packages/jdf-core/package.json` minimal (description/repository/license/author yok).

**Roadmap'te todo:** WYSIWYG editor, PDF→image/table extraction, Windows/Linux build, CI/CD, VS Code extension, online viewer.

## Çalışma tercihleri

- Konuşma dili **Türkçe**. Kod, commit mesajları, dosya/komut/teknik terimler İngilizce kalır.
- Solo-maintainer pragmatizmi: enterprise süreçleri yerine "çalışsın, basit kalsın".
- README'nin parlak vaadi ile gerçek kod arasındaki farkı açık tut — yeni feature isteklerinde önce hangi temel parçanın eksik olduğunu sor.
