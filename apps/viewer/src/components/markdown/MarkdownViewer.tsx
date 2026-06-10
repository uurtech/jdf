import { createMemo } from "solid-js";
import { marked } from "marked";

interface MarkdownViewerProps {
  content: string;
  zoom: number;
}

marked.setOptions({ gfm: true, breaks: false });

export function MarkdownViewer(props: MarkdownViewerProps) {
  const html = createMemo(() => {
    try {
      return marked.parse(props.content) as string;
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
