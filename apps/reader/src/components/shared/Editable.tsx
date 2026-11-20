import { createSignal, Show, JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

interface EditableProps {
  value: string;
  /** Paragraph-style field: Enter inserts a newline, ⌘/Ctrl+Enter or blur
   *  commits. Without it Enter commits (Shift+Enter still breaks the line). */
  multiline?: boolean;
  /** Short one-line value inside a line of other text (image src, alt):
   *  a plain <input>. Everything else edits in an auto-growing <textarea>
   *  so the text wraps like the rendered element instead of scrolling
   *  sideways in a one-line box. */
  inline?: boolean;
  onCommit: (next: string) => void;
  enabled?: boolean;
  as?: keyof JSX.IntrinsicElements;
  class?: string;
  style?: JSX.CSSProperties | string;
  placeholder?: string;
  /** Rich markup to show while NOT editing (links, styled runs). The plain
   *  `value` is still what the inline editor works on. */
  children?: JSX.Element;
}

export function Editable(props: EditableProps) {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal(props.value);
  let fieldRef: HTMLInputElement | HTMLTextAreaElement | undefined;

  function startEdit(e: MouseEvent) {
    if (props.enabled === false) return;
    e.stopPropagation();
    e.preventDefault();
    const sel = window.getSelection?.();
    sel?.removeAllRanges();
    setDraft(props.value);
    setEditing(true);
    queueMicrotask(() => {
      fieldRef?.focus();
      if (fieldRef) {
        const len = fieldRef.value.length;
        fieldRef.setSelectionRange(len, len);
      }
    });
  }

  function commit() {
    const v = draft();
    setEditing(false);
    if (v !== props.value) props.onCommit(v);
  }

  function cancel() {
    setDraft(props.value);
    setEditing(false);
  }

  function handleKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
    else if (e.key === "Enter" && !props.multiline && !e.shiftKey) { e.preventDefault(); commit(); }
  }

  function autoGrow(e: InputEvent & { currentTarget: HTMLTextAreaElement }) {
    const ta = e.currentTarget;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }

  const tag = () => props.as || "span";

  return (
    <Show
      when={editing()}
      fallback={
        <Dynamic
          component={tag()}
          onDblClick={startEdit}
          class={`${props.class || ""} ${props.enabled === false ? "" : "editable-target"}`}
          style={props.style as any}
        >
          {props.children ?? (props.value || (props.placeholder ? <span class="text-gray-400 italic">{props.placeholder}</span> : ""))}
        </Dynamic>
      }
    >
      {!props.inline ? (
        <textarea
          rows={1}
          ref={(r) => {
            fieldRef = r;
            if (r) { r.style.height = "auto"; r.style.height = r.scrollHeight + "px"; }
          }}
          value={draft()}
          onInput={(e) => { setDraft(e.currentTarget.value); autoGrow(e as any); }}
          onBlur={commit}
          onKeyDown={handleKey}
          class={`${props.class || ""} editable-active`}
          style={{ display: "block", width: "100%", "min-height": "1.5em", resize: "none", overflow: "hidden", "box-sizing": "border-box", ...(typeof props.style === "object" ? (props.style as any) : {}) } as any}
        />
      ) : (
        <input
          ref={(r) => (fieldRef = r)}
          type="text"
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={handleKey}
          class={`${props.class || ""} editable-active`}
          style={{ width: "100%", ...(typeof props.style === "object" ? (props.style as any) : {}) } as any}
        />
      )}
    </Show>
  );
}
