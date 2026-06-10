# JDF — JSON Document Format

A human-readable, git-friendly document format that replaces PDF.

## Install

```bash
brew tap uurtech/jdf
brew install --cask jdf-viewer
```

Or build from source:
```bash
git clone https://github.com/uurtech/jdf.git
cd jdf && pnpm install && pnpm dev
```

## What is JDF?

JDF files are plain JSON. Open them in any text editor — you see clean structure. Open them in JDF Viewer — you see beautifully rendered pages.

| | PDF | JDF |
|---|---|---|
| Format | Binary | JSON |
| Edit | Adobe Acrobat | Any text editor |
| Git diffs | Useless | Meaningful |
| Viewer size | ~250MB | ~10MB |
| Interactive | No | Yes (collapsible, search, TOC) |

## Features

- Rich text, tables, lists, images, shapes, headers/footers
- PDF import — drag a PDF onto the viewer
- Markdown import — open .md files directly
- PDF export — save as PDF
- Full-text search (Cmd+F)
- Dark mode (Cmd+D)
- Collapsible sections, auto-generated TOC
- File association — double-click .jdf or .md to open

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+O | Open file |
| Cmd+S | Save as JDF |
| Cmd+Shift+E | Export PDF |
| Cmd+F | Search |
| Cmd+B | Toggle sidebar |
| Cmd+D | Dark mode |
| Cmd+P | Print |
| Cmd+=/- | Zoom |
| Arrow keys | Navigate pages |

## Tech Stack

Tauri v2 + SolidJS + Tailwind CSS + Rust

## License

MIT
