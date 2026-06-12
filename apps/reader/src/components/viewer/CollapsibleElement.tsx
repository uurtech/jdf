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
  const [expanded, setExpanded] = createSignal(props.element.expanded ?? false);
  const css = () => resolveStyle(props.element.style, props.styles);

  return (
    <div style={css()} class="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-50">
        <button
          onClick={() => setExpanded(!expanded())}
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
            <button class="text-left w-full" onClick={() => setExpanded(!expanded())} type="button">
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
