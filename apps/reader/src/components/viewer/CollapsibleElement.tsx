import { createSignal, Show, For } from "solid-js";
import type { CollapsibleElement, Style, Resources, JdfDocument } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";
import { ElementRenderer } from "./ElementRenderer";
import { Editable } from "../shared/Editable";
import { useEdit, type ElementPath } from "../../edit/context";

interface CollapsibleElementViewProps {
  element: CollapsibleElement;
  path: ElementPath;
  styles: Record<string, Style>;
  resources?: Resources;
  document?: JdfDocument;
  onNavigatePage?: (pageIndex: number) => void;
}

export function CollapsibleElementView(props: CollapsibleElementViewProps) {
  const edit = useEdit();
  // The collapsible's open/closed state is part of the document. The previous
  // implementation kept it in a local signal only, so the user's expand
  // action never made it back into the doc — PDF export rendered the
  // collapsed version even when the user was looking at the expanded one.
  // Default to true (consistent with the Rust PDF exporter) when the field
  // is missing.
  const expanded = () => props.element.expanded ?? true;
  const toggle = () => edit.updateField(props.path, "expanded", !expanded());
  const css = () => resolveStyle(props.element.style, props.styles);

  return (
    <div style={css()} class="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-50">
        <button
          onClick={toggle}
          type="button"
          class="text-xs transition-transform inline-block hover:text-gray-900"
          style={{ transform: expanded() ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </button>
        <span class="flex-1">
          {edit.enabled() ? (
            <Editable
              value={props.element.title || ""}
              onCommit={(v) => edit.updateField(props.path, "title", v)}
              placeholder="Section title"
            />
          ) : (
            <button class="text-left w-full" onClick={toggle} type="button">
              {props.element.title || "Section"}
            </button>
          )}
        </span>
      </div>
      <Show when={expanded()}>
        <div class="px-4 py-3 space-y-2 relative">
          <For each={props.element.elements || []}>
            {(child, index) => (
              <ElementRenderer
                element={child}
                path={[...props.path, "elements", index()]}
                styles={props.styles}
                resources={props.resources}
                document={props.document}
                onNavigatePage={props.onNavigatePage}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
