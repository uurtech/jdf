import { For, Show } from "solid-js";
import type { TableElement, Style, TableCellValue, TableBorders, TextAlign } from "@jdf/core";
import { MM_TO_PX } from "@jdf/core";
import { resolveStyle, styleToCss } from "./PageRenderer";
import { Editable } from "../shared/Editable";
import { useEdit, type ElementPath } from "../../edit/context";

interface TableElementViewProps {
  element: TableElement;
  path: ElementPath;
  styles: Record<string, Style>;
}

function cellText(c: TableCellValue): string {
  // Tolerate malformed cells (null, numbers, missing content) — keep the web
  // embed (jdf.js) and reader byte-identical in leniency so the same document
  // renders the same rows on both surfaces.
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (typeof c === "object") return c.content == null ? "" : String(c.content);
  return String(c);
}

function cellAttrs(c: TableCellValue) {
  if (c == null || typeof c !== "object") return {};
  return { colspan: c.colspan, rowspan: c.rowspan };
}

function cellAlign(c: TableCellValue): TextAlign | undefined {
  return c == null || typeof c !== "object" ? undefined : c.align;
}

/** Normalise a column width (number → px, string passed through, e.g. "30%"). */
function colWidthCss(w: string | number | undefined): string | undefined {
  if (w == null) return undefined;
  return typeof w === "number" ? `${w * MM_TO_PX}px` : w;
}

export function TableElementView(props: TableElementViewProps) {
  const edit = useEdit();
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

  const hasColWidths = () => props.element.columns?.some((c) => c.width != null) ?? false;

  const cellCss = (c: TableCellValue) => {
    if (c == null || typeof c !== "object" || !c.style) return {};
    const s = c.style;
    if (typeof s === "string") return styleToCss(props.styles[s] || {});
    if (Array.isArray(s)) { let m = {}; for (const k of s) m = { ...m, ...styleToCss(props.styles[k] || {}) }; return m; }
    return styleToCss(s);
  };

  function commitCell(rowIdx: number, colIdx: number, value: string) {
    const row = props.element.rows[rowIdx];
    if (!row) return;
    const cell = row[colIdx];
    if (typeof cell === "string" || cell == null) {
      edit.updateField(props.path, `rows.${rowIdx}.${colIdx}`, value);
    } else {
      edit.updateField(props.path, `rows.${rowIdx}.${colIdx}.content`, value);
    }
  }

  return (
    <div style={css()} class="overflow-x-auto">
      <table
        class="w-full border-collapse"
        style={{
          "font-size": "14px",
          "table-layout": hasColWidths() ? "fixed" : "auto",
          ...(borders().outer ? { border: `${borders().width || 1}px solid ${borders().color || "#e2e8f0"}` } : {}),
        }}
      >
        <Show when={hasColWidths()}>
          <colgroup>
            <For each={props.element.columns!}>
              {(c) => <col style={{ ...(colWidthCss(c.width) ? { width: colWidthCss(c.width) } : {}) }} />}
            </For>
          </colgroup>
        </Show>
        <Show when={headers() && headers()!.length > 0}>
          <thead>
            <tr style={headerCss()}>
              <For each={headers()!}>
                {(h, i) => (
                  <th
                    class="px-3 py-2 font-semibold bg-gray-50"
                    style={{
                      "text-align": props.element.columns?.[i()]?.align || "left",
                      ...(borders().inner ? { border: `${borders().width || 1}px solid ${borders().color || "#e2e8f0"}` } : {}),
                    }}
                  >
                    {edit.enabled() ? (
                      <Editable
                        value={h}
                        onCommit={(v) => edit.updateField(props.path, `headers.${i()}`, v)}
                      />
                    ) : (
                      h
                    )}
                  </th>
                )}
              </For>
            </tr>
          </thead>
        </Show>
        <tbody>
          <For each={props.element.rows}>
            {(row, rowIdx) => (
              <tr style={{ ...rowCss(), ...(rowIdx() % 2 === 1 ? altRowCss() : {}) }}>
                <For each={row}>
                  {(cell, colIdx) => (
                    <td
                      class="px-3 py-2 align-top"
                      style={{
                        "text-align": cellAlign(cell) || props.element.columns?.[colIdx()]?.align || "left",
                        ...(borders().inner ? { border: `${borders().width || 1}px solid ${borders().color || "#e2e8f0"}` } : {}),
                        ...cellCss(cell),
                      }}
                      {...cellAttrs(cell)}
                    >
                      {edit.enabled() ? (
                        <Editable
                          value={cellText(cell)}
                          onCommit={(v) => commitCell(rowIdx(), colIdx(), v)}
                        />
                      ) : (
                        cellText(cell)
                      )}
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
