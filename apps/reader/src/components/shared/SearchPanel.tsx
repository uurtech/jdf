import { createSignal, For, createMemo, onMount, onCleanup, Show } from "solid-js";
import type { JdfDocument, Element } from "@jdf/core";

interface SearchPanelProps {
  document: JdfDocument;
  mode: "jdf" | "markdown";
  markdownContent?: string;
  onNavigate: (pageIndex: number) => void;
  onMarkdownQueryChange?: (q: string) => void;
  onClose: () => void;
}

interface SearchResult {
  pageIndex: number;
  before: string;
  match: string;
  after: string;
}

interface MdResult {
  line: number;
  before: string;
  match: string;
  after: string;
}

function elementText(el: Element): string {
  if (el.type === "text") return (el as any).content || "";
  if (el.type === "richtext") return (el.runs || []).map((r) => r.text).join("");
  if (el.type === "list") {
    const walk = (items: any[]): string => items.map((i) => i.content + (i.children ? " " + walk(i.children) : "")).join(" ");
    return walk((el as any).items || []);
  }
  if (el.type === "table") {
    const cells = (el as any).rows?.flat().map((c: any) => typeof c === "string" ? c : c.content) || [];
    return [...((el as any).headers || []), ...cells].join(" ");
  }
  if (el.type === "collapsible") {
    return ((el as any).title || "") + " " + ((el as any).elements || []).map(elementText).join(" ");
  }
  return "";
}

export function SearchPanel(props: SearchPanelProps) {
  const [query, setQuery] = createSignal("");
  let inputRef!: HTMLInputElement;

  onMount(() => inputRef.focus());
  onCleanup(() => props.onMarkdownQueryChange?.(""));

  function setQ(q: string) {
    setQuery(q);
    if (props.mode === "markdown") props.onMarkdownQueryChange?.(q);
  }

  const jdfResults = createMemo<SearchResult[]>(() => {
    if (props.mode !== "jdf") return [];
    const q = query().trim();
    if (!q) return [];
    const lower = q.toLowerCase();
    const out: SearchResult[] = [];
    props.document.pages.forEach((page, pageIdx) => {
      for (const el of page.elements) {
        const text = elementText(el);
        const lt = text.toLowerCase();
        let from = 0;
        while (true) {
          const idx = lt.indexOf(lower, from);
          if (idx < 0) break;
          const start = Math.max(0, idx - 30);
          const end = Math.min(text.length, idx + q.length + 30);
          out.push({
            pageIndex: pageIdx,
            before: (start > 0 ? "…" : "") + text.slice(start, idx),
            match: text.slice(idx, idx + q.length),
            after: text.slice(idx + q.length, end) + (end < text.length ? "…" : ""),
          });
          from = idx + q.length;
          if (out.length > 200) return out;
        }
      }
    });
    return out;
  });

  const mdResults = createMemo<MdResult[]>(() => {
    if (props.mode !== "markdown" || !props.markdownContent) return [];
    const q = query().trim();
    if (!q) return [];
    const lower = q.toLowerCase();
    const out: MdResult[] = [];
    const lines = props.markdownContent.split("\n");
    lines.forEach((line, li) => {
      const ll = line.toLowerCase();
      let from = 0;
      while (true) {
        const idx = ll.indexOf(lower, from);
        if (idx < 0) break;
        const start = Math.max(0, idx - 30);
        const end = Math.min(line.length, idx + q.length + 30);
        out.push({
          line: li + 1,
          before: (start > 0 ? "…" : "") + line.slice(start, idx),
          match: line.slice(idx, idx + q.length),
          after: line.slice(idx + q.length, end) + (end < line.length ? "…" : ""),
        });
        from = idx + q.length;
        if (out.length > 200) return;
      }
    });
    return out;
  });

  const totalCount = () => props.mode === "markdown" ? mdResults().length : jdfResults().length;

  return (
    <div class="absolute top-14 right-4 w-96 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-2xl z-40 overflow-hidden">
      <div class="flex items-center gap-2 p-2.5 border-b border-gray-100 dark:border-slate-700">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" class="text-gray-400 ml-1 shrink-0">
          <circle cx="6" cy="6" r="4" />
          <line x1="9" y1="9" x2="12.5" y2="12.5" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          placeholder={props.mode === "markdown" ? "Search markdown…" : "Search document…"}
          value={query()}
          onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Escape") props.onClose(); }}
          class="flex-1 text-sm bg-transparent text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
        />
        <span class="text-[11px] text-gray-400 font-mono px-1">{totalCount()}</span>
        <button onClick={props.onClose} class="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-100 rounded hover:bg-gray-100 dark:hover:bg-slate-700">
          ×
        </button>
      </div>
      <div class="max-h-80 overflow-y-auto">
        <Show when={props.mode === "jdf"}>
          <For each={jdfResults()}>
            {(r) => (
              <button
                class="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-700/50 border-b border-gray-50 dark:border-slate-700/50 last:border-0 transition-colors"
                onClick={() => props.onNavigate(r.pageIndex)}
              >
                <span class="text-[10px] text-blue-600 dark:text-blue-400 font-medium uppercase tracking-wider">Page {r.pageIndex + 1}</span>
                <p class="text-xs text-gray-700 dark:text-gray-200 mt-0.5 leading-snug">
                  {r.before}
                  <mark class="bg-yellow-200 dark:bg-yellow-500/30 dark:text-yellow-100 rounded px-0.5">{r.match}</mark>
                  {r.after}
                </p>
              </button>
            )}
          </For>
        </Show>
        <Show when={props.mode === "markdown"}>
          <For each={mdResults()}>
            {(r) => (
              <div class="w-full text-left px-3 py-2 border-b border-gray-50 dark:border-slate-700/50 last:border-0">
                <span class="text-[10px] text-blue-600 dark:text-blue-400 font-medium uppercase tracking-wider">Line {r.line}</span>
                <p class="text-xs text-gray-700 dark:text-gray-200 mt-0.5 leading-snug">
                  {r.before}
                  <mark class="bg-yellow-200 dark:bg-yellow-500/30 dark:text-yellow-100 rounded px-0.5">{r.match}</mark>
                  {r.after}
                </p>
              </div>
            )}
          </For>
        </Show>
        {query() && totalCount() === 0 && (
          <p class="px-3 py-6 text-xs text-gray-400 text-center">No results</p>
        )}
        {!query() && (
          <p class="px-3 py-6 text-xs text-gray-400 text-center">Start typing to search</p>
        )}
      </div>
    </div>
  );
}
