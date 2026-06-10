import type { JdfDocument } from "@jdf/core";

interface ToolbarProps {
  document: JdfDocument | null;
  zoom: number;
  currentPage: number;
  totalPages: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onOpen: () => void;
  onPageChange: (page: number) => void;
  onToggleSidebar?: () => void;
  onToggleSearch?: () => void;
  onExportPdf?: () => void;
  onSaveJdf?: () => void;
}

export function Toolbar(props: ToolbarProps) {
  return (
    <header class="h-11 bg-white border-b border-gray-200 flex items-center px-3 gap-2 shrink-0 select-none" style={{ "-webkit-app-region": "drag" }}>
      {/* Logo + File actions */}
      <div class="flex items-center gap-1.5" style={{ "-webkit-app-region": "no-drag" }}>
        <div class="w-6 h-6 rounded bg-blue-600 flex items-center justify-center">
          <span class="text-white font-bold text-[9px]">JDF</span>
        </div>
        <button onClick={props.onOpen} class="px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors" title="Cmd+O">
          Open
        </button>
        {props.document && (
          <>
            <button onClick={props.onSaveJdf} class="px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors" title="Cmd+S">
              Save
            </button>
            <button onClick={props.onExportPdf} class="px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors font-medium" title="Cmd+Shift+E">
              PDF
            </button>
          </>
        )}
      </div>

      {props.document && (
        <>
          <div class="h-5 w-px bg-gray-200 mx-1" />

          {/* Sidebar toggle */}
          <button
            onClick={props.onToggleSidebar}
            class="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title="Cmd+B"
            style={{ "-webkit-app-region": "no-drag" }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="1" y="2" width="3.5" height="10" rx="1" opacity="0.7" />
              <rect x="5.5" y="2" width="7.5" height="10" rx="1" opacity="0.25" />
            </svg>
          </button>

          {/* Document title */}
          <span class="text-xs text-gray-500 truncate max-w-40 mx-1">
            {props.document.meta.title}
          </span>

          <div class="flex-1" />

          {/* Search */}
          <button
            onClick={props.onToggleSearch}
            class="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title="Cmd+F"
            style={{ "-webkit-app-region": "no-drag" }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="6" cy="6" r="4" />
              <line x1="9" y1="9" x2="12.5" y2="12.5" />
            </svg>
          </button>

          <div class="h-5 w-px bg-gray-200 mx-1" />

          {/* Zoom */}
          <div class="flex items-center gap-0.5" style={{ "-webkit-app-region": "no-drag" }}>
            <button onClick={props.onZoomOut} class="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded text-sm transition-colors">
              −
            </button>
            <span class="text-[10px] text-gray-400 w-9 text-center font-mono">
              {Math.round(props.zoom * 100)}%
            </span>
            <button onClick={props.onZoomIn} class="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded text-sm transition-colors">
              +
            </button>
          </div>

          <div class="h-5 w-px bg-gray-200 mx-1" />

          {/* Page nav */}
          <div class="flex items-center gap-0.5" style={{ "-webkit-app-region": "no-drag" }}>
            <button
              onClick={() => props.onPageChange(Math.max(0, props.currentPage - 1))}
              disabled={props.currentPage === 0}
              class="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded disabled:opacity-20 text-xs transition-colors"
            >
              ‹
            </button>
            <span class="text-[10px] text-gray-400 w-12 text-center">
              {props.currentPage + 1} / {props.totalPages}
            </span>
            <button
              onClick={() => props.onPageChange(Math.min(props.totalPages - 1, props.currentPage + 1))}
              disabled={props.currentPage >= props.totalPages - 1}
              class="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded disabled:opacity-20 text-xs transition-colors"
            >
              ›
            </button>
          </div>
        </>
      )}
    </header>
  );
}
