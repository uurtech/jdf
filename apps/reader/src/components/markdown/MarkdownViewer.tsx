import { createMemo } from "solid-js";
import { marked } from "marked";
import DOMPurify from "dompurify";

interface MarkdownViewerProps {
  content: string;
  zoom: number;
  searchQuery?: string;
}

marked.setOptions({ gfm: true, breaks: false });

// .md files are user-trusted but a malicious file could inject <script>,
// <img onerror>, or javascript: URLs that run in Tauri's privileged webview.
// Sanitise once after marked, before innerHTML. Allow http/https/mailto/
// data: img URLs but strip event handlers and javascript: schemes.
const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ["target", "rel"],
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
  RETURN_TRUSTED_TYPE: false as const,
};

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
      const safe = DOMPurify.sanitize(raw, PURIFY_CONFIG) as unknown as string;
      return props.searchQuery ? highlightHtml(safe, props.searchQuery) : safe;
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
