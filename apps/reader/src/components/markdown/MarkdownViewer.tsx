import { createMemo } from "solid-js";
import { marked } from "marked";

interface MarkdownViewerProps {
  content: string;
  zoom: number;
  searchQuery?: string;
}

marked.setOptions({ gfm: true, breaks: false });

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightHtml(html: string, query: string): string {
  if (!query.trim()) return html;
  const re = new RegExp(`(${escapeRegex(query)})`, "gi");
  return html.replace(/(>)([^<]+)(<)/g, (_m, open, text, close) => {
    return open + text.replace(re, '<mark class="md-search-hit">$1</mark>') + close;
  });
}

export function MarkdownViewer(props: MarkdownViewerProps) {
  const html = createMemo(() => {
    try {
      const raw = marked.parse(props.content) as string;
      return props.searchQuery ? highlightHtml(raw, props.searchQuery) : raw;
    } catch (e) {
      return `<pre class="text-red-500 text-sm">Markdown parse error: ${String(e)}</pre>`;
    }
  });

  return (
    <div class="h-full overflow-auto bg-gray-100 dark:bg-slate-900 transition-colors">
      <div class="mx-auto py-10 px-6" style={{ "max-width": "820px", transform: `scale(${props.zoom})`, "transform-origin": "top center" }}>
        <article class="markdown-body bg-white dark:bg-slate-800 rounded-lg shadow-md p-10" innerHTML={html()} />
      </div>
    </div>
  );
}
