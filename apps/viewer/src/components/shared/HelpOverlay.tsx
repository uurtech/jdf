import { For } from "solid-js";

interface HelpOverlayProps {
  onClose: () => void;
}

const SECTIONS: { title: string; rows: { keys: string[]; label: string }[] }[] = [
  {
    title: "File",
    rows: [
      { keys: ["⌘", "O"], label: "Open" },
      { keys: ["⌘", "S"], label: "Save as JDF" },
      { keys: ["⌘", "⇧", "E"], label: "Export PDF" },
      { keys: ["⌘", "W"], label: "Close document" },
      { keys: ["⌘", "P"], label: "Print" },
    ],
  },
  {
    title: "View",
    rows: [
      { keys: ["⌘", "F"], label: "Search" },
      { keys: ["⌘", "B"], label: "Toggle sidebar" },
      { keys: ["⌘", "D"], label: "Toggle dark mode" },
      { keys: ["⌘", "+"], label: "Zoom in" },
      { keys: ["⌘", "−"], label: "Zoom out" },
      { keys: ["⌘", "0"], label: "Reset zoom" },
    ],
  },
  {
    title: "Edit & Navigate",
    rows: [
      { keys: ["dbl-click"], label: "Edit element (.jdf only)" },
      { keys: ["Enter"], label: "Commit edit" },
      { keys: ["Esc"], label: "Cancel / close" },
      { keys: ["←"], label: "Previous page" },
      { keys: ["→"], label: "Next page" },
      { keys: ["?"], label: "Show this help" },
    ],
  },
];

export function HelpOverlay(props: HelpOverlayProps) {
  return (
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={props.onClose}>
      <div class="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-700">
          <h2 class="text-base font-semibold text-gray-800 dark:text-gray-100">Keyboard Shortcuts</h2>
          <button onClick={props.onClose} class="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-100 rounded hover:bg-gray-100 dark:hover:bg-slate-700">×</button>
        </div>
        <div class="grid grid-cols-3 gap-6 p-6">
          <For each={SECTIONS}>
            {(section) => (
              <div>
                <h3 class="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold mb-3">{section.title}</h3>
                <div class="space-y-2">
                  <For each={section.rows}>
                    {(row) => (
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-xs text-gray-600 dark:text-gray-300">{row.label}</span>
                        <div class="flex items-center gap-1">
                          <For each={row.keys}>
                            {(k) => (
                              <kbd class="px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 rounded font-mono text-[10px] min-w-[18px] text-center">
                                {k}
                              </kbd>
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
        <div class="px-6 py-3 bg-gray-50 dark:bg-slate-900/50 text-[11px] text-gray-400 text-center border-t border-gray-100 dark:border-slate-700">
          Press <kbd class="px-1 py-0.5 bg-white dark:bg-slate-700 rounded font-mono">Esc</kbd> or click outside to close
        </div>
      </div>
    </div>
  );
}
