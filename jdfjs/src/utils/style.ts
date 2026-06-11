import type { Style, StyleRef } from "@jdf/core";

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
  if (style.letterSpacing != null) {
    css["letter-spacing"] = typeof style.letterSpacing === "number" ? `${style.letterSpacing}px` : style.letterSpacing;
  }
  if (style.padding != null) css["padding"] = paddingToCss(style.padding);
  if (style.margin != null) css["margin"] = paddingToCss(style.margin as any);
  if (style.marginTop != null) css["margin-top"] = `${style.marginTop}px`;
  if (style.marginBottom != null) css["margin-bottom"] = `${style.marginBottom}px`;
  if (style.border) css["border"] = style.border;
  if (style.borderRadius != null) {
    css["border-radius"] = typeof style.borderRadius === "number" ? `${style.borderRadius}px` : style.borderRadius;
  }
  if (style.opacity != null) css["opacity"] = String(style.opacity);
  return css;
}

export function resolveStyle(ref: StyleRef | undefined, styles: Record<string, Style>): Record<string, string> {
  if (!ref) return {};
  if (typeof ref === "string") return styleToCss(styles[ref] || {});
  if (Array.isArray(ref)) {
    let merged: Style = {};
    for (const k of ref) merged = { ...merged, ...(styles[k] || {}) };
    return styleToCss(merged);
  }
  return styleToCss(ref);
}

/** Apply a CSS object map to an HTMLElement. */
export function applyStyle(el: HTMLElement, css: Record<string, string>) {
  for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v);
}
