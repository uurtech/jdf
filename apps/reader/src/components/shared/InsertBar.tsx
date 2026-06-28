import { For } from "solid-js";
import type { Element } from "@jdf/core";
import { makeBlankElement } from "../../edit/mutations";

interface InsertBarProps {
  onInsert: (element: Element) => void;
}

const ITEMS: { type: Element["type"]; label: string; icon: string }[] = [
  { type: "text", label: "Text", icon: "T" },
  { type: "richtext", label: "Rich text", icon: "𝐁" },
  { type: "list", label: "List", icon: "≡" },
  { type: "table", label: "Table", icon: "⊞" },
  { type: "shape", label: "Shape", icon: "▢" },
  { type: "image", label: "Image", icon: "🖼" },
  { type: "collapsible", label: "Section", icon: "▶" },
  { type: "toc", label: "TOC", icon: "≣" },
];

export function InsertBar(props: InsertBarProps) {
  return (
    <div class="flex items-center gap-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-sm px-1 py-1">
      <span class="text-[9px] uppercase tracking-wider text-gray-400 px-1.5 font-semibold">Insert</span>
      <For each={ITEMS}>
        {(item) => (
          <button
            onClick={() => props.onInsert(makeBlankElement(item.type))}
            class="flex flex-col items-center px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors group"
            title={`Insert ${item.label}`}
          >
            <span class="text-base leading-none text-gray-700 dark:text-gray-200">{item.icon}</span>
            <span class="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5">{item.label}</span>
          </button>
        )}
      </For>
    </div>
  );
}
