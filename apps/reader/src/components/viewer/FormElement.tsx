import { Switch, Match, For, createEffect, onCleanup } from "solid-js";
import type {
  FormInputElement,
  FormTextareaElement,
  FormCheckboxElement,
  FormSelectElement,
  FormSignatureElement,
  Style,
} from "@jdf/core";
import { resolveStyle } from "./PageRenderer";
import { useEdit, type ElementPath } from "../../edit/context";

interface FormProps<T> {
  element: T;
  path: ElementPath;
  styles: Record<string, Style>;
}

/**
 * Reader form parity. Each form element view renders the same DOM jdfjs
 * does (real <input> / <textarea> / <select> / <canvas>) and commits the
 * user's value back into the document via `edit.updateField` so:
 *
 *  - The visible state and the stored state stay in sync (PDF export, JSON
 *    view, autosave-on-disk all see the latest filled value).
 *  - Undo/redo work — every change is one `commit()` step.
 *  - Forms behave the same in the desktop app and in jdfjs embeds; a
 *    document filled in the reader saved as `.jdf` opens with its values
 *    in jdfjs (and vice-versa).
 */

export function FormInputElementView(props: FormProps<FormInputElement>) {
  const edit = useEdit();
  const css = () => resolveStyle(props.element.style, props.styles);
  return (
    <div class="jdfjs-form-field" style={css()}>
      {props.element.label && <label class="jdfjs-form-label">{props.element.label}</label>}
      <input
        class="jdfjs-form-control"
        type={props.element.inputType || "text"}
        name={props.element.name}
        value={props.element.value ?? ""}
        placeholder={props.element.placeholder}
        readOnly={props.element.readonly}
        required={props.element.required}
        pattern={props.element.pattern}
        onInput={(e) => edit.updateField(props.path, "value", e.currentTarget.value)}
      />
    </div>
  );
}

export function FormTextareaElementView(props: FormProps<FormTextareaElement>) {
  const edit = useEdit();
  const css = () => resolveStyle(props.element.style, props.styles);
  return (
    <div class="jdfjs-form-field" style={css()}>
      {props.element.label && <label class="jdfjs-form-label">{props.element.label}</label>}
      <textarea
        class="jdfjs-form-control"
        name={props.element.name}
        value={props.element.value ?? ""}
        placeholder={props.element.placeholder}
        readOnly={props.element.readonly}
        required={props.element.required}
        rows={props.element.rows}
        onInput={(e) => edit.updateField(props.path, "value", e.currentTarget.value)}
      />
    </div>
  );
}

export function FormCheckboxElementView(props: FormProps<FormCheckboxElement>) {
  const edit = useEdit();
  const css = () => resolveStyle(props.element.style, props.styles);
  return (
    <label class="jdfjs-form-field jdfjs-form-checkbox" style={css()}>
      <input
        type="checkbox"
        name={props.element.name}
        checked={props.element.checked === true}
        disabled={props.element.readonly}
        required={props.element.required}
        onChange={(e) => edit.updateField(props.path, "checked", e.currentTarget.checked)}
      />
      {props.element.label && <span class="jdfjs-form-checkbox-label">{props.element.label}</span>}
    </label>
  );
}

export function FormSelectElementView(props: FormProps<FormSelectElement>) {
  const edit = useEdit();
  const css = () => resolveStyle(props.element.style, props.styles);
  const isSelected = (v: string) => {
    if (props.element.multiple) return (props.element.values || []).includes(v);
    return props.element.value === v;
  };
  return (
    <div class="jdfjs-form-field" style={css()}>
      {props.element.label && <label class="jdfjs-form-label">{props.element.label}</label>}
      <select
        class="jdfjs-form-control"
        name={props.element.name}
        multiple={props.element.multiple}
        disabled={props.element.readonly}
        required={props.element.required}
        onChange={(e) => {
          if (props.element.multiple) {
            const values = Array.from(e.currentTarget.selectedOptions).map((o) => o.value);
            edit.updateField(props.path, "values", values);
          } else {
            edit.updateField(props.path, "value", e.currentTarget.value);
          }
        }}
      >
        <For each={props.element.options}>
          {(opt) => (
            <option value={opt.value} selected={isSelected(opt.value)}>
              {opt.label ?? opt.value}
            </option>
          )}
        </For>
      </select>
    </div>
  );
}

export function FormSignatureElementView(props: FormProps<FormSignatureElement>) {
  const edit = useEdit();
  const css = () => resolveStyle(props.element.style, props.styles);
  let canvasRef: HTMLCanvasElement | undefined;
  let drawing = false;
  let last: { x: number; y: number } | null = null;

  // Re-render the stored signature when the doc changes from elsewhere
  // (undo/redo, JSON edits, sidebar add page mid-fill).
  createEffect(() => {
    const v = props.element.value;
    const c = canvasRef;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (v) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = v;
    }
  });

  const onPointerDown = (e: PointerEvent) => {
    if (props.element.readonly) return;
    drawing = true;
    const r = canvasRef!.getBoundingClientRect();
    last = { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drawing || !last || !canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    const r = canvasRef.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    last = { x, y };
  };
  const onPointerUp = () => {
    if (!drawing) return;
    drawing = false;
    last = null;
    if (canvasRef) {
      try { edit.updateField(props.path, "value", canvasRef.toDataURL("image/png")); } catch { /* tainted canvas — unlikely */ }
    }
  };

  onCleanup(() => { drawing = false; last = null; });

  return (
    <div class="jdfjs-form-field jdfjs-form-signature" style={css()}>
      {props.element.label && <label class="jdfjs-form-label">{props.element.label}</label>}
      <canvas
        ref={canvasRef}
        class="jdfjs-form-signature-canvas"
        width={Math.max(50, Math.floor((props.element.width ?? 80) * 3.78))}
        height={Math.max(20, Math.floor((props.element.height ?? 30) * 3.78))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      {!props.element.readonly && (
        <button
          type="button"
          class="jdfjs-form-signature-clear"
          onClick={(e) => {
            e.preventDefault();
            const c = canvasRef?.getContext("2d");
            c?.clearRect(0, 0, canvasRef!.width, canvasRef!.height);
            edit.updateField(props.path, "value", "");
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}

export const FormElementSwitch = (props: { element: any; path: ElementPath; styles: Record<string, Style> }) => (
  <Switch>
    <Match when={props.element.type === "input"}>
      <FormInputElementView element={props.element} path={props.path} styles={props.styles} />
    </Match>
    <Match when={props.element.type === "textarea"}>
      <FormTextareaElementView element={props.element} path={props.path} styles={props.styles} />
    </Match>
    <Match when={props.element.type === "checkbox"}>
      <FormCheckboxElementView element={props.element} path={props.path} styles={props.styles} />
    </Match>
    <Match when={props.element.type === "select"}>
      <FormSelectElementView element={props.element} path={props.path} styles={props.styles} />
    </Match>
    <Match when={props.element.type === "signature"}>
      <FormSignatureElementView element={props.element} path={props.path} styles={props.styles} />
    </Match>
  </Switch>
);
