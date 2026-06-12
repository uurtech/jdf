import { createSignal, Show, onMount, onCleanup, createMemo } from "solid-js";
import type { JdfDocument, Element } from "@jdf/core";
import { DocumentViewer } from "./components/viewer/DocumentViewer";
import { MarkdownViewer } from "./components/markdown/MarkdownViewer";
import { JsonViewer } from "./components/json/JsonViewer";
import { Toolbar, type ViewMode } from "./components/shared/Toolbar";
import { Sidebar } from "./components/shared/Sidebar";
import { SearchPanel } from "./components/shared/SearchPanel";
import { WelcomeScreen } from "./components/shared/WelcomeScreen";
import { HelpOverlay } from "./components/shared/HelpOverlay";
import { InsertBar } from "./components/shared/InsertBar";
import { EditContext, type ElementPath } from "./edit/context";
import {
  applyFieldUpdate,
  deleteElement,
  duplicateElement,
  moveElement,
  insertElementAfter,
  appendElementToPage,
  insertPageAfter as insertPageAfterMutation,
  deletePage as deletePageMutation,
} from "./edit/mutations";
import { createHistory } from "./edit/history";
import { importPdfToJdf } from "./import/pdfToJdf";

interface LoadedFile {
  path: string;
  type: "jdf" | "md" | "pdf";
  rawMarkdown?: string;
}

function basename(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

const SAVE_DEBOUNCE_MS = 150;

export default function App() {
  const [loaded, setLoaded] = createSignal<LoadedFile | null>(null);
  const history = createHistory(null);
  const doc = history.present;
  const setDoc = history.setPresent;
  const [viewMode, setViewMode] = createSignal<ViewMode>("markdown");
  const [zoom, setZoom] = createSignal(1);
  const [currentPage, setCurrentPage] = createSignal(0);
  const [showSidebar, setShowSidebar] = createSignal(true);
  const [showSearch, setShowSearch] = createSignal(false);
  const [showHelp, setShowHelp] = createSignal(false);
  const [darkMode, setDarkMode] = createSignal(localStorage.getItem("jdf-dark") === "1");
  const [error, setError] = createSignal<string | null>(null);
  const [importing, setImporting] = createSignal(false);
  const [recentFiles, setRecentFiles] = createSignal<string[]>(JSON.parse(localStorage.getItem("jdf-recent") || "[]"));
  const [savingState, setSavingState] = createSignal<"idle" | "saving" | "saved" | "error">("idle");
  const [mdSearchQuery, setMdSearchQuery] = createSignal("");
  const [dirty, setDirty] = createSignal(false);

  let saveTimer: number | undefined;

  const isMarkdown = createMemo(() => loaded()?.type === "md");
  const isEditableFile = createMemo(() => loaded()?.type === "jdf");

  function persistRecent(files: string[]) {
    setRecentFiles(files);
    localStorage.setItem("jdf-recent", JSON.stringify(files));
  }
  function addToRecent(path: string) {
    const files = recentFiles().filter((f) => f !== path);
    files.unshift(path);
    persistRecent(files.slice(0, 10));
  }
  function removeFromRecent(path: string) { persistRecent(recentFiles().filter((f) => f !== path)); }
  function clearRecent() { persistRecent([]); }

  function setError5s(msg: string) { setError(msg); setTimeout(() => setError(null), 5000); }

  function flashSaved() {
    setSavingState("saved");
    setTimeout(() => { if (savingState() === "saved") setSavingState("idle"); }, 1500);
  }

  async function autoSaveCurrent() {
    const cur = loaded();
    const d = doc();
    if (!cur || !d || cur.type !== "jdf") return;
    setSavingState("saving");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_document", { path: cur.path, document: d });
      flashSaved();
    } catch (e: any) {
      setSavingState("error");
      setError5s(`Auto-save failed: ${e}`);
    }
  }

  async function flushPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      await autoSaveCurrent();
    }
  }

  function scheduleAutoSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { autoSaveCurrent(); }, SAVE_DEBOUNCE_MS);
  }

  function commit(next: JdfDocument) {
    history.push(next);
    if (loaded()?.type === "jdf") scheduleAutoSave();
    else setDirty(true);
  }

  function updateField(path: ElementPath, field: string, value: unknown) {
    const d = doc();
    if (!d) return;
    commit(applyFieldUpdate(d, path, field, value));
  }
  function deleteAt(path: ElementPath) {
    const d = doc(); if (!d) return; commit(deleteElement(d, path));
  }
  function duplicateAt(path: ElementPath) {
    const d = doc(); if (!d) return; commit(duplicateElement(d, path));
  }
  function moveAt(path: ElementPath, direction: -1 | 1) {
    const d = doc(); if (!d) return; commit(moveElement(d, path, direction));
  }
  function insertAfter(path: ElementPath, element: Element) {
    const d = doc(); if (!d) return; commit(insertElementAfter(d, path, element));
  }
  function appendToPage(pageIndex: number, element: Element) {
    const d = doc(); if (!d) return; commit(appendElementToPage(d, pageIndex, element));
  }
  function addPageAfter(pageIndex: number) {
    const d = doc(); if (!d) return; commit(insertPageAfterMutation(d, pageIndex));
  }
  function removePage(pageIndex: number) {
    const d = doc(); if (!d) return; commit(deletePageMutation(d, pageIndex));
  }

  function commitFullDoc(next: JdfDocument) { commit(next); }

  function performUndo() {
    const r = history.undo();
    if (r) {
      if (loaded()?.type === "jdf") scheduleAutoSave();
      else setDirty(true);
    }
  }
  function performRedo() {
    const r = history.redo();
    if (r) {
      if (loaded()?.type === "jdf") scheduleAutoSave();
      else setDirty(true);
    }
  }

  async function loadJdf(path: string) {
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const content = await readTextFile(path);
      const parsed = JSON.parse(content) as JdfDocument;
      if (!parsed.$jdf) throw new Error("Not a JDF document");
      setLoaded({ path, type: "jdf" });
      history.reset(parsed);
      setViewMode("jdf");
      setCurrentPage(0);
      setSavingState("idle");
      setDirty(false);
      addToRecent(path);
    } catch (e: any) {
      removeFromRecent(path);
      setError5s(`Open failed: ${e.message || e}`);
    }
  }

  async function importPdfFile(pdfPath: string) {
    setImporting(true);
    try {
      const fileName = basename(pdfPath).replace(/\.pdf$/i, "");
      const parsed = await importPdfToJdf(pdfPath, fileName);
      if (parsed?.pages?.length) {
        setLoaded({ path: pdfPath, type: "pdf" });
        history.reset(parsed);
        setViewMode("jdf");
        setCurrentPage(0);
        setDirty(false);
        addToRecent(pdfPath);
      } else {
        throw new Error("PDF has no extractable content");
      }
    } catch (e: any) {
      removeFromRecent(pdfPath);
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
      const parsed = await invoke<JdfDocument>("import_markdown", { path });
      if (parsed?.pages) {
        setLoaded({ path, type: "md", rawMarkdown: raw });
        history.reset(parsed);
        setViewMode("markdown");
        setCurrentPage(0);
        setDirty(false);
        addToRecent(path);
      }
    } catch (e: any) {
      removeFromRecent(path);
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

  async function openInNewWindow(filePath?: string) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_in_new_window", { path: filePath || "" });
    } catch (e: any) {
      setError5s(`New window failed: ${e}`);
    }
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

    // If the app was launched with a file (Finder double-click, `open file.jdf`),
    // Rust queues the path in PendingFile state. Drain it now that the webview is ready.
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const pending = await invoke<string | null>("consume_pending_file");
      if (pending) openByExtension(pending);
    } catch {}

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const unlisten = await win.onCloseRequested(async (e) => {
        const hasPendingJdfSave = !!saveTimer;
        const hasUnsavedImport = dirty() && loaded() && loaded()!.type !== "jdf";
        if (!hasPendingJdfSave && !hasUnsavedImport) return;
        e.preventDefault();
        if (hasPendingJdfSave) await flushPendingSave();
        if (hasUnsavedImport) {
          const ok = window.confirm(
            "You have unsaved edits to an imported document.\n\nThe edits live in memory only — closing now will lose them.\n\nClick OK to save them as a .jdf file, Cancel to close without saving."
          );
          if (ok) {
            await saveAsJdf();
            if (dirty()) return;
          }
        }
        await win.destroy();
      });
      onCleanup(() => { unlisten(); });
    } catch {}
  });

  async function closeWindow(): Promise<void> {
    // Toolbar close button + Cmd+W: close the whole window (macOS standard).
    // If there are unsaved edits to an imported PDF/MD, prompt first.
    try {
      if (dirty() && loaded() && loaded()!.type !== "jdf") {
        const ok = window.confirm(
          "You have unsaved edits to an imported document.\n\nThe edits live in memory only — closing now will lose them.\n\nClick OK to save them as a .jdf file, Cancel to close without saving."
        );
        if (ok) {
          await saveAsJdf();
          if (dirty()) return; // user cancelled the save dialog
        }
      }
      await flushPendingSave();
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (e) {
      console.error("close window failed", e);
    }
  }

  async function closeDocument(): Promise<boolean> {
    // Internal helper — clear the loaded doc and return to welcome screen.
    // Not wired to any visible button anymore, kept for future use.
    if (loaded()?.type === "jdf") {
      await flushPendingSave();
    } else if (dirty() && doc()) {
      const choice = window.confirm(
        "You have unsaved edits.\n\nThe document was imported from " +
        (loaded()?.type?.toUpperCase() || "another format") +
        ", so changes are not auto-saved.\n\nClick OK to save it as a .jdf file, Cancel to discard your edits."
      );
      if (choice) {
        await saveAsJdf();
        if (dirty()) return false;
      }
    }
    setLoaded(null);
    history.reset(null);
    setShowSearch(false);
    setCurrentPage(0);
    setSavingState("idle");
    setDirty(false);
    return true;
  }

  function openSearch() { if (!doc()) return; setShowSearch((s) => !s); }

  function handleKeyDown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;
    const target = e.target as HTMLElement;
    const inField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

    if (e.key === "Escape") {
      if (showHelp()) { setShowHelp(false); return; }
      if (showSearch()) { setShowSearch(false); return; }
    }
    if (!inField && !meta && e.key === "?") { e.preventDefault(); setShowHelp((v) => !v); return; }

    if (meta && e.key === "z" && !e.shiftKey) { e.preventDefault(); performUndo(); }
    else if (meta && (e.key === "Z" || (e.shiftKey && e.key.toLowerCase() === "z") || e.key === "y")) { e.preventDefault(); performRedo(); }
    else if (meta && e.key === "n") { e.preventDefault(); openInNewWindow(); }
    else if (meta && e.key === "o") { e.preventDefault(); openFile(); }
    else if (meta && e.key === "p") { e.preventDefault(); window.print(); }
    else if (meta && e.key === "d") { e.preventDefault(); toggleDark(); }
    else if (meta && e.key.toLowerCase() === "w") { e.preventDefault(); closeWindow(); }
    else if (meta && e.key === "s" && !e.shiftKey) { e.preventDefault(); saveAsJdf(); }
    else if (meta && e.shiftKey && e.key.toLowerCase() === "e") { e.preventDefault(); exportPdf(); }
    else if (meta && e.key === "f") { e.preventDefault(); openSearch(); }
    else if (meta && e.key === "b") { e.preventDefault(); setShowSidebar((s) => !s); }
    else if (meta && (e.key === "=" || e.key === "+")) { e.preventDefault(); setZoom((z) => Math.min(z + 0.1, 3)); }
    else if (meta && e.key === "-") { e.preventDefault(); setZoom((z) => Math.max(z - 0.1, 0.25)); }
    else if (meta && e.key === "0") { e.preventDefault(); setZoom(1); }
    else if (meta && e.key === "ArrowUp" && doc()) { e.preventDefault(); setCurrentPage(0); }
    else if (meta && e.key === "ArrowDown") { e.preventDefault(); const d = doc(); if (d) setCurrentPage(d.pages.length - 1); }
    else if (!meta && !inField && e.key === "ArrowRight") { const d = doc(); if (d) setCurrentPage((p) => Math.min(p + 1, d.pages.length - 1)); }
    else if (!meta && !inField && e.key === "ArrowLeft") setCurrentPage((p) => Math.max(p - 1, 0));
  }

  function toggleDark() {
    setDarkMode((d) => { const n = !d; localStorage.setItem("jdf-dark", n ? "1" : "0"); return n; });
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
    } catch (e) { console.error(e); }
  }

  async function saveAsJdf() {
    const cur = loaded();
    const d = doc();
    if (!cur || !d) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        filters: [{ name: "JDF", extensions: ["jdf"] }],
        defaultPath: `${d.meta.title || basename(cur.path).replace(/\.[^.]+$/, "")}.jdf`,
      });
      if (path) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_document", { path: String(path), document: d });
        setLoaded({ ...cur, path: String(path), type: "jdf" });
        setDirty(false);
        addToRecent(String(path));
        flashSaved();
      }
    } catch (e: any) {
      setError5s(`Save failed: ${e}`);
    }
  }

  async function exportPdf() {
    const cur = loaded();
    const d = doc();
    if (!cur || !d) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
        defaultPath: `${d.meta.title || basename(cur.path).replace(/\.[^.]+$/, "")}.pdf`,
      });
      if (path) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("export_pdf", { document: d, path: String(path) });
      }
    } catch (e: any) {
      setError5s(`Export failed: ${e}`);
    }
  }

  return (
    <EditContext.Provider value={{
      enabled: isEditableFile() || (loaded()?.type !== undefined),
      updateField, deleteAt, duplicateAt, moveAt, insertAfter, appendToPage,
      insertPageAfter: addPageAfter, deletePage: removePage,
    }}>
      <div class={`h-screen flex flex-col relative ${darkMode() ? "dark" : ""} bg-white dark:bg-slate-900`}>
        <Toolbar
          document={doc()}
          fileName={loaded() ? basename(loaded()!.path) : undefined}
          fileType={loaded()?.type}
          isMarkdown={isMarkdown()}
          isEditableFile={isEditableFile()}
          dirty={dirty()}
          savingState={savingState()}
          viewMode={viewMode()}
          zoom={zoom()}
          currentPage={currentPage()}
          totalPages={doc()?.pages.length ?? 0}
          darkMode={darkMode()}
          canUndo={history.canUndo()}
          canRedo={history.canRedo()}
          onUndo={performUndo}
          onRedo={performRedo}
          onZoomIn={() => setZoom((z) => Math.min(z + 0.1, 3))}
          onZoomOut={() => setZoom((z) => Math.max(z - 0.1, 0.25))}
          onZoomReset={() => setZoom(1)}
          onOpen={openFile}
          onClose={closeWindow}
          onPageChange={setCurrentPage}
          onToggleSidebar={() => setShowSidebar((s) => !s)}
          onToggleSearch={openSearch}
          onSaveJdf={saveAsJdf}
          onExportPdf={exportPdf}
          onToggleDark={toggleDark}
          onToggleHelp={() => setShowHelp((v) => !v)}
          onSetViewMode={setViewMode}
          onNewWindow={() => openInNewWindow()}
        />

        <Show when={loaded() && doc() && (viewMode() === "jdf")}>
          <div class="flex justify-center py-2 border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/60">
            <InsertBar onInsert={(el) => appendToPage(currentPage(), el)} />
          </div>
        </Show>

        <div class="flex-1 overflow-hidden flex">
          <Show when={loaded() && doc()}>
            <Show when={showSidebar() && viewMode() === "jdf"}>
              <Sidebar
                document={doc()!}
                currentPage={currentPage()}
                onPageChange={setCurrentPage}
                onAddPage={() => { addPageAfter(currentPage()); setCurrentPage(currentPage() + 1); }}
                onDeletePage={(idx) => {
                  if (doc()!.pages.length <= 1) return;
                  removePage(idx);
                  if (currentPage() >= doc()!.pages.length) setCurrentPage(Math.max(0, doc()!.pages.length - 1));
                }}
              />
            </Show>
            <div class="flex-1 overflow-hidden">
              <Show when={viewMode() === "json"}>
                <JsonViewer document={doc()!} editable={loaded()?.type === "jdf"} onCommit={commitFullDoc} />
              </Show>
              <Show when={viewMode() === "markdown" && loaded()?.rawMarkdown != null}>
                <MarkdownViewer content={loaded()!.rawMarkdown!} zoom={zoom()} searchQuery={mdSearchQuery()} />
              </Show>
              <Show when={viewMode() === "jdf" || (viewMode() === "markdown" && loaded()?.rawMarkdown == null)}>
                <DocumentViewer document={doc()!} zoom={zoom()} currentPage={currentPage()} editable={true} onPageChange={setCurrentPage} />
              </Show>
            </div>
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

        <Show when={showSearch() && doc()}>
          <SearchPanel
            document={doc()!}
            mode={viewMode() === "markdown" ? "markdown" : "jdf"}
            markdownContent={loaded()?.rawMarkdown}
            onNavigate={(p) => { setCurrentPage(p); setShowSearch(false); if (viewMode() === "markdown") setViewMode("jdf"); }}
            onMarkdownQueryChange={setMdSearchQuery}
            onClose={() => { setShowSearch(false); setMdSearchQuery(""); }}
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
    </EditContext.Provider>
  );
}
