import { For, Show } from "solid-js";
import type { Page, Style, HeaderFooter, JdfDocument } from "@jdf/core";
import { getPageDimensions, unitToPx, DEFAULT_MARGINS } from "@jdf/core";
import { ElementRenderer } from "./ElementRenderer";

interface PageRendererProps {
  page: Page;
  pageIndex: number;
  totalPages: number;
  document: JdfDocument;
  styles: Record<string, Style>;
}

export function resolveStyle(
  style: string | Style | undefined,
  styles: Record<string, Style>
): Record<string, string> {
  if (!style) return {};
  if (typeof style === "string") {
    return styleToCss(styles[style] || {});
  }
  return styleToCss(style);
}

export function styleToCss(style: Style): Record<string, string> {
  const css: Record<string, string> = {};
  if (style.fontFamily) css["font-family"] = style.fontFamily;
  if (style.fontSize) css["font-size"] = `${style.fontSize * 1.333}px`;
  if (style.fontWeight) css["font-weight"] = style.fontWeight;
  if (style.fontStyle) css["font-style"] = style.fontStyle;
  if (style.color) css["color"] = style.color;
  if (style.backgroundColor) css["background-color"] = style.backgroundColor;
  if (style.textAlign) css["text-align"] = style.textAlign;
  if (style.textDecoration) css["text-decoration"] = style.textDecoration;
  if (style.lineHeight) css["line-height"] = String(style.lineHeight);
  if (style.letterSpacing) css["letter-spacing"] = style.letterSpacing;
  if (style.margin) css["margin"] = style.margin;
  if (style.padding) css["padding"] = style.padding;
  if (style.border) css["border"] = style.border;
  if (style.borderRadius) css["border-radius"] = style.borderRadius;
  if (style.opacity != null) css["opacity"] = String(style.opacity);
  return css;
}

function resolveTemplateVars(
  text: string,
  pageIndex: number,
  totalPages: number,
  document: JdfDocument
): string {
  return text
    .replace(/\{\{pageNumber\}\}/g, String(pageIndex + 1))
    .replace(/\{\{totalPages\}\}/g, String(totalPages))
    .replace(/\{\{title\}\}/g, document.meta?.title || "")
    .replace(/\{\{author\}\}/g, document.meta?.author || "");
}

function renderHeaderFooter(
  hf: HeaderFooter | undefined,
  pageIndex: number,
  totalPages: number,
  document: JdfDocument,
  styles: Record<string, Style>
) {
  if (!hf) return null;
  const text = resolveTemplateVars(hf.content || "", pageIndex, totalPages, document);
  const css = resolveStyle(hf.style, styles);
  return (
    <div class="px-4 py-2 text-xs text-gray-500" style={css}>
      {text}
    </div>
  );
}

export function PageRenderer(props: PageRendererProps) {
  const dimensions = () => getPageDimensions(props.page);
  const margins = () => props.page.margins || DEFAULT_MARGINS;

  return (
    <div
      class="jdf-page bg-white shadow-md rounded-sm relative"
      style={{
        width: `${unitToPx(dimensions().width)}px`,
        "min-height": `${unitToPx(dimensions().height)}px`,
        "padding-top": `${unitToPx(margins().top)}px`,
        "padding-right": `${unitToPx(margins().right)}px`,
        "padding-bottom": `${unitToPx(margins().bottom)}px`,
        "padding-left": `${unitToPx(margins().left)}px`,
      }}
    >
      <Show when={props.page.header}>
        {renderHeaderFooter(props.page.header, props.pageIndex, props.totalPages, props.document, props.document.styles || {})}
      </Show>

      <div class="relative">
        <For each={props.page.elements}>
          {(element) => (
            <ElementRenderer
              element={element}
              styles={props.document.styles || {}}
              resources={props.document.resources}
              document={props.document}
            />
          )}
        </For>
      </div>

      <Show when={props.page.footer}>
        {renderHeaderFooter(props.page.footer, props.pageIndex, props.totalPages, props.document, props.document.styles || {})}
      </Show>
    </div>
  );
}
