import type { Margins, CustomPageSize, PageSizeName } from "./types";

export const PAGE_SIZES: Record<PageSizeName, CustomPageSize> = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
  Tabloid: { width: 279.4, height: 431.8 },
};

export const DEFAULT_MARGINS: Margins = { top: 25, right: 20, bottom: 25, left: 20 };
export const MM_TO_PX = 3.7795275591;
export const IN_TO_PX = 96;
export const PT_TO_PX = 1.3333333333;

export function unitToPx(value: number, unit: string = "mm"): number {
  switch (unit) {
    case "mm": return value * MM_TO_PX;
    case "in": return value * IN_TO_PX;
    case "pt": return value * PT_TO_PX;
    case "px": return value;
    default: return value * MM_TO_PX;
  }
}

export function getPageDimensions(pageSize: PageSizeName | CustomPageSize, orientation: "portrait" | "landscape" = "portrait"): CustomPageSize {
  const size = typeof pageSize === "string" ? PAGE_SIZES[pageSize] : pageSize;
  if (orientation === "landscape") return { width: size.height, height: size.width };
  return { ...size };
}
