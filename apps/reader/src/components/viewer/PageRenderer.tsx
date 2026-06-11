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

function HeaderFooterView(props: { hf: HeaderFooter; pageIndex: number; totalPages: number; document: JdfDocument; styles: Record<string, Style>; onNavigatePage?: (p: number) => void }) {
  const css = () => resolveStyle(props.hf.style, props.styles);
  const hasElements = () => Array.isArray(props.hf.elements) && props.hf.elements!.length > 0;
  const hasContent = () => typeof props.hf.content === "string" && props.hf.content.length > 0;

  return (
    <div class="text-xs text-gray-500" style={{ ...css(), ...(props.hf.height ? { height: `${unitToPx(props.hf.height)}px` } : {}), position: "relative" }}>
      <Show when={hasElements()}>
        <For each={props.hf.elements!}>
          {(el, i) => (
            <ElementRenderer
              element={el}
              path={["__hf__", props.pageIndex, i()]}
              styles={props.styles}
              resources={props.document.resources}
              document={props.document}
              onNavigatePage={props.onNavigatePage}
            />
          )}
        </For>
      </Show>
      <Show when={!hasElements() && hasContent()}>
        <div class="px-1">{resolveTemplateVars(props.hf.content!, props.pageIndex, props.totalPages, props.document)}</div>
      </Show>
    </div>
  );
}

export function PageRenderer(props: PageRendererProps) {
  const dimensions = () => getPageDimensions(props.page.pageSize ?? props.document.meta.pageSize ?? "A4", props.page.pageOrientation ?? props.document.meta.pageOrientation ?? "portrait");
  const margins = () => ({ ...DEFAULT_MARGINS, ...(props.document.meta.margins || {}), ...(props.page.margins || {}) });
  const header = () => props.page.header || props.document.header;
  const footer = () => props.page.footer || props.document.footer;
  const headerHeight = () => header()?.height ?? 0;
  const footerHeight = () => footer()?.height ?? 0;

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
        <div
          class="absolute left-0 right-0 top-0"
          style={{
            "padding-top": `${unitToPx(margins().top! / 2)}px`,
            "padding-left": `${unitToPx(margins().left!)}px`,
            "padding-right": `${unitToPx(margins().right!)}px`,
          }}
        >
          <HeaderFooterView hf={header()!} pageIndex={props.pageIndex} totalPages={props.totalPages} document={props.document} styles={props.styles} onNavigatePage={props.onNavigatePage} />
        </div>
      </Show>

      <div
        class="relative"
        style={{
          "padding-top": `${unitToPx(margins().top! + headerHeight())}px`,
          "padding-right": `${unitToPx(margins().right!)}px`,
          "padding-bottom": `${unitToPx(margins().bottom! + footerHeight())}px`,
          "padding-left": `${unitToPx(margins().left!)}px`,
        }}
      >
        <For each={props.page.elements}>
          {(element, index) => (
            <ElementRenderer
              element={element}
              path={["pages", props.pageIndex, "elements", index()]}
              styles={props.document.styles || {}}
              resources={props.document.resources}
              document={props.document}
              onNavigatePage={props.onNavigatePage}
            />
          )}
        </For>
      </div>

      <Show when={footer()}>
        <div
          class="absolute left-0 right-0 bottom-0"
          style={{
            "padding-bottom": `${unitToPx(margins().bottom! / 2)}px`,
            "padding-left": `${unitToPx(margins().left!)}px`,
            "padding-right": `${unitToPx(margins().right!)}px`,
          }}
        >
          <HeaderFooterView hf={footer()!} pageIndex={props.pageIndex} totalPages={props.totalPages} document={props.document} styles={props.styles} onNavigatePage={props.onNavigatePage} />
        </div>
      </Show>
    </div>
  );
}
