import { Show } from "solid-js";
import type { JdfDocument } from "@jdf/core";

export type ViewMode = "jdf" | "markdown" | "json";

interface ToolbarProps {
  document: JdfDocument | null;
  fileName?: string;
  fileType?: "jdf" | "jdfx" | "md" | "pdf";
  isMarkdown?: boolean;
  isEditableFile?: boolean;
  dirty?: boolean;
  savingState: "idle" | "saving" | "saved" | "error";
  viewMode: ViewMode;
  zoom: number;
  currentPage: number;
  totalPages: number;
  darkMode: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onNewWindow?: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onOpen: () => void;
  onClose: () => void;
  onPageChange: (page: number) => void;
  onToggleSidebar: () => void;
  onToggleSearch: () => void;
  onExportPdf: () => void;
  onSaveJdf: () => void;
  onToggleDark: () => void;
  onToggleHelp: () => void;
  onSetViewMode: (m: ViewMode) => void;
}

export function Toolbar(props: ToolbarProps) {
  const savingLabel = () => {
    const isAutoSaved = props.fileType === "jdf" || props.fileType === "jdfx";
    if (props.dirty && !isAutoSaved) {
      return { text: "● Unsaved (in memory)", color: "text-amber-600 dark:text-amber-400" };
    }
    switch (props.savingState) {
      case "saving": return { text: "Saving…", color: "text-amber-500" };
      case "saved": return { text: "✓ Saved", color: "text-green-500" };
      case "error": return { text: "Save failed", color: "text-red-500" };
      default: return null;
    }
  };

  return (
    <header
      class="h-12 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 flex items-center px-3 gap-2 shrink-0 select-none transition-colors"
      style={{ "-webkit-app-region": "drag" }}
    >
      <div class="flex items-center gap-1.5" style={{ "-webkit-app-region": "no-drag" }}>
        <div class="w-7 h-7 rounded-md bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-sm">
          <span class="text-white font-bold text-[10px]">JDF</span>
        </div>
        <Show when={props.onNewWindow}>
          <button onClick={props.onNewWindow!} class="px-2.5 py-1 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors" title="New window (⌘N)">
            New
          </button>
        </Show>
        <button onClick={props.onOpen} class="px-2.5 py-1 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors" title="Open (⌘O)">
          Open
        </button>
        <Show when={props.document}>
          <button onClick={props.onSaveJdf} class="px-2.5 py-1 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors" title="Save as JDF (⌘S)">
            Save As
          </button>
          <button onClick={props.onExportPdf} class="px-2.5 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors font-medium" title="Export PDF (⌘⇧E)">
            PDF
          </button>
        </Show>
      </div>

      <Show when={props.document}>
        <div class="h-5 w-px bg-gray-200 dark:bg-slate-700 mx-1" />

        <div class="flex items-center gap-1" style={{ "-webkit-app-region": "no-drag" }}>
          <button onClick={props.onToggleSidebar} class="w-7 h-7 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors" title="Toggle sidebar (⌘B)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="1" y="2" width="3.5" height="10" rx="1" opacity="0.7" />
              <rect x="5.5" y="2" width="7.5" height="10" rx="1" opacity="0.25" />
            </svg>
          </button>

          <button onClick={props.onClose} class="w-7 h-7 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors" title="Close (⌘W)">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
              <line x1="2" y1="2" x2="10" y2="10" />
              <line x1="10" y1="2" x2="2" y2="10" />
            </svg>
          </button>

          <button
            onClick={props.onUndo}
            disabled={!props.canUndo}
            class="w-7 h-7 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-700 rounded disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            title="Undo (⌘Z)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M3 7h7a3 3 0 0 1 0 6H7" />
              <path d="M5 5L3 7l2 2" />
            </svg>
          </button>
          <button
            onClick={props.onRedo}
            disabled={!props.canRedo}
            class="w-7 h-7 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-700 rounded disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            title="Redo (⌘⇧Z)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M11 7H4a3 3 0 0 0 0 6h3" />
              <path d="M9 5l2 2-2 2" />
            </svg>
          </button>
        </div>

        <div class="flex items-center gap-1.5 ml-1 min-w-0" style={{ "-webkit-app-region": "no-drag" }}>
          <span class="text-xs text-gray-700 dark:text-gray-200 font-medium truncate max-w-44">
            {props.fileName || props.document!.meta.title}
          </span>
          <Show when={props.fileType && props.fileType !== "jdf" && props.fileType !== "jdfx"}>
            <span class="text-[9px] uppercase font-bold tracking-wider text-gray-400 dark:text-gray-500 px-1 py-0.5 border border-gray-300 dark:border-slate-600 rounded">
              {props.fileType}
            </span>
          </Show>
          <Show when={savingLabel()}>
            <span class={`text-[10px] font-medium ${savingLabel()!.color}`}>{savingLabel()!.text}</span>
          </Show>
        </div>

        <Show when={props.isMarkdown}>
          <div class="h-5 w-px bg-gray-200 dark:bg-slate-700 mx-1" />
          <div class="inline-flex bg-gray-100 dark:bg-slate-700 rounded p-0.5" style={{ "-webkit-app-region": "no-drag" }}>
            <button
              onClick={() => props.onSetViewMode("markdown")}
              class={`px-2.5 py-1 text-[11px] rounded transition-colors ${props.viewMode === "markdown" ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-white shadow-sm font-medium" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
            >
              MD
            </button>
            <button
              onClick={() => props.onSetViewMode("jdf")}
              class={`px-2.5 py-1 text-[11px] rounded transition-colors ${props.viewMode === "jdf" ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-white shadow-sm font-medium" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
            >
              Paged
            </button>
          </div>
        </Show>

        <Show when={props.isEditableFile}>
          <div class="h-5 w-px bg-gray-200 dark:bg-slate-700 mx-1" />
          <div class="inline-flex bg-gray-100 dark:bg-slate-700 rounded p-0.5" style={{ "-webkit-app-region": "no-drag" }}>
            <button
              onClick={() => props.onSetViewMode("jdf")}
              class={`px-2.5 py-1 text-[11px] rounded transition-colors ${props.viewMode === "jdf" ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-white shadow-sm font-medium" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
              title="Visual document view"
            >
              View
            </button>
            <button
              onClick={() => props.onSetViewMode("json")}
              class={`px-2.5 py-1 text-[11px] rounded transition-colors ${props.viewMode === "json" ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-white shadow-sm font-medium" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
              title="Raw JSON view"
            >
              JSON
            </button>
          </div>

        </Show>

        <div class="flex-1" />

        <button onClick={props.onToggleSearch} class="w-7 h-7 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors" title="Search (⌘F)" style={{ "-webkit-app-region": "no-drag" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="6" cy="6" r="4" />
            <line x1="9" y1="9" x2="12.5" y2="12.5" />
          </svg>
        </button>

        <Show when={props.viewMode === "jdf"}>
          <div class="h-5 w-px bg-gray-200 dark:bg-slate-700 mx-1" />
          <div class="flex items-center gap-0.5" style={{ "-webkit-app-region": "no-drag" }}>
            <button
              onClick={() => props.onPageChange(Math.max(0, props.currentPage - 1))}
              disabled={props.currentPage === 0}
              class="w-7 h-7 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-700 rounded disabled:opacity-20 transition-colors"
              title="Previous"
            >
              ‹
            </button>
            <span class="text-[11px] text-gray-500 dark:text-gray-400 w-14 text-center font-mono">
              {props.currentPage + 1} / {props.totalPages}
            </span>
            <button
              onClick={() => props.onPageChange(Math.min(props.totalPages - 1, props.currentPage + 1))}
              disabled={props.currentPage >= props.totalPages - 1}
              class="w-7 h-7 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-700 rounded disabled:opacity-20 transition-colors"
              title="Next"
            >
              ›
            </button>
          </div>
        </Show>

        <Show when={props.viewMode !== "json"}>
          <div class="h-5 w-px bg-gray-200 dark:bg-slate-700 mx-1" />
          <div class="flex items-center gap-0.5" style={{ "-webkit-app-region": "no-drag" }}>
            <button onClick={props.onZoomOut} class="w-7 h-7 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-700 rounded text-sm transition-colors" title="Zoom out (⌘-)">−</button>
            <button onClick={props.onZoomReset} class="text-[11px] text-gray-500 dark:text-gray-400 w-11 text-center font-mono hover:text-gray-800 dark:hover:text-gray-100 transition-colors" title="Reset (⌘0)">
              {Math.round(props.zoom * 100)}%
            </button>
            <button onClick={props.onZoomIn} class="w-7 h-7 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-700 rounded text-sm transition-colors" title="Zoom in (⌘+)">+</button>
          </div>
        </Show>
      </Show>

      <Show when={!props.document}>
        <div class="flex-1" />
      </Show>

      <div class="h-5 w-px bg-gray-200 dark:bg-slate-700 mx-1" />

      <div class="flex items-center gap-0.5" style={{ "-webkit-app-region": "no-drag" }}>
        <button onClick={props.onToggleDark} class="w-7 h-7 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors" title="Dark mode (⌘D)">
          <Show when={props.darkMode} fallback={
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="7" cy="7" r="2.5" />
              <line x1="7" y1="0.5" x2="7" y2="2" /><line x1="7" y1="12" x2="7" y2="13.5" />
              <line x1="0.5" y1="7" x2="2" y2="7" /><line x1="12" y1="7" x2="13.5" y2="7" />
              <line x1="2" y1="2" x2="3.2" y2="3.2" /><line x1="10.8" y1="10.8" x2="12" y2="12" />
              <line x1="2" y1="12" x2="3.2" y2="10.8" /><line x1="10.8" y1="3.2" x2="12" y2="2" />
            </svg>
          }>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M11.5 8.5a4.5 4.5 0 0 1-6-6 5 5 0 1 0 6 6Z" />
            </svg>
          </Show>
        </button>
        <button onClick={props.onToggleHelp} class="w-7 h-7 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors" title="Shortcuts (?)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="7" cy="7" r="5.5" />
            <path d="M5.5 5.5a1.5 1.5 0 0 1 3 0c0 1-1.5 1.2-1.5 2.2" />
            <circle cx="7" cy="10" r="0.4" fill="currentColor" />
          </svg>
        </button>
      </div>
    </header>
  );
}
