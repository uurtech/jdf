import { For, Show, createSignal, onMount, onCleanup } from "solid-js";

export interface MenuItem {
  label: string;
  shortcut?: string;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  submenu?: MenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu(props: ContextMenuProps) {
  const [openSub, setOpenSub] = createSignal<number | null>(null);

  function handleDocClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".jdf-context-menu")) props.onClose();
  }
  function handleEsc(e: KeyboardEvent) {
    if (e.key === "Escape") props.onClose();
  }
  onMount(() => {
    setTimeout(() => document.addEventListener("mousedown", handleDocClick), 0);
    document.addEventListener("keydown", handleEsc);
  });
  onCleanup(() => {
    document.removeEventListener("mousedown", handleDocClick);
    document.removeEventListener("keydown", handleEsc);
  });

  return (
    <div
      class="jdf-context-menu fixed z-[60] bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-2xl py-1 min-w-[180px] text-sm"
      style={{ left: `${props.x}px`, top: `${props.y}px` }}
    >
      <For each={props.items}>
        {(item, idx) => (
          <Show
            when={!item.separator}
            fallback={<div class="my-1 border-t border-gray-100 dark:border-slate-700" />}
          >
            <button
              disabled={item.disabled}
              onClick={() => {
                if (item.submenu) {
                  setOpenSub(openSub() === idx() ? null : idx());
                  return;
                }
                item.onClick?.();
                props.onClose();
              }}
              onMouseEnter={() => item.submenu && setOpenSub(idx())}
              class={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-3 transition-colors ${
                item.disabled
                  ? "opacity-40 cursor-not-allowed"
                  : item.danger
                    ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                    : "text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/30"
              }`}
            >
              <span>{item.label}</span>
              <span class="flex items-center gap-2">
                <Show when={item.shortcut}>
                  <span class="text-[10px] text-gray-400 font-mono">{item.shortcut}</span>
                </Show>
                <Show when={item.submenu}>
                  <span class="text-[10px] text-gray-400">▶</span>
                </Show>
              </span>
            </button>
            <Show when={item.submenu && openSub() === idx()}>
              <div class="absolute left-full top-0 ml-1">
                <ContextMenu
                  x={0}
                  y={0}
                  items={item.submenu!}
                  onClose={props.onClose}
                />
              </div>
            </Show>
          </Show>
        )}
      </For>
    </div>
  );
}
