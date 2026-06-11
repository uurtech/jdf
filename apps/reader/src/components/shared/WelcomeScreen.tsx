import { For, Show, createSignal, onMount, onCleanup } from "solid-js";

interface WelcomeScreenProps {
  recentFiles: string[];
  onOpen: () => void;
  onOpenPath: (path: string) => void;
  onClearRecent: () => void;
}

function basename(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

export function WelcomeScreen(props: WelcomeScreenProps) {
  const [dragging, setDragging] = createSignal(false);

  onMount(async () => {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      const enter = await listen("tauri://drag-enter", () => setDragging(true));
      const leave = await listen("tauri://drag-leave", () => setDragging(false));
      const drop = await listen("tauri://drag-drop", () => setDragging(false));
      onCleanup(() => { enter(); leave(); drop(); });
    } catch {}
  });

  return (
    <div class={`flex-1 flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-slate-900 dark:to-slate-800 transition-colors relative ${dragging() ? "ring-4 ring-blue-500/50 ring-inset" : ""}`}>
      <Show when={dragging()}>
        <div class="absolute inset-6 border-4 border-dashed border-blue-500 rounded-2xl flex items-center justify-center bg-blue-50/80 dark:bg-blue-900/20 z-10 pointer-events-none">
          <div class="text-blue-600 dark:text-blue-300 font-medium">Drop file to open</div>
        </div>
      </Show>

      <div class="max-w-md w-full mx-auto px-8">
        <div class="text-center space-y-5">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mx-auto shadow-lg">
            <span class="text-white font-bold text-xl tracking-tight">JDF</span>
          </div>
          <div>
            <h1 class="text-2xl font-semibold text-gray-800 dark:text-gray-100">JDF Reader</h1>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Open a JDF, PDF, or Markdown document</p>
          </div>
          <button
            onClick={props.onOpen}
            class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm inline-flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 3.5a1 1 0 0 1 1-1h3l1.5 1.5H11a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5Z" />
            </svg>
            Open Document
          </button>
          <p class="text-[11px] text-gray-400 dark:text-gray-500">or drop a file anywhere</p>
        </div>

        <Show when={props.recentFiles.length > 0}>
          <div class="mt-10 pt-6 border-t border-gray-200 dark:border-slate-700">
            <div class="flex items-center justify-between mb-3 px-1">
              <h2 class="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">Recent</h2>
              <button onClick={props.onClearRecent} class="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                Clear
              </button>
            </div>
            <div class="space-y-1 max-h-64 overflow-y-auto">
              <For each={props.recentFiles}>
                {(path) => {
                  const ext = path.split(".").pop()?.toLowerCase() || "";
                  return (
                    <button
                      onClick={() => props.onOpenPath(path)}
                      class="w-full text-left px-3 py-2 rounded-lg hover:bg-white dark:hover:bg-slate-700 transition-colors group flex items-center gap-3"
                    >
                      <span class="text-[9px] uppercase font-bold tracking-wider text-gray-400 dark:text-gray-500 px-1.5 py-0.5 border border-gray-300 dark:border-slate-600 rounded shrink-0">
                        {ext}
                      </span>
                      <div class="flex-1 min-w-0">
                        <div class="text-xs text-gray-800 dark:text-gray-100 truncate font-medium">{basename(path)}</div>
                        <div class="text-[10px] text-gray-400 dark:text-gray-500 truncate">{path}</div>
                      </div>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>

        <div class="mt-8 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-gray-400 dark:text-gray-500">
          <div><kbd class="px-1.5 py-0.5 bg-gray-200 dark:bg-slate-700 rounded font-mono text-[10px]">⌘O</kbd> Open</div>
          <div><kbd class="px-1.5 py-0.5 bg-gray-200 dark:bg-slate-700 rounded font-mono text-[10px]">⌘F</kbd> Search</div>
          <div><kbd class="px-1.5 py-0.5 bg-gray-200 dark:bg-slate-700 rounded font-mono text-[10px]">⌘D</kbd> Dark mode</div>
          <div><kbd class="px-1.5 py-0.5 bg-gray-200 dark:bg-slate-700 rounded font-mono text-[10px]">?</kbd> Shortcuts</div>
        </div>
      </div>
    </div>
  );
}
