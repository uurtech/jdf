import { createSignal, onMount, onCleanup } from "solid-js";

interface TitleBarProps {
  title?: string;
}

export function TitleBar(props: TitleBarProps) {
  const [maximized, setMaximized] = createSignal(false);

  onMount(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      setMaximized(await win.isMaximized());
      const unlisten = await win.onResized(async () => {
        setMaximized(await win.isMaximized());
      });
      onCleanup(() => { unlisten(); });
    } catch {}
  });

  async function minimize() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  }

  async function toggleMaximize() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().toggleMaximize();
  }

  async function close() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }

  return (
    <div
      data-tauri-drag-region
      class="h-8 flex items-center justify-between select-none bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700/50 shrink-0"
    >
      {/* Left: app title */}
      <div data-tauri-drag-region class="flex-1 pl-3 text-[11px] text-gray-500 dark:text-slate-400 font-medium truncate">
        {props.title || "JDF Reader"}
      </div>

      {/* Right: window controls */}
      <div class="flex items-center h-full">
        {/* Minimize */}
        <button
          onClick={minimize}
          class="h-full w-11 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
          title="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" class="fill-gray-600 dark:fill-slate-400">
            <rect width="10" height="1" />
          </svg>
        </button>

        {/* Maximize/Restore */}
        <button
          onClick={toggleMaximize}
          class="h-full w-11 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
          title={maximized() ? "Restore" : "Maximize"}
        >
          {maximized() ? (
            // Restore icon (two overlapping squares)
            <svg width="10" height="10" viewBox="0 0 10 10" class="stroke-gray-600 dark:stroke-slate-400" fill="none" stroke-width="1">
              <rect x="2" y="3" width="7" height="7" rx="0.5" />
              <path d="M3 3V1.5a.5.5 0 0 1 .5-.5H9a.5.5 0 0 1 .5.5V7a.5.5 0 0 1-.5.5H8" />
            </svg>
          ) : (
            // Maximize icon (single square)
            <svg width="10" height="10" viewBox="0 0 10 10" class="stroke-gray-600 dark:stroke-slate-400" fill="none" stroke-width="1">
              <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" />
            </svg>
          )}
        </button>

        {/* Close */}
        <button
          onClick={close}
          class="h-full w-11 flex items-center justify-center hover:bg-red-500 hover:text-white group transition-colors rounded-tr-none"
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" class="stroke-gray-600 dark:stroke-slate-400 group-hover:stroke-white" fill="none" stroke-width="1.5">
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
