import { For, createMemo } from "solid-js";
import type { TocElement, Style, JdfDocument, Page, TextElement } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";

interface TocElementViewProps {
  element: TocElement;
  styles: Record<string, Style>;
  document?: JdfDocument;
  onNavigatePage?: (pageIndex: number) => void;
}

interface TocEntry {
  title: string;
  pageIndex: number;
  level: number;
}

function entryLevel(el: TextElement): number {
  if (typeof el.tocLevel === "number") return el.tocLevel;
  if (typeof el.heading === "number") return el.heading;
  return 1;
}

export function TocElementView(props: TocElementViewProps) {
  const css = () => resolveStyle(props.element.style, props.styles);
  const depth = () => props.element.depth ?? 6;

  const entries = createMemo<TocEntry[]>(() => {
    if (!props.document) return [];
    const result: TocEntry[] = [];
    props.document.pages.forEach((page: Page, pageIdx: number) => {
      for (const el of page.elements) {
        if (el.type !== "text") continue;
        const t = el as TextElement;
        const title = t.tocEntry || (t.heading ? t.content : null);
        if (!title) continue;
        const level = entryLevel(t);
        if (level > depth()) continue;
        result.push({ title, pageIndex: pageIdx, level });
      }
    });
    return result;
  });

  return (
    <div style={css()}>
      <For each={entries()}>
        {(entry) => (
          <button
            class="w-full flex items-baseline gap-2 py-1.5 border-b border-dotted border-gray-200 last:border-0 text-left hover:bg-blue-50 px-2 -mx-2 rounded transition-colors"
            style={{ "padding-left": `${(entry.level - 1) * 16 + 8}px` }}
            onClick={() => props.onNavigatePage?.(entry.pageIndex)}
            type="button"
          >
            <span class="text-gray-700 flex-1 text-sm">{entry.title}</span>
            <span class="flex-1 border-b border-dotted border-gray-300 self-end mb-1" />
            <span class="text-gray-400 text-xs shrink-0 font-mono">{entry.pageIndex + 1}</span>
          </button>
        )}
      </For>
    </div>
  );
}
