import { For, Show } from "solid-js";
import type { Page, Style, HeaderFooter, JdfDocument, StyleRef } from "@jdf/core";
import { getPageDimensions, unitToPx, DEFAULT_MARGINS } from "@jdf/core";
import { ElementRenderer } from "./ElementRenderer";

interface PageRendererProps {
  page: Page;
  pageIndex: number;
  totalPages: number;
  document: JdfDocument;
  styles: Record<string, Style>;
  onNavigatePage?: (pageIndex: number) => void;
}

export function resolveStyle(style: StyleRef | undefined, styles: Record<string, Style>): Record<string, string> {
  if (!style) return {};
  if (typeof style === "string") return styleToCss(styles[style] || {});
  if (Array.isArray(style)) {
    let merged: Style = {};
    for (const s of style) merged = { ...merged, ...(styles[s] || {}) };
    return styleToCss(merged);
  }
  return styleToCss(style);
}

function paddingToCss(p: NonNullable<Style["padding"]>): string {
  if (typeof p === "number") return `${p}px`;
  if (typeof p === "string") return p;
  const { top = 0, right = 0, bottom = 0, left = 0 } = p;
  return `${top}px ${right}px ${bottom}px ${left}px`;
}

export function styleToCss(style: Style): Record<string, string> {
  const css: Record<string, string> = {};
  if (style.fontFamily) css["font-family"] = style.fontFamily;
  if (style.fontSize) css["font-size"] = `${style.fontSize * 1.333}px`;
  if (style.fontWeight) css["font-weight"] = String(style.fontWeight);
  if (style.fontStyle) css["font-style"] = style.fontStyle;
  if (style.color) css["color"] = style.color;
  if (style.backgroundColor) css["background-color"] = style.backgroundColor;
  if (style.textAlign) css["text-align"] = style.textAlign;
  if (style.textDecoration) {
    const td = style.textDecoration === "strikethrough" ? "line-through" : style.textDecoration;
    css["text-decoration"] = td;
  }
  if (style.lineHeight) css["line-height"] = String(style.lineHeight);
  if (style.letterSpacing != null) css["letter-spacing"] = typeof style.letterSpacing === "number" ? `${style.letterSpacing}px` : style.letterSpacing;
  if (style.padding != null) css["padding"] = paddingToCss(style.padding);
  if (style.margin != null) css["margin"] = paddingToCss(style.margin as any);
  if (style.marginTop != null) css["margin-top"] = `${style.marginTop}px`;
  if (style.marginBottom != null) css["margin-bottom"] = `${style.marginBottom}px`;
  if (style.border) css["border"] = style.border;
  if (style.borderRadius != null) css["border-radius"] = typeof style.borderRadius === "number" ? `${style.borderRadius}px` : style.borderRadius;
  if (style.opacity != null) css["opacity"] = String(style.opacity);
  return css;
}

function resolveTemplateVars(text: string, pageIndex: number, totalPages: number, document: JdfDocument): string {
  return text
    .replace(/\{\{pageNumber\}\}/g, String(pageIndex + 1))
    .replace(/\{\{totalPages\}\}/g, String(totalPages))
    .replace(/\{\{title\}\}/g, document.meta?.title || "")
    .replace(/\{\{author\}\}/g, document.meta?.author || "");
}

function HeaderFooterView(props: { hf: HeaderFooter; pageIndex: number; totalPages: number; document: JdfDocument; styles: Record<string, Style>; position: "top" | "bottom" }) {
  const css = () => resolveStyle(props.hf.style, props.styles);
  if (props.hf.content) {
    const text = resolveTemplateVars(props.hf.content, props.pageIndex, props.totalPages, props.document);
    return <div class="text-xs text-gray-500 px-1" style={css()}>{text}</div>;
  }
  if (props.hf.elements?.length) {
    return (
      <div class="relative" style={{ height: props.hf.height ? `${unitToPx(props.hf.height)}px` : "auto" }}>
        <For each={props.hf.elements}>
          {(el) => <ElementRenderer element={el} styles={props.styles} resources={props.document.resources} document={props.document} />}
        </For>
      </div>
    );
  }
  return null;
}

export function PageRenderer(props: PageRendererProps) {
  const dimensions = () => getPageDimensions(props.page.pageSize ?? props.document.meta.pageSize ?? "A4", props.page.pageOrientation ?? props.document.meta.pageOrientation ?? "portrait");
  const margins = () => ({ ...DEFAULT_MARGINS, ...(props.document.meta.margins || {}), ...(props.page.margins || {}) });
  const header = () => props.page.header || props.document.header;
  const footer = () => props.page.footer || props.document.footer;

  return (
    <div
      class="jdf-page page-shadow rounded-sm relative bg-white"
      style={{
        width: `${unitToPx(dimensions().width)}px`,
        "min-height": `${unitToPx(dimensions().height)}px`,
        "background-color": props.page.background || "#ffffff",
      }}
    >
      <Show when={header()}>
        <div class="absolute left-0 right-0 top-0" style={{ "padding-top": `${unitToPx(margins().top! / 2)}px`, "padding-left": `${unitToPx(margins().left!)}px`, "padding-right": `${unitToPx(margins().right!)}px` }}>
          <HeaderFooterView hf={header()!} pageIndex={props.pageIndex} totalPages={props.totalPages} document={props.document} styles={props.styles} position="top" />
        </div>
      </Show>

      <div
        class="relative"
        style={{
          "padding-top": `${unitToPx(margins().top!)}px`,
          "padding-right": `${unitToPx(margins().right!)}px`,
          "padding-bottom": `${unitToPx(margins().bottom!)}px`,
          "padding-left": `${unitToPx(margins().left!)}px`,
        }}
      >
        <For each={props.page.elements}>
          {(element) => (
            <ElementRenderer
              element={element}
              styles={props.document.styles || {}}
              resources={props.document.resources}
              document={props.document}
              onNavigatePage={props.onNavigatePage}
            />
          )}
        </For>
      </div>

      <Show when={footer()}>
        <div class="absolute left-0 right-0 bottom-0" style={{ "padding-bottom": `${unitToPx(margins().bottom! / 2)}px`, "padding-left": `${unitToPx(margins().left!)}px`, "padding-right": `${unitToPx(margins().right!)}px` }}>
          <HeaderFooterView hf={footer()!} pageIndex={props.pageIndex} totalPages={props.totalPages} document={props.document} styles={props.styles} position="bottom" />
        </div>
      </Show>
    </div>
  );
}
