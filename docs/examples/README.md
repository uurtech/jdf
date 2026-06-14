# Example documents

Sample files used by the documentation site for live `<jdf>` embeds and by the desktop reader for PDF import demos.

| File | Type | Use |
|---|---|---|
| `hello-world.jdf` | JDF | Minimal example — heading, list, table, collapsible, TOC. Embedded in [Getting started](../docs/getting-started.html) and [Live examples](../docs/embed/examples.html). |
| `invoice.jdf` | JDF | Real-world layout — multi-column, styled table, totals box. |
| `article.jdf` | JDF | Multi-page article with footer template, headings, code block. |
| `sample.pdf` | PDF | A real PDF for testing the desktop reader's PDF import. ~85 KB. |

## Embed any of these in your own page

```html
<link rel="stylesheet" href="https://unpkg.com/@uurtech/jdf@0.1.11/dist/jdfjs.css">
<script type="module" src="https://unpkg.com/@uurtech/jdf@0.1.11"></script>

<jdf src="https://uurtech.github.io/jdf/examples/hello-world.jdf"></jdf>
```

> **Note:** `<jdf src="*.pdf">` is **not** supported by jdf.js — the web library renders JDF only. To convert a PDF to JDF, open it in the [JDF Reader desktop app](../docs/desktop.html) (drag the file in, hit `Cmd+S` to save as `.jdf`).
