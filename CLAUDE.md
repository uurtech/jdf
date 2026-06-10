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
- `tools/jdf-cli` (`@jdf/cli`) — `src/index.ts` entry, `validate` (Ajv ile schema kontrolü) + `import` (md→jdf, pdf placeholder).
- `spec/jdf-schema.json` — JSON Schema (draft-07) tüm element tipleri + style + resources tanımlı.
- `spec/examples/hello-world.jdf` — heading, richtext, list, table, collapsible, toc, footer template'i içeren demo.
- `apps/viewer/src/components/markdown/MarkdownViewer.tsx` — `marked` ile native MD render (paged JDF view ile toggle).

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

## Bilinen eksikler / hâlâ todo (2026-06-10 sonrası)

**Hâlâ açık olanlar:**
- PDF import: image/table çıkarımı yok (pdf-extract crate'i sınırlı; roadmap todo).
- WYSIWYG editor mode — JSON görünür ama UI'dan düzenleme henüz yok.
- Windows/Linux build & CI/CD — GitHub Actions yok.
- Test yok (TS/Rust/e2e).
- VS Code extension, online viewer — roadmap todo.
- `packages/jdf-core/package.json` minimal (description/repository/license/author yok).

**Çözülen (önceki turda kapatıldı):**
- `spec/jdf-schema.json` ve `spec/examples/hello-world.jdf` ✅
- CLI'ın `package.json`/entry/validate/import komutları ✅
- Renderer ↔ types uyuşmazlıkları (heading, list ordered, richtext bold/italic/link, table headers/borders/altRow, image src+resource+fit, header/footer template, shape stroke object) ✅
- `export_pdf` artık list/table/collapsible/shape de basıyor (image/toc placeholder kalıyor) ✅
- `import_markdown` Rust tarafında: tablo, blockquote, link, image, hr, GFM, strikethrough/tasklist desteği ✅
- `validate_document` element-level şema kontrolü ve warning ayrımı ✅

**UX düzeltmeleri (önceki turda kapatıldı):**
- WelcomeScreen: recent files listesi, drag-drop hint, dark/help shortcuts.
- Sidebar: thumbnail preview (her sayfa içeriğinin renkli mini-haritası), aktif sayfa highlight.
- SearchPanel: regex'siz multi-match per element, vurgulu before/match/after, keyboard nav.
- Toolbar: close button (⌘W), modified indicator, file type chip, dark/help butonları, MD↔Paged view toggle.
- HelpOverlay: `?` ile kısayol panosu (üç sütun: File / View / Navigate).
- Dark mode: tüm renkler tutarlı (`@custom-variant dark`), markdown body için ayrı kurallar.
- MarkdownViewer: tek scroll'lu native render, GFM tablo/code/blockquote/task list, dark mode uyumlu.
- Print CSS: aside ve toolbar gizli, gölgesiz sayfa.

## Çalışma tercihleri

- Konuşma dili **Türkçe**. Kod, commit mesajları, dosya/komut/teknik terimler İngilizce kalır.
- Solo-maintainer pragmatizmi: enterprise süreçleri yerine "çalışsın, basit kalsın".
- README'nin parlak vaadi ile gerçek kod arasındaki farkı açık tut — yeni feature isteklerinde önce hangi temel parçanın eksik olduğunu sor.
