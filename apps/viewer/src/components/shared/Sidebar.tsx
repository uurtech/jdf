import { For, createMemo } from "solid-js";
import type { JdfDocument } from "@jdf/core";

interface SidebarProps {
  document: JdfDocument;
  currentPage: number;
  onPageChange: (page: number) => void;
}

interface PreviewElement { type: string; top: number; left: number; width: number; height: number; color?: string }

function previewForPage(page: JdfDocument["pages"][number], pageW: number, pageH: number): PreviewElement[] {
  const out: PreviewElement[] = [];
  for (const el of page.elements) {
    const x = (el as any).position?.x ?? 0;
    const y = (el as any).position?.y ?? 0;
    const w = (el as any).width ?? pageW * 0.6;
    let h = (el as any).height ?? 4;
    let color = "#cbd5e1";
    switch (el.type) {
      case "text":
        h = (el as any).heading ? 8 : Math.max(((el as any).content?.length || 0) / 60 * 4, 4);
        color = (el as any).heading ? "#475569" : "#cbd5e1";
        break;
      case "richtext": h = 4; color = "#cbd5e1"; break;
      case "image": h = (el as any).height || 30; color = "#94a3b8"; break;
      case "table": h = ((el as any).rows?.length || 1) * 4; color = "#94a3b8"; break;
      case "list": h = ((el as any).items?.length || 1) * 3; color = "#cbd5e1"; break;
      case "shape": color = (el as any).fill || "#cbd5e1"; break;
      case "collapsible": h = 6; color = "#cbd5e1"; break;
      case "toc": h = 30; color = "#cbd5e1"; break;
    }
    out.push({ type: el.type, top: (y / pageH) * 100, left: (x / pageW) * 100, width: (w / pageW) * 100, height: (h / pageH) * 100, color });
  }
  return out;
}

export function Sidebar(props: SidebarProps) {
  const previews = createMemo(() => {
    const pageW = 166, pageH = 247;
    return props.document.pages.map((p) => previewForPage(p, pageW, pageH));
  });

  return (
    <aside class="w-44 bg-gray-50 dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 overflow-y-auto shrink-0 transition-colors">
      <div class="px-2 py-2 text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">
        Pages · {props.document.pages.length}
      </div>
      <div class="p-2 space-y-2">
        <For each={props.document.pages}>
          {(page, index) => (
            <button
              class={`w-full rounded-md border-2 transition-all overflow-hidden block ${
                index() === props.currentPage
                  ? "border-blue-500 shadow-md ring-2 ring-blue-500/20"
                  : "border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600"
              }`}
              onClick={() => props.onPageChange(index())}
            >
              <div
                class="w-full aspect-[210/297] relative overflow-hidden"
                style={{ "background-color": page.background || "#ffffff" }}
              >
                <For each={previews()[index()]}>
                  {(el) => (
                    <div
                      style={{
                        position: "absolute",
                        top: `${el.top}%`,
                        left: `${el.left}%`,
                        width: `${Math.min(el.width, 100 - el.left)}%`,
                        height: `${Math.min(el.height, 100 - el.top)}%`,
                        "background-color": el.color,
                        "border-radius": "1px",
                        opacity: "0.6",
                      }}
                    />
                  )}
                </For>
              </div>
              <div class={`text-[10px] py-1 font-mono text-center ${index() === props.currentPage ? "bg-blue-500 text-white" : "bg-white dark:bg-slate-900 text-gray-400 dark:text-gray-500"}`}>
                {index() + 1}
              </div>
            </button>
          )}
        </For>
      </div>
    </aside>
  );
}
