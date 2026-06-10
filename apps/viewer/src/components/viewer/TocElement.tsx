import { For, createMemo } from "solid-js";
import type { TocElement, Style, JdfDocument, Page } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";

interface TocElementViewProps {
  element: TocElement;
  styles: Record<string, Style>;
  document?: JdfDocument;
}

interface TocEntry {
  title: string;
  pageIndex: number;
  level: number;
}

export function TocElementView(props: TocElementViewProps) {
  const css = () => resolveStyle(props.element.style, props.styles);
  const depth = () => props.element.depth ?? 3;

  const entries = createMemo(() => {
    if (!props.document) return [];
    const result: TocEntry[] = [];

    props.document.pages.forEach((page: Page, pageIdx: number) => {
      for (const el of page.elements) {
        if ("tocEntry" in el && el.tocEntry) {
          result.push({
            title: el.tocEntry,
            pageIndex: pageIdx,
            level: 1,
          });
        } else if ("heading" in el && el.heading && "content" in el) {
          result.push({
            title: el.content,
            pageIndex: pageIdx,
            level: 1,
          });
        }
      }
    });

    return result.slice(0, depth() * 10);
  });

  return (
    <div style={css()}>
      <For each={entries()}>
        {(entry, idx) => (
          <div class="flex items-baseline gap-2 py-1 border-b border-dotted border-gray-200 last:border-0">
            <span class="text-gray-700 flex-1" style={{ "font-size": "inherit" }}>
              {entry.title}
            </span>
            <span class="text-gray-400 text-xs shrink-0">
              {entry.pageIndex + 1}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}
