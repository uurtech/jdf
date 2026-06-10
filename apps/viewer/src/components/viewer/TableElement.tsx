import { For, Show } from "solid-js";
import type { TableElement, Style } from "@jdf/core";
import { resolveStyle, styleToCss } from "./PageRenderer";

interface TableElementViewProps {
  element: TableElement;
  styles: Record<string, Style>;
}

export function TableElementView(props: TableElementViewProps) {
  const css = () => resolveStyle(props.element.style, props.styles);
  const headerStyle = () => props.element.headerStyle ? styleToCss(typeof props.element.headerStyle === "string" ? (props.styles[props.element.headerStyle] || {}) : props.element.headerStyle) : {};
  const rowStyle = () => props.element.rowStyle ? styleToCss(typeof props.element.rowStyle === "string" ? (props.styles[props.element.rowStyle] || {}) : props.element.rowStyle) : {};
  const alternatingColor = () => props.element.alternatingRowColor;
  const showBorders = () => props.element.borders !== false;

  return (
    <div style={css()} class="overflow-x-auto">
      <table class={`w-full text-sm ${showBorders() ? "border-collapse border border-gray-200" : ""}`}>
        <Show when={props.element.headers}>
          <thead>
            <tr style={headerStyle()}>
              <For each={props.element.headers}>
                {(header) => (
                  <th class={`px-3 py-2 text-left font-semibold bg-gray-50 ${showBorders() ? "border border-gray-200" : ""}`}>
                    {header}
                  </th>
                )}
              </For>
            </tr>
          </thead>
        </Show>
        <tbody>
          <For each={props.element.rows}>
            {(row, rowIdx) => (
              <tr
                style={{
                  ...rowStyle(),
                  ...(alternatingColor() && rowIdx() % 2 === 1 ? { "background-color": alternatingColor()! } : {}),
                }}
              >
                <For each={row}>
                  {(cell) => (
                    <td class={`px-3 py-2 ${showBorders() ? "border border-gray-200" : ""}`}>
                      {cell}
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
