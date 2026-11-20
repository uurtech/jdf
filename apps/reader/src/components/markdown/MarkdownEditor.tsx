import { onMount } from "solid-js";
import { MarkdownViewer } from "./MarkdownViewer";

interface MarkdownEditorProps {
  /** Source as it is on disk — what the textarea edits and autosave writes. */
  source: string;
  /** Source with local images inlined as data: URLs — what the preview shows. */
  preview: string;
  zoom: number;
  searchQuery?: string;
  onChange: (next: string) => void;
}

/**
 * Split-pane markdown editor: raw source on the left, live preview on the
 * right. The textarea is uncontrolled (value set once on mount) so the
 * parent re-rendering after each autosave never moves the caret.
 */
export function MarkdownEditor(props: MarkdownEditorProps) {
  let ta: HTMLTextAreaElement | undefined;
  onMount(() => {
    if (ta) { ta.value = props.source; ta.focus(); }
  });

  // execCommand("insertText") keeps the change on the textarea's native undo
  // stack (⌘Z works); setRangeText is the fallback where it is unsupported.
  function insert(text: string, start: number, end: number) {
    if (!ta) return;
    ta.setSelectionRange(start, end);
    if (!document.execCommand?.("insertText", false, text)) ta.setRangeText(text, start, end, "end");
  }

  function wrapSelection(before: string, after = before) {
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e);
    insert(before + sel + after, s, e);
    if (!sel) ta.setSelectionRange(s + before.length, s + before.length);
    props.onChange(ta.value);
  }

  function handleKey(ev: KeyboardEvent) {
    // Keep app-level shortcuts (⌘F, ⌘S, arrows → page nav) out of the editor,
    // except the ones we handle here.
    ev.stopPropagation();
    if (!ta) return;
    const meta = ev.metaKey || ev.ctrlKey;
    if (meta && ev.key === "b") { ev.preventDefault(); wrapSelection("**"); }
    else if (meta && ev.key === "i") { ev.preventDefault(); wrapSelection("_"); }
    else if (meta && ev.key === "k") { ev.preventDefault(); wrapSelection("[", "](https://)"); }
    else if (ev.key === "Tab") {
      ev.preventDefault();
      insert("  ", ta.selectionStart, ta.selectionEnd);
      props.onChange(ta.value);
    } else if (ev.key === "Enter" && !meta && !ev.shiftKey) {
      // Continue a list item ("- ", "* ", "1. ", "- [ ] ") on Enter; an
      // empty item ends the list.
      const pos = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf("\n", pos - 1) + 1;
      const line = ta.value.slice(lineStart, pos);
      const m = line.match(/^(\s*)([-*+]|\d+\.)(\s+\[[ xX]\])?\s+/);
      if (!m) return;
      ev.preventDefault();
      if (line.trim() === m[0].trim()) {
        insert("", lineStart, pos);
      } else {
        const bullet = /^\d+\.$/.test(m[2]) ? `${parseInt(m[2], 10) + 1}.` : m[2];
        insert(`\n${m[1]}${bullet}${m[3] ? " [ ]" : ""} `, pos, ta.selectionEnd);
      }
      props.onChange(ta.value);
    }
  }

  return (
    <div class="h-full flex min-h-0">
      <div class="w-1/2 h-full border-r border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <textarea
          ref={ta}
          data-md-source
          spellcheck={true}
          onInput={(e) => props.onChange(e.currentTarget.value)}
          onKeyDown={handleKey}
          class="w-full h-full resize-none outline-none p-6 font-mono text-[13px] leading-6 bg-transparent text-gray-800 dark:text-gray-100"
          placeholder="# Title&#10;&#10;Write markdown here…"
        />
      </div>
      <div class="w-1/2 h-full min-h-0">
        <MarkdownViewer content={props.preview} zoom={props.zoom} searchQuery={props.searchQuery} />
      </div>
    </div>
  );
}
