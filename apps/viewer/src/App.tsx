import { createSignal, Show, onMount, onCleanup, createMemo } from "solid-js";
import type { JdfDocument } from "@jdf/core";
import { DocumentViewer } from "./components/viewer/DocumentViewer";
import { MarkdownViewer } from "./components/markdown/MarkdownViewer";
import { Toolbar, type ViewMode } from "./components/shared/Toolbar";
import { Sidebar } from "./components/shared/Sidebar";
import { SearchPanel } from "./components/shared/SearchPanel";
import { WelcomeScreen } from "./components/shared/WelcomeScreen";
import { HelpOverlay } from "./components/shared/HelpOverlay";

interface LoadedFile {
  path: string;
  type: "jdf" | "md" | "pdf";
  document: JdfDocument;
  rawMarkdown?: string;
}

function basename(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

export default function App() {
  const [loaded, setLoaded] = createSignal<LoadedFile | null>(null);
  const [viewMode, setViewMode] = createSignal<ViewMode>("markdown");
  const [zoom, setZoom] = createSignal(1);
  const [currentPage, setCurrentPage] = createSignal(0);
  const [showSidebar, setShowSidebar] = createSignal(true);
  const [showSearch, setShowSearch] = createSignal(false);
  const [showHelp, setShowHelp] = createSignal(false);
  const [darkMode, setDarkMode] = createSignal(localStorage.getItem("jdf-dark") === "1");
  const [error, setError] = createSignal<string | null>(null);
  const [importing, setImporting] = createSignal(false);
  const [modified, setModified] = createSignal(false);
  const [recentFiles, setRecentFiles] = createSignal<string[]>(JSON.parse(localStorage.getItem("jdf-recent") || "[]"));

  const isMarkdown = createMemo(() => loaded()?.type === "md");
  const document = createMemo(() => loaded()?.document ?? null);

  function addToRecent(path: string) {
    const files = recentFiles().filter((f) => f !== path);
    files.unshift(path);
    const trimmed = files.slice(0, 10);
    setRecentFiles(trimmed);
    localStorage.setItem("jdf-recent", JSON.stringify(trimmed));
  }

  function clearRecent() {
    setRecentFiles([]);
    localStorage.setItem("jdf-recent", "[]");
  }

  function setError5s(msg: string) {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  }

  async function loadJdf(path: string) {
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const content = await readTextFile(path);
      const doc = JSON.parse(content) as JdfDocument;
      if (!doc.$jdf) throw new Error("Not a JDF document");
      setLoaded({ path, type: "jdf", document: doc });
      setViewMode("jdf");
      setCurrentPage(0);
      setModified(false);
      addToRecent(path);
    } catch (e: any) {
      setError5s(`Open failed: ${e.message || e}`);
    }
  }

  async function importPdfFile(pdfPath: string) {
    setImporting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const doc = await invoke<JdfDocument>("import_pdf", { path: pdfPath });
      if (doc?.pages) {
        setLoaded({ path: pdfPath, type: "pdf", document: doc });
        setViewMode("jdf");
        setCurrentPage(0);
        setModified(false);
        addToRecent(pdfPath);
      }
    } catch (e: any) {
      setError5s(typeof e === "string" ? e : String(e));
    } finally {
      setImporting(false);
    }
  }

  async function importMarkdownFile(path: string) {
    setImporting(true);
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const raw = await readTextFile(path);
      const { invoke } = await import("@tauri-apps/api/core");
      const doc = await invoke<JdfDocument>("import_markdown", { path });
      if (doc?.pages) {
        setLoaded({ path, type: "md", document: doc, rawMarkdown: raw });
        setViewMode("markdown");
        setCurrentPage(0);
        setModified(false);
        addToRecent(path);
      }
    } catch (e: any) {
      setError5s(typeof e === "string" ? e : String(e));
    } finally {
      setImporting(false);
    }
  }

  function openByExtension(filePath: string) {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".jdf")) loadJdf(filePath);
    else if (lower.endsWith(".pdf")) importPdfFile(filePath);
    else if (lower.endsWith(".md") || lower.endsWith(".markdown")) importMarkdownFile(filePath);
    else setError5s(`Unsupported file type: ${filePath}`);
  }

  onMount(async () => {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      const off1 = await listen<string>("open-file", (event) => openByExtension(event.payload));
      const off2 = await listen<any>("tauri://drag-drop", (event) => {
        const paths: string[] = event.payload?.paths ?? [];
        if (paths[0]) openByExtension(paths[0]);
      });
      onCleanup(() => { off1(); off2(); });
    } catch {}
  });

  function closeDocument() {
    if (modified() && !window.confirm("You have unsaved changes. Close anyway?")) return;
    setLoaded(null);
    setShowSearch(false);
    setCurrentPage(0);
    setModified(false);
  }

  function handleKeyDown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;
    const target = e.target as HTMLElement;
    const inField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

    if (e.key === "Escape") {
      if (showHelp()) { setShowHelp(false); return; }
      if (showSearch()) { setShowSearch(false); return; }
    }
    if (!inField && !meta && e.key === "?") { e.preventDefault(); setShowHelp((v) => !v); return; }

    if (meta && e.key === "o") { e.preventDefault(); openFile(); }
    else if (meta && e.key === "p") { e.preventDefault(); window.print(); }
    else if (meta && e.key === "d") { e.preventDefault(); toggleDark(); }
    else if (meta && e.key.toLowerCase() === "w" && document()) { e.preventDefault(); closeDocument(); }
    else if (meta && e.key === "s" && !e.shiftKey) { e.preventDefault(); saveAsJdf(); }
    else if (meta && e.shiftKey && e.key.toLowerCase() === "e") { e.preventDefault(); exportPdf(); }
    else if (meta && e.key === "f") { e.preventDefault(); if (document()) setShowSearch((s) => !s); }
    else if (meta && e.key === "b") { e.preventDefault(); setShowSidebar((s) => !s); }
    else if (meta && (e.key === "=" || e.key === "+")) { e.preventDefault(); setZoom((z) => Math.min(z + 0.1, 3)); }
    else if (meta && e.key === "-") { e.preventDefault(); setZoom((z) => Math.max(z - 0.1, 0.25)); }
    else if (meta && e.key === "0") { e.preventDefault(); setZoom(1); }
    else if (meta && e.key === "ArrowUp" && document()) { e.preventDefault(); setCurrentPage(0); }
    else if (meta && e.key === "ArrowDown") { e.preventDefault(); const d = document(); if (d) setCurrentPage(d.pages.length - 1); }
    else if (!meta && !inField && e.key === "ArrowRight") { const d = document(); if (d) setCurrentPage((p) => Math.min(p + 1, d.pages.length - 1)); }
    else if (!meta && !inField && e.key === "ArrowLeft") setCurrentPage((p) => Math.max(p - 1, 0));
  }

  function toggleDark() {
    setDarkMode((d) => {
      const n = !d;
      localStorage.setItem("jdf-dark", n ? "1" : "0");
      return n;
    });
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  async function openFile() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const result = await open({
        multiple: false,
        filters: [
          { name: "All Supported", extensions: ["jdf", "pdf", "md", "markdown"] },
          { name: "JDF", extensions: ["jdf"] },
          { name: "PDF", extensions: ["pdf"] },
          { name: "Markdown", extensions: ["md", "markdown"] },
        ],
      });
      if (!result) return;
      const filePath = typeof result === "string" ? result : (result as any).path || String(result);
      openByExtension(filePath);
    } catch (e) {
      console.error(e);
    }
  }

  async function saveAsJdf() {
    const cur = loaded();
    if (!cur) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        filters: [{ name: "JDF", extensions: ["jdf"] }],
        defaultPath: `${cur.document.meta.title || basename(cur.path).replace(/\.[^.]+$/, "")}.jdf`,
      });
      if (path) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_document", { path: String(path), document: cur.document });
        setModified(false);
      }
    } catch (e: any) {
      setError5s(`Save failed: ${e}`);
    }
  }

  async function exportPdf() {
    const cur = loaded();
    if (!cur) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
        defaultPath: `${cur.document.meta.title || basename(cur.path).replace(/\.[^.]+$/, "")}.pdf`,
      });
      if (path) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("export_pdf", { document: cur.document, path: String(path) });
      }
    } catch (e: any) {
      setError5s(`Export failed: ${e}`);
    }
  }

  return (
    <div class={`h-screen flex flex-col relative ${darkMode() ? "dark" : ""} bg-white dark:bg-slate-900`}>
      <Toolbar
        document={document()}
        fileName={loaded() ? basename(loaded()!.path) : undefined}
        fileType={loaded()?.type}
        isMarkdown={isMarkdown()}
        viewMode={viewMode()}
        zoom={zoom()}
        currentPage={currentPage()}
        totalPages={document()?.pages.length ?? 0}
        modified={modified()}
        darkMode={darkMode()}
        onZoomIn={() => setZoom((z) => Math.min(z + 0.1, 3))}
        onZoomOut={() => setZoom((z) => Math.max(z - 0.1, 0.25))}
        onZoomReset={() => setZoom(1)}
        onOpen={openFile}
        onClose={closeDocument}
        onPageChange={setCurrentPage}
        onToggleSidebar={() => setShowSidebar((s) => !s)}
        onToggleSearch={() => document() && setShowSearch((s) => !s)}
        onSaveJdf={saveAsJdf}
        onExportPdf={exportPdf}
        onToggleDark={toggleDark}
        onToggleHelp={() => setShowHelp((v) => !v)}
        onSetViewMode={setViewMode}
      />

      <div class="flex-1 overflow-hidden flex">
        <Show when={loaded()} keyed>
          {(cur) => (
            <>
              <Show when={showSidebar() && viewMode() === "jdf"}>
                <Sidebar document={cur.document} currentPage={currentPage()} onPageChange={setCurrentPage} />
              </Show>
              <div class="flex-1 overflow-hidden">
                <Show
                  when={viewMode() === "markdown" && cur.rawMarkdown != null}
                  fallback={
                    <DocumentViewer document={cur.document} zoom={zoom()} currentPage={currentPage()} onPageChange={setCurrentPage} />
                  }
                >
                  <MarkdownViewer content={cur.rawMarkdown!} zoom={zoom()} />
                </Show>
              </div>
            </>
          )}
        </Show>
        <Show when={!loaded()}>
          <WelcomeScreen
            recentFiles={recentFiles()}
            onOpen={openFile}
            onOpenPath={openByExtension}
            onClearRecent={clearRecent}
          />
        </Show>
      </div>

      <Show when={showSearch() && document()}>
        <SearchPanel
          document={document()!}
          onNavigate={(p) => { setCurrentPage(p); setShowSearch(false); if (viewMode() === "markdown") setViewMode("jdf"); }}
          onClose={() => setShowSearch(false)}
        />
      </Show>

      <Show when={showHelp()}>
        <HelpOverlay onClose={() => setShowHelp(false)} />
      </Show>

      <Show when={importing()}>
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div class="bg-white dark:bg-slate-800 rounded-xl shadow-2xl px-8 py-6 flex flex-col items-center gap-3">
            <div class="w-8 h-8 border-3 border-blue-200 dark:border-slate-700 border-t-blue-600 rounded-full animate-spin" />
            <p class="text-xs text-gray-600 dark:text-gray-300 font-medium">Converting…</p>
          </div>
        </div>
      </Show>

      <Show when={error()}>
        <div class="absolute bottom-6 left-1/2 -translate-x-1/2 bg-red-600 text-white px-5 py-3 rounded-lg shadow-2xl text-sm max-w-md z-50 animate-in">
          {error()}
        </div>
      </Show>
    </div>
  );
}
