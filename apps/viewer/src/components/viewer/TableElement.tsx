import { For, Show } from "solid-js";
import type { TableElement, Style, TableCellValue, TableBorders } from "@jdf/core";
import { resolveStyle, styleToCss } from "./PageRenderer";

interface TableElementViewProps {
  element: TableElement;
  styles: Record<string, Style>;
}

function cellText(c: TableCellValue): string {
  return typeof c === "string" ? c : c.content;
}

function cellAttrs(c: TableCellValue) {
  if (typeof c === "string") return {};
  return { colspan: c.colspan, rowspan: c.rowspan };
}

export function TableElementView(props: TableElementViewProps) {
  const css = () => resolveStyle(props.element.style, props.styles);

  const headerCss = () => {
    const s = props.element.headerStyle;
    if (!s) return {};
    if (typeof s === "string") return styleToCss(props.styles[s] || {});
    if (Array.isArray(s)) { let m = {}; for (const k of s) m = { ...m, ...styleToCss(props.styles[k] || {}) }; return m; }
    return styleToCss(s);
  };

  const rowCss = () => {
    const s = props.element.rowStyle;
    if (!s) return {};
    if (typeof s === "string") return styleToCss(props.styles[s] || {});
    if (Array.isArray(s)) { let m = {}; for (const k of s) m = { ...m, ...styleToCss(props.styles[k] || {}) }; return m; }
    return styleToCss(s);
  };

  const altRowCss = () => {
    const s = props.element.alternateRowStyle;
    if (!s) {
      const c = props.element.alternatingRowColor;
      return c ? { "background-color": c } : {};
    }
    if (typeof s === "string") return styleToCss(props.styles[s] || {});
    if (Array.isArray(s)) { let m = {}; for (const k of s) m = { ...m, ...styleToCss(props.styles[k] || {}) }; return m; }
    return styleToCss(s);
  };

  const borders = (): TableBorders => {
    const b = props.element.borders;
    if (b === false) return { outer: false, inner: false };
    if (b === true || b === undefined) return { outer: true, inner: true, color: "#e2e8f0", width: 1 };
    return { outer: true, inner: true, color: "#e2e8f0", width: 1, ...b };
  };

  const headers = () => props.element.headers ?? props.element.columns?.map((c) => c.header || "").filter((h) => h !== "");

  const colAlign = (i: number) => props.element.columns?.[i]?.align;

  return (
    <div style={css()} class="overflow-x-auto">
      <table
        class="w-full border-collapse"
        style={{
          "font-size": "14px",
          ...(borders().outer ? { border: `${borders().width || 1}px solid ${borders().color || "#e2e8f0"}` } : {}),
        }}
      >
        <Show when={headers() && headers()!.length > 0}>
          <thead>
            <tr style={headerCss()}>
              <For each={headers()!}>
                {(h, i) => (
                  <th
                    class="px-3 py-2 font-semibold bg-gray-50"
                    style={{
                      "text-align": colAlign(i()) || "left",
                      ...(borders().inner ? { border: `${borders().width || 1}px solid ${borders().color || "#e2e8f0"}` } : {}),
                    }}
                  >
                    {h}
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
                  ...rowCss(),
                  ...(rowIdx() % 2 === 1 ? altRowCss() : {}),
                }}
              >
                <For each={row}>
                  {(cell, colIdx) => (
                    <td
                      class="px-3 py-2 align-top"
                      style={{
                        "text-align": colAlign(colIdx()) || "left",
                        ...(borders().inner ? { border: `${borders().width || 1}px solid ${borders().color || "#e2e8f0"}` } : {}),
                      }}
                      {...cellAttrs(cell)}
                    >
                      {cellText(cell)}
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
