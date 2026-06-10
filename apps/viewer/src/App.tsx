import { createSignal, Show, onMount, onCleanup } from "solid-js";
import type { JdfDocument } from "@jdf/core";
import { DocumentViewer } from "./components/viewer/DocumentViewer";
import { Toolbar } from "./components/shared/Toolbar";
import { Sidebar } from "./components/shared/Sidebar";
import { SearchPanel } from "./components/shared/SearchPanel";
import { WelcomeScreen } from "./components/shared/WelcomeScreen";

export default function App() {
  const [document, setDocument] = createSignal<JdfDocument | null>(null);
  const [zoom, setZoom] = createSignal(1);
  const [currentPage, setCurrentPage] = createSignal(0);
  const [showSidebar, setShowSidebar] = createSignal(true);
  const [showSearch, setShowSearch] = createSignal(false);
  const [darkMode, setDarkMode] = createSignal(localStorage.getItem("jdf-dark") === "1");
  const [error, setError] = createSignal<string | null>(null);
  const [importing, setImporting] = createSignal(false);
  const [recentFiles, setRecentFiles] = createSignal<string[]>(JSON.parse(localStorage.getItem("jdf-recent") || "[]"));

  function addToRecent(path: string) {
    const files = recentFiles().filter(f => f !== path);
    files.unshift(path);
    const trimmed = files.slice(0, 10);
    setRecentFiles(trimmed);
    localStorage.setItem("jdf-recent", JSON.stringify(trimmed));
  }

  async function loadFromPath(path: string) {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const content = await readTextFile(path);
    const doc = JSON.parse(content) as JdfDocument;
    setDocument(doc);
    setCurrentPage(0);
    addToRecent(path);
  }

  async function importPdfFile(pdfPath: string) {
    setImporting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const doc = await invoke<JdfDocument>("import_pdf", { path: pdfPath });
      if (doc?.pages) { setDocument(doc); setCurrentPage(0); addToRecent(pdfPath); }
    } catch (e: any) {
      setError(typeof e === "string" ? e : String(e));
      setTimeout(() => setError(null), 6000);
    } finally { setImporting(false); }
  }

  async function importMarkdownFile(path: string) {
    setImporting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const doc = await invoke<JdfDocument>("import_markdown", { path });
      if (doc?.pages) { setDocument(doc); setCurrentPage(0); addToRecent(path); }
    } catch (e: any) {
      setError(typeof e === "string" ? e : String(e));
      setTimeout(() => setError(null), 6000);
    } finally { setImporting(false); }
  }

  function openByExtension(filePath: string) {
    if (filePath.endsWith(".jdf")) loadFromPath(filePath);
    else if (filePath.endsWith(".pdf")) importPdfFile(filePath);
    else if (filePath.endsWith(".md") || filePath.endsWith(".markdown")) importMarkdownFile(filePath);
  }

  onMount(async () => {
    const { listen } = await import("@tauri-apps/api/event");
    listen<string>("open-file", (event) => openByExtension(event.payload));
    listen<any>("tauri://drag-drop", (event) => {
      const paths: string[] = event.payload?.paths ?? [];
      if (paths[0]) openByExtension(paths[0]);
    });
  });

  function handleKeyDown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === "o") { e.preventDefault(); openFile(); }
    if (meta && e.key === "p") { e.preventDefault(); window.print(); }
    if (meta && e.key === "d") { e.preventDefault(); setDarkMode(d => { const n = !d; localStorage.setItem("jdf-dark", n?"1":"0"); return n; }); }
    if (meta && e.key === "s" && !e.shiftKey) { e.preventDefault(); saveAsJdf(); }
    if (meta && e.shiftKey && e.key === "e") { e.preventDefault(); exportPdf(); }
    if (meta && e.key === "f") { e.preventDefault(); if (document()) setShowSearch(s => !s); }
    if (e.key === "Escape") setShowSearch(false);
    if (meta && e.key === "b") { e.preventDefault(); setShowSidebar(s => !s); }
    if (meta && e.key === "=") { e.preventDefault(); setZoom(z => Math.min(z + 0.25, 3)); }
    if (meta && e.key === "-") { e.preventDefault(); setZoom(z => Math.max(z - 0.25, 0.25)); }
    if (meta && e.key === "0") { e.preventDefault(); setZoom(1); }
    if (!meta && e.key === "ArrowRight") { const d = document(); if (d) setCurrentPage(p => Math.min(p + 1, d.pages.length - 1)); }
    if (!meta && e.key === "ArrowLeft") setCurrentPage(p => Math.max(p - 1, 0));
  }

  onMount(() => window.addEventListener("keydown", handleKeyDown));
  onCleanup(() => window.removeEventListener("keydown", handleKeyDown));

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
    } catch (e) { console.error(e); }
  }

  async function saveAsJdf() {
    const doc = document();
    if (!doc) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ filters: [{ name: "JDF", extensions: ["jdf"] }], defaultPath: `${doc.meta.title || "document"}.jdf` });
      if (path) { const { invoke } = await import("@tauri-apps/api/core"); await invoke("save_document", { path: String(path), document: doc }); }
    } catch (e: any) { setError(`Save failed: ${e}`); setTimeout(() => setError(null), 5000); }
  }

  async function exportPdf() {
    const doc = document();
    if (!doc) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ filters: [{ name: "PDF", extensions: ["pdf"] }], defaultPath: `${doc.meta.title || "document"}.pdf` });
      if (path) { const { invoke } = await import("@tauri-apps/api/core"); await invoke("export_pdf", { document: doc, path: String(path) }); }
    } catch (e: any) { setError(`Export failed: ${e}`); setTimeout(() => setError(null), 5000); }
  }

  return (
    <div class={`h-screen flex flex-col relative ${darkMode() ? "dark" : ""}`}>
      <Toolbar
        document={document()} zoom={zoom()} currentPage={currentPage()}
        totalPages={document()?.pages.length ?? 0}
        onZoomIn={() => setZoom(z => Math.min(z + 0.25, 3))}
        onZoomOut={() => setZoom(z => Math.max(z - 0.25, 0.25))}
        onOpen={openFile} onPageChange={setCurrentPage}
        onToggleSidebar={() => setShowSidebar(s => !s)}
        onToggleSearch={() => document() && setShowSearch(s => !s)}
        onSaveJdf={saveAsJdf} onExportPdf={exportPdf}
      />
      <div class="flex-1 overflow-hidden flex">
        <Show when={document()}>
          {(doc) => (<>
            <Show when={showSidebar()}>
              <Sidebar document={doc()} currentPage={currentPage()} onPageChange={setCurrentPage} />
            </Show>
            <div class="flex-1 overflow-hidden">
              <DocumentViewer document={doc()} zoom={zoom()} currentPage={currentPage()} onPageChange={setCurrentPage} />
            </div>
          </>)}
        </Show>
        <Show when={!document()}>
          <WelcomeScreen onOpen={openFile} />
        </Show>
      </div>

      <Show when={showSearch() && document()}>
        {(doc) => (<SearchPanel document={doc()} onNavigate={p => { setCurrentPage(p); setShowSearch(false); }} onClose={() => setShowSearch(false)} />)}
      </Show>

      <Show when={importing()}>
        <div class="absolute inset-0 bg-black/40 flex items-center justify-center z-50">
          <div class="bg-white rounded-xl shadow-2xl p-8 flex flex-col items-center gap-4">
            <div class="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            <p class="text-sm text-gray-600 font-medium">Converting...</p>
          </div>
        </div>
      </Show>

      <Show when={error()}>
        <div class="absolute bottom-6 left-1/2 -translate-x-1/2 bg-red-600 text-white px-5 py-3 rounded-lg shadow-xl text-sm max-w-md z-50">
          {error()}
        </div>
      </Show>
    </div>
  );
}
