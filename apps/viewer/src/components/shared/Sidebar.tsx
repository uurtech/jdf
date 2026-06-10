import { For } from "solid-js";
import type { JdfDocument } from "@jdf/core";

interface SidebarProps {
  document: JdfDocument;
  currentPage: number;
  onPageChange: (page: number) => void;
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside class="w-48 bg-gray-50 border-r border-gray-200 overflow-y-auto shrink-0">
      <div class="p-3 space-y-2">
        <For each={props.document.pages}>
          {(page, index) => (
            <button
              class={`w-full rounded-lg border-2 transition-all overflow-hidden ${
                index() === props.currentPage
                  ? "border-blue-500 shadow-sm"
                  : "border-gray-200 hover:border-gray-300"
              }`}
              onClick={() => props.onPageChange(index())}
            >
              <div
                class="w-full aspect-[3/4] flex items-center justify-center"
                style={{
                  "background-color": page.background || "#ffffff",
                }}
              >
                <span class="text-[10px] text-gray-400 font-mono">
                  {index() + 1}
                </span>
              </div>
            </button>
          )}
        </For>
      </div>
    </aside>
  );
}
