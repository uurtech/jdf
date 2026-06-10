import { createSignal, For } from "solid-js";
import type { JdfDocument } from "@jdf/core";

interface SearchPanelProps {
  document: JdfDocument;
  onNavigate: (pageIndex: number) => void;
  onClose: () => void;
}

interface SearchResult {
  pageIndex: number;
  text: string;
}

export function SearchPanel(props: SearchPanelProps) {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<SearchResult[]>([]);

  function search(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const lower = q.toLowerCase();
    const found: SearchResult[] = [];

    props.document.pages.forEach((page, pageIdx) => {
      for (const el of page.elements) {
        const text = "content" in el ? String((el as any).content || "") : "";
        if (text.toLowerCase().includes(lower)) {
          found.push({ pageIndex: pageIdx, text: text.slice(0, 80) });
        }
      }
    });

    setResults(found);
  }

  return (
    <div class="absolute top-12 right-4 w-80 bg-white border border-gray-200 rounded-lg shadow-xl z-40 overflow-hidden">
      <div class="flex items-center gap-2 p-3 border-b border-gray-100">
        <input
          type="text"
          placeholder="Search document..."
          value={query()}
          onInput={(e) => search(e.currentTarget.value)}
          class="flex-1 text-sm px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:border-blue-400"
          autofocus
        />
        <button
          onClick={props.onClose}
          class="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
        >
          &times;
        </button>
      </div>
      <div class="max-h-64 overflow-y-auto">
        <For each={results()}>
          {(result) => (
            <button
              class="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-0"
              onClick={() => props.onNavigate(result.pageIndex)}
            >
              <span class="text-xs text-blue-600 font-medium">
                Page {result.pageIndex + 1}
              </span>
              <p class="text-xs text-gray-600 truncate mt-0.5">{result.text}</p>
            </button>
          )}
        </For>
        {query() && results().length === 0 && (
          <p class="px-3 py-4 text-xs text-gray-400 text-center">No results found</p>
        )}
      </div>
    </div>
  );
}
