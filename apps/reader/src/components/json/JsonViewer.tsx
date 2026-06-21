import { createSignal, createEffect } from "solid-js";
import type { JdfDocument } from "@jdf/core";

interface JsonViewerProps {
  document: JdfDocument;
  editable: boolean;
  onCommit: (next: JdfDocument) => void;
}

export function JsonViewer(props: JsonViewerProps) {
  const [text, setText] = createSignal(JSON.stringify(props.document, null, 2));
  const [error, setError] = createSignal<string | null>(null);
  const [dirty, setDirty] = createSignal(false);

  // Track the doc snapshot the current dirty draft was forked from. When the
  // outer document changes (undo/redo, sidebar add page, action-bar move) the
  // user's stale draft would otherwise overwrite the new state on blur. We
  // drop the dirty draft and refresh the textarea — the alternative is silent
  // state-corruption that's worse than losing a half-typed edit.
  let baseSnapshot = JSON.stringify(props.document, null, 2);

  createEffect(() => {
    const incoming = JSON.stringify(props.document, null, 2);
    if (incoming === baseSnapshot) return; // local commit just propagated back
    baseSnapshot = incoming;
    setText(incoming);
    setDirty(false);
    setError(null);
  });

  function commit() {
    if (!props.editable) return;
    if (!dirty()) return; // nothing to do — avoid no-op round-trip
    try {
      const parsed = JSON.parse(text()) as JdfDocument;
      if (!parsed.$jdf || !parsed.pages) throw new Error("Missing $jdf or pages field");
      setError(null);
      setDirty(false);
      baseSnapshot = JSON.stringify(parsed, null, 2);
      props.onCommit(parsed);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div class="h-full flex flex-col bg-gray-50 dark:bg-slate-900">
      <div class="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <span class="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Raw JSON</span>
        <span class="text-[10px] text-gray-400">·</span>
        <span class="text-[10px] text-gray-400">{props.editable ? "Edit and Cmd+S to save" : "Read-only"}</span>
        <div class="flex-1" />
        {error() && <span class="text-[10px] text-red-500 font-medium">{error()}</span>}
        {dirty() && !error() && <span class="text-[10px] text-amber-500 font-medium">Unsaved</span>}
      </div>
      <textarea
        value={text()}
        onInput={(e) => { setText(e.currentTarget.value); setDirty(true); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            commit();
          }
        }}
        readOnly={!props.editable}
        spellcheck={false}
        class="flex-1 w-full p-4 font-mono text-[12px] leading-relaxed bg-transparent text-gray-800 dark:text-gray-100 focus:outline-none resize-none"
        style={{ "font-family": "JetBrains Mono, ui-monospace, monospace", "tab-size": "2" }}
      />
    </div>
  );
}
