import { createSignal, Show, For } from "solid-js";
import type { CollapsibleElement, Style, Resources, JdfDocument } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";
import { ElementRenderer } from "./ElementRenderer";

interface CollapsibleElementViewProps {
  element: CollapsibleElement;
  styles: Record<string, Style>;
  resources?: Resources;
  document?: JdfDocument;
}

export function CollapsibleElementView(props: CollapsibleElementViewProps) {
  const [expanded, setExpanded] = createSignal(props.element.expanded ?? false);
  const css = () => resolveStyle(props.element.style, props.styles);

  return (
    <div style={css()} class="border border-gray-200 rounded-lg overflow-hidden">
      <button
        class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
        onClick={() => setExpanded(!expanded())}
      >
        <span
          class="text-xs transition-transform"
          style={{ transform: expanded() ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          &#9654;
        </span>
        {props.element.title || "Section"}
      </button>
      <Show when={expanded()}>
        <div class="px-4 py-3 space-y-2">
          <For each={props.element.elements || []}>
            {(child) => (
              <ElementRenderer
                element={child}
                styles={props.styles}
                resources={props.resources}
                document={props.document}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
