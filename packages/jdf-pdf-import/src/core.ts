import type { JdfDocument, Page, Element, TextElement, ImageResource, ShapeElement } from "@jdf/core";
import type { PdfImportRuntime } from "./types";
import { detectTables, calibrateGlyphWidth, hasStretchedSpaces, type TRun } from "./tables";
import { detectGutters, orderByColumns } from "./columns";
import { foldParagraphs, type LineMeta } from "./paragraphs";

const PT_TO_MM = 0.352778;

function classifyFont(name: string): { family: string; weight?: "normal" | "bold"; style?: "normal" | "italic" } {
  const n = (name || "").toLowerCase();
  const bold = /bold|black|heavy|semibold|demibold|extrabold/.test(n);
  const italic = /italic|oblique/.test(n);
  let family = "Inter, Helvetica, Arial, sans-serif";
  if (n.includes("times") || n.includes("serif") || n.includes("roman") || n.includes("georgia") || n.includes("garamond") || n.includes("baskerville")) {
    family = "Times New Roman, serif";
  } else if (n.includes("courier") || n.includes("mono") || n.includes("consolas") || n.includes("menlo") || n.includes("source code") || n.includes("fira code")) {
    family = "JetBrains Mono, ui-monospace, monospace";
  } else if (n.includes("helvetica") || n.includes("arial") || n.includes("sans") || n.includes("roboto") || n.includes("inter") || n.includes("noto")) {
    family = "Inter, Helvetica, Arial, sans-serif";
  }
  return {
    family,
    weight: bold ? "bold" : undefined,
    style: italic ? "italic" : undefined,
  };
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * A painted image. `name` is the PDF.js object id for XObjects; inline images
 * and image masks arrive as ready objects (`inline`) — masks are 1-bit
 * stencils painted with the fill colour active at paint time (`maskFill`).
 */
interface ImagePos {
  name: string;
  x: number; y: number; w: number; h: number;
  inline?: any;
  maskFill?: string;
}

/**
 * One `showText` operator with its resolved start position (viewport pt) and
 * the graphics state active at that moment. Text items from `getTextContent`
 * are matched to these by position — PDF.js merges adjacent operators into a
 * single item, so an index-based zip of operators ↔ items drifted as soon as
 * the first merge happened (every word after that got the wrong colour).
 */
interface TextOp { x: number; y: number; fontSize: number; fill: string; alpha: number; mode: number }

interface ShapeOp {
  kind: "rect" | "line" | "path";
  x: number; y: number; width: number; height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  path?: string;
}

interface ParsedOps {
  textOps: TextOp[];
  shapes: ShapeOp[];
  imagePositions: ImagePos[];
}

/** Average of a PDF.js RadialAxial gradient's colour stops — a flat stand-in
 *  for gradient fills (backgrounds, banners) that used to inherit whatever
 *  solid colour was set before the pattern. */
function averageStops(stops: any): string | null {
  if (!Array.isArray(stops) || stops.length === 0) return null;
  let r = 0, g = 0, b = 0, n = 0;
  for (const st of stops) {
    const css = Array.isArray(st) ? st[1] : null;
    const m = typeof css === "string" && css.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) continue;
    r += parseInt(m[1], 16); g += parseInt(m[2], 16); b += parseInt(m[3], 16); n++;
  }
  return n ? rgbToHex(r / n, g / n, b / n) : null;
}

/** Resolve a pattern operand (`["Shading", objId, matrix]` / `["TilingPattern", color, …]`)
 *  to a representative solid colour, or null when nothing sensible exists. */
function patternToColor(page: any, arg: any): string | null {
  if (!Array.isArray(arg)) return null;
  if (arg[0] === "TilingPattern") {
    const c = arg[1];
    return Array.isArray(c) && c.length >= 3 ? rgbToHex(c[0], c[1], c[2]) : null;
  }
  if (arg[0] === "Shading") {
    const id = arg[1];
    try {
      const store = typeof id === "string" && id.startsWith("g_") ? page.commonObjs : page.objs;
      if (typeof store?.has === "function" && !store.has(id)) return null;
      const ir = store.get(id);
      if (Array.isArray(ir) && ir[0] === "RadialAxial") return averageStops(ir[3]);
    } catch { /* unresolved — keep previous colour */ }
  }
  return null;
}

function multiplyCtm(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}
function tx(ctm: number[], x: number, y: number) {
  return { x: ctm[0] * x + ctm[2] * y + ctm[4], y: ctm[1] * x + ctm[3] * y + ctm[5] };
}

async function walkOps(page: any, OPS: any, viewport: any): Promise<ParsedOps> {
  const toViewport = (x: number, y: number) => {
    const [vx, vy] = viewport.convertToViewportPoint(x, y) as [number, number];
    return { x: vx, y: vy };
  };
  // Annotation appearance streams are excluded on purpose: form widgets are
  // emitted as real form elements from `getAnnotations()`, and
  // `getTextContent()` never includes annotation text — so leaving them in
  // both duplicated widget borders and threw text↔operator matching off.
  const opList = await page.getOperatorList({ annotationMode: annotationModeDisable });
  const fnArr: number[] = opList.fnArray;
  const argsArr: any[][] = opList.argsArray;

  const gs = {
    ctm: [1, 0, 0, 1, 0, 0] as number[],
    fill: "#000000",
    stroke: "#000000",
    lineWidth: 1,
    fillAlpha: 1,
    strokeAlpha: 1,
    textRenderingMode: 0,
    // Text state (PDF 9.3) — needed to know where each showText lands.
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    hscale: 1,
    leading: 0,
    rise: 0,
  };
  const snapshot = () => ({ ...gs, ctm: [...gs.ctm] });
  const stack: ReturnType<typeof snapshot>[] = [];

  const textOps: TextOp[] = [];
  const shapes: ShapeOp[] = [];
  const imagePositions: ImagePos[] = [];

  // Text matrix / line matrix (reset by BT).
  let tm: number[] = [1, 0, 0, 1, 0, 0];
  let tlm: number[] = [1, 0, 0, 1, 0, 0];

  function pushImage(name: string, ctm: number[], inline?: any, maskFill?: string) {
    const corners = [tx(ctm, 0, 0), tx(ctm, 1, 0), tx(ctm, 1, 1), tx(ctm, 0, 1)];
    const vpCorners = corners.map((p) => toViewport(p.x, p.y));
    const xs = vpCorners.map((p) => p.x), ys = vpCorners.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    imagePositions.push({
      name,
      x: minX * PT_TO_MM,
      y: minY * PT_TO_MM,
      w: (maxX - minX) * PT_TO_MM,
      h: (maxY - minY) * PT_TO_MM,
      inline,
      maskFill,
    });
  }
  let pathSegments: { type: "M" | "L" | "C" | "Q" | "Z" | "RECT"; pts: number[] }[] = [];
  let pathRect: { x: number; y: number; w: number; h: number } | null = null;
  // Rectangles packed inside constructPath (several per path is common: a
  // table's cell borders are often one path of many `re`).
  let pathRects: { x: number; y: number; w: number; h: number }[] = [];
  let pathStart: { x: number; y: number } | null = null;
  let pathLast: { x: number; y: number } | null = null;

  function flushPath(isFill: boolean, isStroke: boolean) {
    for (const r of pathRects) {
      const tl = toViewport(r.x, r.y + r.h);
      const br = toViewport(r.x + r.w, r.y);
      shapes.push({
        kind: "rect",
        x: Math.min(tl.x, br.x) * PT_TO_MM,
        y: Math.min(tl.y, br.y) * PT_TO_MM,
        width: Math.abs(br.x - tl.x) * PT_TO_MM,
        height: Math.abs(br.y - tl.y) * PT_TO_MM,
        fill: isFill ? gs.fill : undefined,
        stroke: isStroke ? gs.stroke : undefined,
        strokeWidth: isStroke ? gs.lineWidth * PT_TO_MM : undefined,
        opacity: isFill ? gs.fillAlpha : gs.strokeAlpha,
      });
    }
    pathRects = [];
    if (pathRect) {
      const tl = toViewport(pathRect.x, pathRect.y + pathRect.h);
      const br = toViewport(pathRect.x + pathRect.w, pathRect.y);
      const x = Math.min(tl.x, br.x);
      const y = Math.min(tl.y, br.y);
      const w = Math.abs(br.x - tl.x);
      const h = Math.abs(br.y - tl.y);
      shapes.push({
        kind: "rect",
        x: x * PT_TO_MM,
        y: y * PT_TO_MM,
        width: w * PT_TO_MM,
        height: h * PT_TO_MM,
        fill: isFill ? gs.fill : undefined,
        stroke: isStroke ? gs.stroke : undefined,
        strokeWidth: isStroke ? gs.lineWidth * PT_TO_MM : undefined,
        opacity: isFill ? gs.fillAlpha : gs.strokeAlpha,
      });
    } else if (pathSegments.length === 2 && pathSegments[0].type === "M" && pathSegments[1].type === "L") {
      const a = pathSegments[0].pts;
      const b = pathSegments[1].pts;
      const va = toViewport(a[0], a[1]);
      const vb = toViewport(b[0], b[1]);
      const minX = Math.min(va.x, vb.x);
      const minY = Math.min(va.y, vb.y);
      const maxX = Math.max(va.x, vb.x);
      const maxY = Math.max(va.y, vb.y);
      const x1Local = (va.x - minX) * PT_TO_MM;
      const y1Local = (va.y - minY) * PT_TO_MM;
      const x2Local = (vb.x - minX) * PT_TO_MM;
      const y2Local = (vb.y - minY) * PT_TO_MM;
      const wLocal = Math.max(0.05, (maxX - minX) * PT_TO_MM);
      const hLocal = Math.max(0.05, (maxY - minY) * PT_TO_MM);
      // Axis-aligned single segments (horizontal / vertical rules — the vast
      // majority of PDF divider lines) become a real `line` shape. All three
      // renderers draw `line` from the box's (0,0) to (w,h) corner, so only
      // axis-aligned lines round-trip without losing direction; genuinely
      // diagonal segments stay a `path` to preserve their slope.
      const dx = Math.abs(va.x - vb.x);
      const dy = Math.abs(va.y - vb.y);
      const axisAligned = dx < 0.5 || dy < 0.5;
      if (axisAligned) {
        shapes.push({
          kind: "line",
          x: minX * PT_TO_MM,
          y: minY * PT_TO_MM,
          width: wLocal,
          height: hLocal,
          stroke: isStroke ? gs.stroke : undefined,
          strokeWidth: isStroke ? gs.lineWidth * PT_TO_MM : undefined,
          opacity: gs.strokeAlpha,
        });
      } else {
        shapes.push({
          kind: "path",
          x: minX * PT_TO_MM,
          y: minY * PT_TO_MM,
          width: wLocal,
          height: hLocal,
          stroke: isStroke ? gs.stroke : undefined,
          strokeWidth: isStroke ? gs.lineWidth * PT_TO_MM : undefined,
          opacity: gs.strokeAlpha,
          path: `M ${x1Local.toFixed(2)} ${y1Local.toFixed(2)} L ${x2Local.toFixed(2)} ${y2Local.toFixed(2)}`,
        });
      }
    } else if (pathSegments.length > 0) {
      const vpSegments = pathSegments.map((seg) => {
        if (seg.type === "Z") return seg;
        const out: number[] = [];
        for (let i = 0; i < seg.pts.length; i += 2) {
          const v = toViewport(seg.pts[i], seg.pts[i + 1]);
          out.push(v.x, v.y);
        }
        return { type: seg.type, pts: out };
      });
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const seg of vpSegments) {
        for (let i = 0; i < seg.pts.length; i += 2) {
          const x = seg.pts[i];
          const y = seg.pts[i + 1];
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (isFinite(minX) && isFinite(minY)) {
        const bw = maxX - minX;
        const bh = maxY - minY;
        const d = vpSegments.map((seg) => {
          if (seg.type === "Z") return "Z";
          const p: string[] = [];
          for (let i = 0; i < seg.pts.length; i += 2) {
            p.push(((seg.pts[i] - minX) * PT_TO_MM).toFixed(2));
            p.push(((seg.pts[i + 1] - minY) * PT_TO_MM).toFixed(2));
          }
          return `${seg.type} ${p.join(" ")}`;
        }).join(" ");
        shapes.push({
          kind: "path",
          x: minX * PT_TO_MM,
          y: minY * PT_TO_MM,
          width: bw * PT_TO_MM,
          height: bh * PT_TO_MM,
          fill: isFill ? gs.fill : undefined,
          stroke: isStroke ? gs.stroke : undefined,
          strokeWidth: isStroke ? gs.lineWidth * PT_TO_MM : undefined,
          opacity: isFill ? gs.fillAlpha : gs.strokeAlpha,
          path: d,
        });
      }
    }
    pathSegments = [];
    pathRect = null;
    pathStart = null;
    pathLast = null;
  }

  for (let i = 0; i < fnArr.length; i++) {
    const fn = fnArr[i];
    const args = argsArr[i] || [];

    if (fn === OPS.save) {
      stack.push(snapshot());
    } else if (fn === OPS.restore) {
      const s = stack.pop();
      if (s) Object.assign(gs, s);
    } else if (fn === OPS.paintFormXObjectBegin) {
      // Form XObjects (logos, headers, anything placed with `Do`) carry their
      // own /Matrix. PDF.js inlines their content between Begin/End and
      // expects the consumer to apply that matrix — ignoring it put every
      // nested drawing at the wrong place (or off-page) for Word/InDesign PDFs.
      stack.push(snapshot());
      const matrix = args[0];
      if (Array.isArray(matrix) && matrix.length === 6) gs.ctm = multiplyCtm(matrix as number[], gs.ctm);
    } else if (fn === OPS.paintFormXObjectEnd) {
      const s = stack.pop();
      if (s) Object.assign(gs, s);
    } else if (fn === OPS.beginText) {
      tm = [1, 0, 0, 1, 0, 0];
      tlm = [1, 0, 0, 1, 0, 0];
    } else if (fn === OPS.setTextMatrix) {
      tm = [...(args as number[])];
      tlm = [...tm];
    } else if (fn === OPS.moveText) {
      tlm = multiplyCtm([1, 0, 0, 1, args[0], args[1]], tlm);
      tm = [...tlm];
    } else if (fn === OPS.setLeadingMoveText) {
      gs.leading = -args[1];
      tlm = multiplyCtm([1, 0, 0, 1, args[0], args[1]], tlm);
      tm = [...tlm];
    } else if (fn === OPS.nextLine) {
      tlm = multiplyCtm([1, 0, 0, 1, 0, -gs.leading], tlm);
      tm = [...tlm];
    } else if (fn === OPS.setLeading) {
      gs.leading = args[0];
    } else if (fn === OPS.setFont) {
      gs.fontSize = typeof args[1] === "number" ? args[1] : gs.fontSize;
    } else if (fn === OPS.setCharSpacing) {
      gs.charSpacing = args[0];
    } else if (fn === OPS.setWordSpacing) {
      gs.wordSpacing = args[0];
    } else if (fn === OPS.setHScale) {
      gs.hscale = (args[0] ?? 100) / 100;
    } else if (fn === OPS.setTextRise) {
      gs.rise = args[0];
    } else if (fn === OPS.setFillColorN) {
      const c = patternToColor(page, args[0]);
      if (c) gs.fill = c;
    } else if (fn === OPS.setStrokeColorN) {
      const c = patternToColor(page, args[0]);
      if (c) gs.stroke = c;
    } else if (fn === OPS.transform) {
      // PDF `cm` prepends: the new coordinate system is the operand applied
      // FIRST, then the existing CTM (effectiveCTM = oldCTM ∘ M). That is
      // multiplyCtm(M, oldCTM) — NOT multiplyCtm(oldCTM, M). The reversed order
      // is a no-op for a single top-level transform but sends images and shapes
      // thousands of units off-page once transforms nest (e.g. Chrome's
      // 300-DPI→pt flip wrapping a local image placement matrix).
      gs.ctm = multiplyCtm(args as number[], gs.ctm);
    } else if (fn === OPS.setFillRGBColor) {
      gs.fill = rgbToHex(args[0], args[1], args[2]);
    } else if (fn === OPS.setStrokeRGBColor) {
      gs.stroke = rgbToHex(args[0], args[1], args[2]);
    } else if (fn === OPS.setFillGray) {
      gs.fill = rgbToHex(args[0], args[0], args[0]);
    } else if (fn === OPS.setStrokeGray) {
      gs.stroke = rgbToHex(args[0], args[0], args[0]);
    } else if (fn === OPS.setFillCMYKColor || fn === OPS.setStrokeCMYKColor) {
      // PDF.js delivers CMYK args as floats in 0..1 — same range as the PDF
      // operator. The previous version divided by 255 (treating them as bytes
      // from the RGB path), which collapsed every CMYK colour to ~white.
      const c = args[0], m = args[1], y = args[2], k = args[3];
      const r = (1 - c) * (1 - k) * 255;
      const g = (1 - m) * (1 - k) * 255;
      const b = (1 - y) * (1 - k) * 255;
      const hex = rgbToHex(r, g, b);
      if (fn === OPS.setFillCMYKColor) gs.fill = hex; else gs.stroke = hex;
    } else if (fn === OPS.setLineWidth) {
      gs.lineWidth = args[0];
    } else if (fn === OPS.setTextRenderingMode) {
      gs.textRenderingMode = args[0];
    } else if (fn === OPS.setGState) {
      const dict = args[0];
      if (Array.isArray(dict)) {
        for (const entry of dict) {
          if (!Array.isArray(entry)) continue;
          const [key, val] = entry;
          if (key === "LW") gs.lineWidth = val;
          else if (key === "ca") gs.fillAlpha = val;
          else if (key === "CA") gs.strokeAlpha = val;
        }
      }
    } else if (fn === OPS.showText) {
      // PDF.js has already folded TJ / ' / " into plain showText ops (with
      // kerning numbers inline), so this is the only text-painting operator.
      const trm = multiplyCtm(tm, gs.ctm);
      const origin = tx(trm, 0, gs.rise);
      const vp = toViewport(origin.x, origin.y);
      // |Tm scale| × Tf gives the rendered size, matching textContent's transform.
      const scale = Math.hypot(trm[2], trm[3]) || 1;
      textOps.push({ x: vp.x, y: vp.y, fontSize: gs.fontSize * scale, fill: gs.fill, alpha: gs.fillAlpha, mode: gs.textRenderingMode });
      // Advance the text matrix past the glyphs so a following showText
      // (font switch mid-line) starts where PDF.js's next item will start.
      let advance = 0;
      const glyphs = Array.isArray(args[0]) ? args[0] : [];
      for (const g of glyphs) {
        if (typeof g === "number") {
          advance += (-g / 1000) * gs.fontSize * gs.hscale;
        } else if (g && typeof g === "object") {
          const w = typeof g.width === "number" ? g.width : 0;
          advance += ((w / 1000) * gs.fontSize + gs.charSpacing + (g.isSpace ? gs.wordSpacing : 0)) * gs.hscale;
        }
      }
      tm = multiplyCtm([1, 0, 0, 1, advance, 0], tm);
    } else if (fn === OPS.rectangle) {
      const [x, y, w, h] = args as number[];
      const p1 = tx(gs.ctm, x, y);
      const p3 = tx(gs.ctm, x + w, y + h);
      pathRect = {
        x: Math.min(p1.x, p3.x),
        y: Math.min(p1.y, p3.y),
        w: Math.abs(p3.x - p1.x),
        h: Math.abs(p3.y - p1.y),
      };
    } else if (fn === OPS.constructPath) {
      const [pathOps, pathArgs] = args as [number[], number[]];
      let ai = 0;
      for (const op of pathOps) {
        if (op === OPS.moveTo) {
          const p = tx(gs.ctm, pathArgs[ai], pathArgs[ai + 1]); ai += 2;
          pathSegments.push({ type: "M", pts: [p.x, p.y] });
          pathStart = { x: p.x, y: p.y };
          pathLast = { x: p.x, y: p.y };
        } else if (op === OPS.lineTo) {
          const p = tx(gs.ctm, pathArgs[ai], pathArgs[ai + 1]); ai += 2;
          pathSegments.push({ type: "L", pts: [p.x, p.y] });
          pathLast = { x: p.x, y: p.y };
        } else if (op === OPS.curveTo) {
          const p1 = tx(gs.ctm, pathArgs[ai], pathArgs[ai + 1]); ai += 2;
          const p2 = tx(gs.ctm, pathArgs[ai], pathArgs[ai + 1]); ai += 2;
          const p3 = tx(gs.ctm, pathArgs[ai], pathArgs[ai + 1]); ai += 2;
          pathSegments.push({ type: "C", pts: [p1.x, p1.y, p2.x, p2.y, p3.x, p3.y] });
          pathLast = { x: p3.x, y: p3.y };
        } else if (op === OPS.curveTo2) {
          const p2 = tx(gs.ctm, pathArgs[ai], pathArgs[ai + 1]); ai += 2;
          const p3 = tx(gs.ctm, pathArgs[ai], pathArgs[ai + 1]); ai += 2;
          const p1 = pathLast || { x: 0, y: 0 };
          pathSegments.push({ type: "C", pts: [p1.x, p1.y, p2.x, p2.y, p3.x, p3.y] });
          pathLast = { x: p3.x, y: p3.y };
        } else if (op === OPS.curveTo3) {
          const p1 = tx(gs.ctm, pathArgs[ai], pathArgs[ai + 1]); ai += 2;
          const p3 = tx(gs.ctm, pathArgs[ai], pathArgs[ai + 1]); ai += 2;
          pathSegments.push({ type: "C", pts: [p1.x, p1.y, p3.x, p3.y, p3.x, p3.y] });
          pathLast = { x: p3.x, y: p3.y };
        } else if (op === OPS.closePath) {
          pathSegments.push({ type: "Z", pts: [] });
          if (pathStart) pathLast = { ...pathStart };
        } else if (op === OPS.rectangle) {
          // PDF.js 4.x packs `re` operators into constructPath. Without this
          // arm every filled/stroked rectangle drawn that way (table cell
          // backgrounds and borders in browser-printed PDFs, most boxes in
          // modern generators) was silently dropped: 200+ fills, 0 shapes.
          const x = pathArgs[ai], y = pathArgs[ai + 1], w = pathArgs[ai + 2], h = pathArgs[ai + 3]; ai += 4;
          const p1 = tx(gs.ctm, x, y);
          const p3 = tx(gs.ctm, x + w, y + h);
          pathRects.push({ x: Math.min(p1.x, p3.x), y: Math.min(p1.y, p3.y), w: Math.abs(p3.x - p1.x), h: Math.abs(p3.y - p1.y) });
        }
      }
    } else if (
      fn === OPS.fill || fn === OPS.stroke || fn === OPS.fillStroke ||
      fn === OPS.eoFill || fn === OPS.eoFillStroke ||
      fn === OPS.closeFillStroke || fn === OPS.closeStroke || fn === OPS.closeEOFillStroke
    ) {
      const isFill = fn === OPS.fill || fn === OPS.fillStroke || fn === OPS.eoFill || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke;
      const isStroke = fn === OPS.stroke || fn === OPS.fillStroke || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke || fn === OPS.closeStroke || fn === OPS.closeEOFillStroke;
      flushPath(isFill, isStroke);
    } else if (fn === OPS.endPath || fn === OPS.clip || fn === OPS.eoClip) {
      pathSegments = [];
      pathRects = [];
      pathRect = null;
      pathStart = null;
      pathLast = null;
    } else if (fn === OPS.paintImageXObject) {
      pushImage(String(args[0]), gs.ctm);
    } else if (fn === OPS.paintImageXObjectRepeat) {
      // Same XObject stamped at several positions (tiled backgrounds, repeated
      // icons): [objId, scaleX, scaleY, [x0, y0, x1, y1, …]].
      const [name, scaleX, scaleY, positions] = args as [string, number, number, number[]];
      if (Array.isArray(positions)) {
        for (let k = 0; k + 1 < positions.length; k += 2) {
          pushImage(String(name), multiplyCtm([scaleX, 0, 0, scaleY, positions[k], positions[k + 1]], gs.ctm));
        }
      }
    } else if (fn === OPS.paintInlineImageXObject) {
      // Inline images (BI … ID … EI) never enter the object store — PDF.js
      // hands us the decoded pixels directly.
      const img = args[0];
      if (img && typeof img === "object") pushImage(`inline-${imagePositions.length}`, gs.ctm, img);
    } else if (fn === OPS.paintImageMaskXObject) {
      // 1-bit stencil mask painted in the current fill colour (scanned
      // signatures, icons in monochrome PDFs, Type3-ish artwork).
      const img = args[0];
      if (img && typeof img === "object") pushImage(`mask-${imagePositions.length}`, gs.ctm, img, gs.fill);
    } else if (fn === OPS.paintImageMaskXObjectRepeat) {
      const [img, scaleX, skewX, skewY, scaleY, positions] = args as [any, number, number, number, number, number[]];
      if (img && typeof img === "object" && Array.isArray(positions)) {
        for (let k = 0; k + 1 < positions.length; k += 2) {
          pushImage(`mask-${imagePositions.length}`, multiplyCtm([scaleX, skewX, skewY, scaleY, positions[k], positions[k + 1]], gs.ctm), img, gs.fill);
        }
      }
    } else if (fn === OPS.paintImageMaskXObjectGroup) {
      const group = args[0];
      if (Array.isArray(group)) {
        for (const img of group) {
          if (img && typeof img === "object" && Array.isArray(img.transform)) {
            pushImage(`mask-${imagePositions.length}`, multiplyCtm(img.transform, gs.ctm), img, gs.fill);
          }
        }
      }
    }
  }

  return { textOps, shapes, imagePositions };
}

async function extractImages(
  page: any,
  positions: ImagePos[],
  runtime: PdfImportRuntime,
  /** Cross-page cache keyed by PDF XObject `name`. Same logo on 1000 pages
   *  resolves once and produces one shared resource entry instead of 1000. */
  dataUrlCache: Map<string, string>,
): Promise<{ pos: ImagePos; dataUrl: string }[]> {
  // Resolve every image position in parallel — for image-heavy pages
  // (presentations, marketing PDFs) the previous serial loop turned into a
  // multi-second wait per page. Each lookup still races a 250ms fallback in
  // case the PDF.js callback never fires; the timer is cleared as soon as
  // the real callback resolves so it doesn't pile up timers across pages.
  const resolveObj = (id: string) => new Promise<any>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => done(null), 250);
    const done = (v: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    try {
      const store = id.startsWith("g_") ? page.commonObjs : page.objs;
      store.get(id, (img: any) => done(img));
    } catch {
      try {
        page.objs.get(id, (img: any) => done(img));
      } catch {
        done(null);
      }
    }
  });

  /** Expand a 1-bit stencil mask (bit 0 = paint, PDF.js convention) into an
   *  RGBA buffer filled with the stencil's paint colour. */
  const maskToRgba = (data: Uint8Array, width: number, height: number, fill: string): Uint8ClampedArray => {
    const m = fill.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    const r = m ? parseInt(m[1], 16) : 0, g = m ? parseInt(m[2], 16) : 0, b = m ? parseInt(m[3], 16) : 0;
    const out = new Uint8ClampedArray(width * height * 4);
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = data[y * rowBytes + (x >> 3)] ?? 0xff;
        const bit = (byte >> (7 - (x & 7))) & 1;
        const o = (y * width + x) * 4;
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = bit ? 0 : 255;
      }
    }
    return out;
  };

  const encode = async (imgObj: any, maskFill?: string): Promise<string | null> => {
    if (!imgObj || !imgObj.width || !imgObj.height) return null;
    let data: any = imgObj.data;
    // Large masks / images keep their pixels in the object store and pass an id.
    if (typeof data === "string") data = (await resolveObj(data))?.data ?? null;
    if (maskFill) {
      if (!data) return null;
      return runtime.encodePng(imgObj.width, imgObj.height, 3, maskToRgba(data, imgObj.width, imgObj.height, maskFill));
    }
    if (data) {
      let kind = imgObj.kind || 0;
      if (!kind) {
        // Infer from the buffer length when PDF.js omitted the kind.
        const px = imgObj.width * imgObj.height;
        if (data.length === px * 4) kind = 3;
        else if (data.length === px * 3) kind = 2;
        else if (data.length === ((imgObj.width + 7) >> 3) * imgObj.height) kind = 1;
      }
      return runtime.encodePng(imgObj.width, imgObj.height, kind, data);
    }
    if (imgObj.bitmap) {
      // ImageBitmap path (OffscreenCanvas-capable hosts). Paint it onto a
      // runtime canvas and read the PNG back.
      try {
        const { canvas, context } = runtime.createCanvas(imgObj.width, imgObj.height);
        context.drawImage(imgObj.bitmap, 0, 0);
        if (typeof canvas.toDataURL === "function") return canvas.toDataURL("image/png");
        if (typeof canvas.toBuffer === "function") return `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
      } catch { /* fall through */ }
    }
    return null;
  };

  const tasks = positions.map(async (pos) => {
    if (pos.inline) {
      // Inline images and stencil masks are page-local objects; the same
      // stencil painted in two colours must not share a cache entry.
      const dataUrl = await encode(pos.inline, pos.maskFill);
      return dataUrl ? { pos, dataUrl } : null;
    }
    if (dataUrlCache.has(pos.name)) {
      return { pos, dataUrl: dataUrlCache.get(pos.name)! };
    }
    let imgObj: any = null;
    try { imgObj = await resolveObj(pos.name); } catch { imgObj = null; }
    const dataUrl = await encode(imgObj);
    if (!dataUrl) return null;
    dataUrlCache.set(pos.name, dataUrl);
    return { pos, dataUrl };
  });
  const settled = await Promise.all(tasks);
  return settled.filter((x): x is { pos: ImagePos; dataUrl: string } => x !== null);
}

interface TextRun {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontName: string;
  width: number;
  height: number;
  color: string;
  opacity: number;
}

interface LinkAnnot {
  rectMm: { x: number; y: number; w: number; h: number };
  url?: string;
  destPage?: number;
}

async function resolveDestPage(doc: any, dest: any): Promise<number | undefined> {
  try {
    let d = dest;
    if (typeof d === "string") d = await doc.getDestination(d);
    if (Array.isArray(d) && d[0] != null) {
      if (typeof d[0] === "number") return d[0]; // some producers store the index directly
      const idx = await doc.getPageIndex(d[0]);
      if (typeof idx === "number") return idx;
    }
  } catch { /* unresolvable destination */ }
  return undefined;
}

async function extractLinks(doc: any, page: any, viewport: any): Promise<LinkAnnot[]> {
  const out: LinkAnnot[] = [];
  let annots: any[] = [];
  try {
    annots = await page.getAnnotations();
  } catch {
    return out;
  }
  const conv = (x: number, y: number) => {
    const [vx, vy] = viewport.convertToViewportPoint(x, y) as [number, number];
    return { x: vx, y: vy };
  };
  for (const a of annots) {
    if (a.subtype !== "Link") continue;
    if (!a.rect || a.rect.length < 4) continue;
    const [x1, y1, x2, y2] = a.rect;
    const c1 = conv(x1, y1);
    const c2 = conv(x2, y2);
    const xMin = Math.min(c1.x, c2.x);
    const yMin = Math.min(c1.y, c2.y);
    const xMax = Math.max(c1.x, c2.x);
    const yMax = Math.max(c1.y, c2.y);
    const rectMm = {
      x: xMin * PT_TO_MM,
      y: yMin * PT_TO_MM,
      w: (xMax - xMin) * PT_TO_MM,
      h: (yMax - yMin) * PT_TO_MM,
    };
    const url = a.url || a.unsafeUrl;
    // Internal links (TOC entries, "see page 12") carry a destination instead
    // of a URL; resolve it to a page index so the JDF gets `#page-N`.
    const destPage = url ? undefined : await resolveDestPage(doc, a.dest);
    if (!url && destPage == null) continue;
    out.push({ rectMm, url, destPage });
  }
  return out;
}

/**
 * PDF AcroForm widget annotation → JDF form element. Each Widget annotation
 * carries the field type (`fieldType` ∈ "Tx" | "Btn" | "Ch" | "Sig"), the
 * current `fieldValue`, the field `fieldName`, and a `rect` in PDF user
 * space. We map them to JDF input / textarea / checkbox / select / signature
 * elements with `value` set to whatever's in the PDF — so opening a partly-
 * filled PDF in JDF Reader / jdf.js shows the same partial fill, and
 * exporting the JDF back to PDF preserves the values.
 *
 * Notes:
 *  - PDF "Tx" fields with `multiLine` flag (Ff bit 13 = 4096) become textarea.
 *  - PDF "Btn" can be checkbox, radio, or pushbutton — we only emit form
 *    elements for checkboxes (Ff bit 16 = 32768 unset, bit 17 = 65536 unset).
 *  - PDF "Ch" can be combo (dropdown) or list (multi-select). The combo
 *    flag is Ff bit 17 = 131072.
 */
interface FormWidget {
  rectMm: { x: number; y: number; w: number; h: number };
  fieldType: string;
  fieldName: string;
  fieldValue: any;
  multiLine: boolean;
  multiSelect: boolean;
  combo: boolean;
  pushButton: boolean;
  radio: boolean;
  options: { value: string; label?: string }[];
  readonly: boolean;
  required: boolean;
}

async function extractFormWidgets(page: any, viewport: any): Promise<FormWidget[]> {
  const out: FormWidget[] = [];
  let annots: any[] = [];
  try { annots = await page.getAnnotations(); } catch { return out; }
  const conv = (x: number, y: number) => {
    const [vx, vy] = viewport.convertToViewportPoint(x, y) as [number, number];
    return { x: vx, y: vy };
  };
  for (const a of annots) {
    if (a.subtype !== "Widget") continue;
    if (!a.rect || a.rect.length < 4) continue;
    const [x1, y1, x2, y2] = a.rect;
    const c1 = conv(x1, y1);
    const c2 = conv(x2, y2);
    const xMin = Math.min(c1.x, c2.x);
    const yMin = Math.min(c1.y, c2.y);
    const xMax = Math.max(c1.x, c2.x);
    const yMax = Math.max(c1.y, c2.y);
    const flags = typeof a.fieldFlags === "number" ? a.fieldFlags : 0;
    const options: { value: string; label?: string }[] = Array.isArray(a.options)
      ? a.options.map((o: any) => ({
          value: typeof o?.exportValue === "string" ? o.exportValue : (typeof o?.value === "string" ? o.value : ""),
          label: typeof o?.displayValue === "string" ? o.displayValue : undefined,
        })).filter((o: any) => o.value !== "")
      : [];
    out.push({
      rectMm: {
        x: xMin * PT_TO_MM,
        y: yMin * PT_TO_MM,
        w: (xMax - xMin) * PT_TO_MM,
        h: (yMax - yMin) * PT_TO_MM,
      },
      fieldType: a.fieldType || "",
      fieldName: a.fieldName || `field-${out.length + 1}`,
      fieldValue: a.fieldValue ?? a.buttonValue ?? "",
      multiLine: (flags & 4096) !== 0,
      multiSelect: (flags & 2097152) !== 0,
      combo: (flags & 131072) !== 0,
      pushButton: (flags & 65536) !== 0,
      radio: (flags & 32768) !== 0,
      options,
      readonly: (flags & 1) !== 0,
      required: (flags & 2) !== 0,
    });
  }
  return out;
}

interface OutlineEntry { title: string; pageIndex: number; depth: number }

async function flattenOutline(doc: any, outline: any[] | null): Promise<OutlineEntry[]> {
  if (!outline) return [];
  const out: OutlineEntry[] = [];
  async function walk(items: any[], depth: number) {
    for (const item of items) {
      const idx = await resolveDestPage(doc, item.dest);
      if (idx != null && typeof item.title === "string" && item.title.trim()) {
        out.push({ title: item.title.trim(), pageIndex: idx, depth });
      }
      if (item.items?.length) await walk(item.items, depth + 1);
    }
  }
  await walk(outline, 1);
  return out;
}

const normTitle = (s: string) => s.toLowerCase().replace(/[\s\u00a0]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();

/**
 * Tag text elements with the PDF's own bookmark (outline) structure. A
 * bookmark titled "3. Results" pointing at page 7 promotes the matching text
 * on that page to a heading with `tocEntry`, so the reader sidebar, jdf.js
 * TOC and `jdf chunk --strategy section` follow the author's structure
 * instead of font-size guesses alone.
 */
function applyOutline(pages: Page[], outline: OutlineEntry[]) {
  for (const entry of outline) {
    const page = pages[entry.pageIndex];
    if (!page) continue;
    const want = normTitle(entry.title);
    if (!want) continue;
    let best: TextElement | null = null;
    let bestScore = 0;
    for (const el of page.elements) {
      if (el.type !== "text") continue;
      const have = normTitle(el.content || "");
      if (!have) continue;
      let score = 0;
      if (have === want) score = 3;
      else if (have.startsWith(want) || want.startsWith(have)) score = 2;
      else if (have.length >= 6 && want.includes(have)) score = 1;
      if (score > bestScore || (score === bestScore && best && score > 0 && (el.position?.y ?? 0) < (best.position?.y ?? 0))) {
        best = el; bestScore = score;
      }
    }
    if (best && bestScore > 0) {
      const level = Math.min(6, Math.max(1, entry.depth)) as 1 | 2 | 3 | 4 | 5 | 6;
      if (!best.heading) best.heading = level;
      best.tocEntry = entry.title;
      best.tocLevel = level;
    }
  }
}

/** PDF date string (`D:YYYYMMDDHHmmSSOHH'mm'`) → ISO-8601, or undefined. */
function pdfDateToIso(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(/^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/);
  if (!m) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
  }
  const [, Y, Mo = "01", D = "01", h = "00", mi = "00", s = "00", sign, oh = "00", om = "00"] = m;
  const tz = !sign || sign === "Z" || sign === "z" ? "Z" : `${sign}${oh}:${om}`;
  const iso = `${Y}-${Mo}-${D}T${h}:${mi}:${s}${tz}`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

export interface ImportPdfOptions {
  /** Rebuild tables from positioned text (+ drawn borders) into real `table`
   *  elements. Default true; set false to keep every run as loose text. */
  detectTables?: boolean;
  /** Reorder text/tables on multi-column pages into reading order (default true). Rendering is unaffected — only element sequence. */
  readingOrder?: boolean;
  /** Fold consecutive body lines into paragraph elements (default true). Boxes cover the same area; text becomes whole for chunking/search. */
  foldParagraphs?: boolean;
  /** Optional pdfjs-dist module override (already initialised). */
  pdfjs?: any;
  /** Password for encrypted PDFs (tried first). */
  password?: string;
  /**
   * Interactive password source. Called when the PDF is encrypted and
   * `password` is missing or wrong; `retry` is true after a rejected attempt.
   * Resolve with `null` to cancel the import.
   */
  onPassword?: (retry: boolean) => Promise<string | null>;
  /**
   * What to do with text drawn in rendering mode 3 (invisible) — the OCR
   * layer of scanned PDFs. `keep` (default) emits it with `opacity: 0` so
   * search, `jdf chunk` and RAG see the words while the page still looks
   * like the scan; `drop` omits it.
   */
  invisibleText?: "keep" | "drop";
}

// pdfjs.AnnotationMode.DISABLE — literal so a runtime without the enum still works.
const annotationModeDisable = 0;

/**
 * Convert a PDF (bytes / ArrayBuffer / file path) into a JdfDocument.
 *
 * @param source  Bytes, ArrayBuffer, or a file path. File paths require the
 *                runtime to expose `readFile` (node entry point does, browser
 *                does not — pass bytes from the browser).
 * @param title   Document title — usually the original filename minus extension.
 * @param runtime Adapter providing canvas + PNG encoding for the host environment.
 */
export async function importPdfToJdf(
  source: Uint8Array | ArrayBuffer | string,
  title: string,
  runtime: PdfImportRuntime,
  options: ImportPdfOptions = {},
): Promise<JdfDocument> {
  const pdfjs = options.pdfjs || runtime.pdfjs;
  if (!pdfjs) {
    throw new Error("[@jdf/pdf-import] runtime did not provide a pdfjs module");
  }
  const OPS = pdfjs.OPS;
  let data: any;
  if (typeof source === "string") {
    if (source.startsWith("data:") || source.startsWith("http")) {
      const r = await fetch(source);
      data = await r.arrayBuffer();
    } else {
      if (!runtime.readFile) {
        throw new Error("[@jdf/pdf-import] cannot read file path: runtime has no readFile()");
      }
      data = await runtime.readFile(source);
    }
  } else {
    data = source;
  }

  const loadingTask = pdfjs.getDocument({
    data,
    // The runtime adapter declares whether it supports a real Web Worker.
    // We don't sniff `typeof Worker` here because Node 22+ exposes a global
    // `Worker` (worker_threads) that isn't compatible with PDF.js's worker
    // protocol — the sniff would silently re-enable the broken path on
    // newer Node. Browser entry leaves this unset (= false = real worker
    // via GlobalWorkerOptions.workerSrc); node entry sets `true`.
    disableWorker: runtime.disableWorker === true,
    isEvalSupported: false,
    // Keep going past malformed content streams instead of failing the page.
    stopAtErrors: false,
    // Force the classic pixel-array image path on every host so the reader
    // (WKWebView has OffscreenCanvas) and the CLI produce identical PNGs.
    isOffscreenCanvasSupported: false,
    password: options.password,
    // Standard-14 font metrics + CJK CMaps: without these PDF.js falls back
    // to guesses for non-embedded fonts and logs a warning per page.
    ...(runtime.standardFontDataUrl ? { standardFontDataUrl: runtime.standardFontDataUrl } : {}),
    ...(runtime.cMapUrl ? { cMapUrl: runtime.cMapUrl, cMapPacked: true } : {}),
  });
  // Encrypted PDFs: PDF.js asks through onPassword; `updatePassword(Error)`
  // aborts the load with that error.
  let passwordTried = typeof options.password === "string";
  loadingTask.onPassword = (updatePassword: (pw: string | Error) => void, reason: number) => {
    const retry = reason === 2 || passwordTried; // 2 = INCORRECT_PASSWORD
    if (!options.onPassword) {
      updatePassword(new Error(retry
        ? "[@jdf/pdf-import] Wrong password for encrypted PDF"
        : "[@jdf/pdf-import] PDF is password-protected — pass `password`"));
      return;
    }
    passwordTried = true;
    options.onPassword(retry).then((pw) => {
      if (pw == null) updatePassword(new Error("[@jdf/pdf-import] Password entry cancelled"));
      else updatePassword(pw);
    }).catch((e) => updatePassword(e instanceof Error ? e : new Error(String(e))));
  };
  let doc: any;
  try {
    doc = await loadingTask.promise;
  } catch (e: any) {
    if (e?.name === "PasswordException") {
      const msg = /no password/i.test(e.message || "")
        ? "PDF is password-protected — pass a password (CLI: --password)"
        : (e.message || "PDF is password-protected");
      throw new Error(`[@jdf/pdf-import] ${msg}`);
    }
    throw e;
  }
  const pages: Page[] = [];
  const imageResources: Record<string, ImageResource> = {};
  let imgCounter = 0;
  // Two caches — `dataUrlCache` keeps the encoded PNG so we don't re-encode
  // the same XObject on every page; `resourceKeyByName` re-uses a single
  // resource id across all elements that point at the same PDF image. Same
  // logo on 1000 pages → one entry in `resources.images`, not 1000 copies.
  const dataUrlCache = new Map<string, string>();
  const resourceKeyByName = new Map<string, string>();

  const outline = await flattenOutline(doc, await doc.getOutline().catch(() => null));
  let pdfInfo: any = null;
  let pdfMetadata: any = null;
  try {
    const md = await doc.getMetadata();
    pdfInfo = md?.info ?? null;
    pdfMetadata = md?.metadata ?? null;
  } catch { /* no metadata */ }

  for (let pi = 1; pi <= doc.numPages; pi++) {
    const page = await doc.getPage(pi);
    const viewport = page.getViewport({ scale: 1 });
    const pageW = viewport.width;
    const pageH = viewport.height;

    const { canvas, context } = runtime.createCanvas(Math.ceil(pageW), Math.ceil(pageH));
    try {
      await page.render({ canvasContext: context, viewport, canvas }).promise;
    } catch { /* swallow */ }

    const ops = await walkOps(page, OPS, viewport);
    const links = await extractLinks(doc, page, viewport);
    const formWidgets = await extractFormWidgets(page, viewport);
    const textContent = await page.getTextContent({ disableCombineTextItems: false });
    const items: any[] = textContent.items;

    const fontMap = new Map<string, { family: string; weight?: string; style?: string }>();
    for (const k of Object.keys(textContent.styles || {})) {
      const s = (textContent.styles as any)[k];
      let realName: string = s.fontFamily || k;
      // commonObjs.get(name, callback) can hang forever on node when the
      // font hasn't been requested through page.render() (the callback only
      // fires once the resource is materialised). Skip the lookup if the
      // resource isn't already there — the inferred name from the style is
      // good enough for font classification.
      try {
        const has = typeof page.commonObjs.has === "function" ? page.commonObjs.has(k) : false;
        if (has) {
          await new Promise<void>((resolve) => {
            let settled = false;
            const done = () => { if (!settled) { settled = true; resolve(); } };
            try {
              page.commonObjs.get(k, (font: any) => {
                if (font?.name) realName = font.name;
                else if (font?.loadedName) realName = font.loadedName;
                done();
              });
            } catch { done(); }
            // Hard fallback so a missing callback never wedges the pipeline.
            setTimeout(done, 100);
          });
        }
      } catch { /* ignore */ }
      const cls = classifyFont(realName);
      if (!cls.weight && /bold/i.test(s.fontFamily || "")) cls.weight = "bold";
      if (!cls.style && /italic|oblique/i.test(s.fontFamily || "")) cls.style = "italic";
      fontMap.set(k, cls);
    }

    const runs: TextRun[] = [];
    // Sanitiser used on every numeric field that lands in the JSON output.
    // PDF.js can produce NaN here when a font is broken or the transform
    // matrix has zero determinant — without this clamp, NaN propagates
    // through Math.round/Math.max and `JSON.stringify` writes `null`,
    // which fails downstream schema validation OR (worse, with --json and
    // no validate) feeds `null` into a numeric field that the embedder
    // doesn't expect.
    const safeNum = (v: any, fallback: number): number => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : fallback;
    };

    // Spatial index of showText operators (1 pt bins) for item → op matching.
    const opBins = new Map<string, TextOp[]>();
    for (const op of ops.textOps) {
      const key = `${Math.round(op.x)},${Math.round(op.y)}`;
      const arr = opBins.get(key);
      if (arr) arr.push(op); else opBins.set(key, [op]);
    }
    // Two operators can start at the very same point with different sizes —
    // FlowCV/Quartz draws a 0.75pt "•" glyph and the 11pt bullet text from one
    // origin. Distance alone then picks the wrong one and the whole line
    // inherits its (white) fill. Penalise size mismatch alongside distance.
    const sizePenalty = (op: TextOp, fontSize: number) => {
      if (!op.fontSize || !fontSize) return 0;
      return Math.abs(Math.log(op.fontSize / fontSize)) * 6; // ~1pt of distance per 18% size difference
    };
    const findOp = (x: number, y: number, fontSize: number): TextOp | null => {
      let best: TextOp | null = null;
      let bestD = Infinity;
      const bx = Math.round(x), by = Math.round(y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const arr = opBins.get(`${bx + dx},${by + dy}`);
          if (!arr) continue;
          for (const op of arr) {
            const d = Math.hypot(op.x - x, op.y - y) + sizePenalty(op, fontSize);
            if (d < bestD) { bestD = d; best = op; }
          }
        }
      }
      if (best) return best;
      // Item start didn't line up with any operator start (glyph-advance
      // estimate drifted, Type3 font, vertical text). Fall back to the nearest
      // operator on the same baseline, then to the nearest anywhere — but never
      // to an operator of a clearly different size.
      const tol = Math.max(2, fontSize * 0.6);
      const sizeOk = (op: TextOp) => !op.fontSize || !fontSize || (op.fontSize / fontSize > 0.6 && op.fontSize / fontSize < 1.7);
      for (const op of ops.textOps) {
        if (!sizeOk(op) || Math.abs(op.y - y) > tol) continue;
        const d = Math.abs(op.x - x) + Math.abs(op.y - y) * 4;
        if (d < bestD) { bestD = d; best = op; }
      }
      if (best) return best;
      for (const op of ops.textOps) {
        if (!sizeOk(op)) continue;
        const d = Math.hypot(op.x - x, op.y - y);
        if (d < bestD) { bestD = d; best = op; }
      }
      return bestD < 40 ? best : null;
    };

    const keepInvisible = options.invisibleText !== "drop";

    items.forEach((it) => {
      if (!it.str || !it.str.length) return;
      const tr = it.transform as number[];
      const fontSize = safeNum(Math.hypot(safeNum(tr?.[2], 0), safeNum(tr?.[3], 0)), 0)
        || safeNum(it.height, 0)
        || 10;
      const baseX = safeNum(tr?.[4], 0);
      const baseY = safeNum(tr?.[5], 0);
      const conv = viewport.convertToViewportPoint(baseX, baseY) as [number, number];
      const vx = safeNum(conv?.[0], 0);
      const vy = safeNum(conv?.[1], 0);
      // Sub-1.5pt runs are decoration (FlowCV's scaled "•" under a drawn dot),
      // not readable text — they would only render as stray specks.
      if (fontSize < 1.5) return;
      const op = findOp(vx, vy, fontSize);
      const mode = op?.mode ?? 0;
      // Mode 7 adds to the clip path only — nothing is painted, and it is
      // not an OCR layer either.
      if (mode === 7) return;
      const invisible = mode === 3;
      if (invisible && !keepInvisible) return;
      const ascent = it.height ? safeNum(it.height, fontSize) * 0.78 : fontSize * 0.78;
      const yTop = vy - ascent;
      const w = safeNum(it.width, 0);
      runs.push({
        text: it.str,
        x: safeNum(vx * PT_TO_MM, 0),
        y: safeNum(yTop * PT_TO_MM, 0),
        fontSize: safeNum(fontSize, 10),
        fontName: it.fontName,
        width: safeNum(w * PT_TO_MM, 0),
        height: safeNum((it.height || fontSize) * PT_TO_MM, fontSize * PT_TO_MM),
        color: op?.fill || "#000000",
        opacity: invisible ? 0 : safeNum(op?.alpha, 1),
      });
    });

    runs.sort((a, b) => (a.y - b.y) || (a.x - b.x));

    const lines: TextRun[] = [];
    const Y_TOL = 0.6;
    // Average glyph advance on this page (em), measured from runs PDF.js sizes exactly.
    const kGlyph = calibrateGlyphWidth(runs);
    const stretchedSpaces = hasStretchedSpaces(runs, kGlyph);
    const fontKey = (name: string) => {
      const c = fontMap.get(name) || classifyFont(name || "");
      return `${c.family}|${c.weight || ""}|${c.style || ""}`;
    };
    for (const r of runs) {
      if (!r.text.length) continue;
      const last = lines[lines.length - 1];
      if (!last) { lines.push({ ...r }); continue; }
      const sameLine = Math.abs(last.y - r.y) <= Y_TOL;
      // Browser-printed PDFs subset one typeface into several font objects
      // (g_d0_f1 / f2 / f3 …), so compare the classified face, not the name.
      const sameStyle =
        Math.abs(last.fontSize - r.fontSize) < 0.4 &&
        (last.fontName === r.fontName || fontKey(last.fontName) === fontKey(r.fontName)) &&
        last.color === r.color &&
        Math.abs(last.opacity - r.opacity) < 0.05;
      // PDF.js over-reports the width of a run that ends in a stretched
      // space (browser-printed tables: "Region " spans to the next column).
      // Cap the extent at a generous per-glyph estimate so the next run's
      // gap is judged from where the glyphs really end; allow a little
      // overlap for kerned per-glyph runs.
      const emMm = r.fontSize * PT_TO_MM;
      const extent = (t: TextRun) => {
        if (!/\s$/.test(t.text)) return t.width; // no trailing space → PDF.js width is the glyph advance, trust it
        const em = t.fontSize * PT_TO_MM;
        const est = Math.max(1, t.text.trim().length) * em * kGlyph + em * 0.25;
        // Pages that stretch trailing spaces (browser-printed tables): cap at
        // the glyph estimate. Elsewhere trust PDF.js unless implausibly wide.
        if (stretchedSpaces) return Math.min(t.width, est);
        return t.width > est * 1.4 ? est : t.width;
      };
      const gapMm = r.x - (last.x + extent(last));
      const mergeOk = sameLine && sameStyle && gapMm >= -emMm * 0.5 && gapMm <= emMm * 0.45;

      if (mergeOk) {
        const lastEndsSpace = /\s$/.test(last.text);
        const currStartsSpace = /^\s/.test(r.text);
        const sep = (gapMm > emMm * 0.08 && !lastEndsSpace && !currStartsSpace) ? " " : "";
        last.text = last.text + sep + r.text;
        // Width is the running max of (existing extent, end of new run). The
        // previous formula `r.x - last.x + r.width` ignored the prior width
        // and could shrink when a 4+ run line had slight kerning, which then
        // overestimated the gap to the next run and broke merges early.
        const newExtent = (r.x - last.x) + r.width;
        last.width = Math.max(extent(last), newExtent);
      } else {
        lines.push({ ...r });
      }
    }

    function findLinkForRun(r: TextRun) {
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      for (const a of links) {
        if (cx >= a.rectMm.x && cx <= a.rectMm.x + a.rectMm.w &&
            cy >= a.rectMm.y && cy <= a.rectMm.y + a.rectMm.h) {
          return a;
        }
      }
      return null;
    }

    const elements: Element[] = [];
    // Facts about each emitted line the paragraph folder needs (measured width, size, face).
    const lineMeta = new WeakMap<object, LineMeta>();

    // Tables: rebuild grids from line geometry (+ drawn cell borders /
    // backgrounds as hints) and emit real `table` elements. The text lines
    // and shapes they consume are skipped below so nothing is drawn twice.
    const tRuns: TRun[] = lines.map((l) => {
      const cls = fontMap.get(l.fontName) || classifyFont(l.fontName || "");
      return { text: l.text, x: l.x, y: l.y, width: l.width, height: l.height, fontSize: l.fontSize, fontName: l.fontName, color: l.color, bold: cls.weight === "bold" };
    });
    // Body font size = the size carrying the most characters on the page.
    const sizeChars = new Map<number, number>();
    for (const l of lines) { const k = Math.round(l.fontSize * 2) / 2; sizeChars.set(k, (sizeChars.get(k) ?? 0) + l.text.length); }
    const bodyFontSize = [...sizeChars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    // Column gutters (multi-column pages). Known before table detection so two
    // columns of justified prose are never mistaken for a two-column table.
    const gutters = options.readingOrder === false ? [] : detectGutters(lines.map((l) => ({ text: l.text, x: l.x, y: l.y, width: l.width, fontSize: l.fontSize })), bodyFontSize, pageW * PT_TO_MM);
    const detected = options.detectTables === false ? [] : detectTables(tRuns, ops.shapes, pageW * PT_TO_MM, gutters);
    const consumedLines = new Set<number>();
    const consumedShapes = new Set<number>();
    const tableAtLine = new Map<number, Element>();
    for (const t of detected) {
      for (const k of t.lineIdx) consumedLines.add(k);
      for (const k of t.shapeIdx) consumedShapes.add(k);
      tableAtLine.set(Math.min(...t.lineIdx), t.element);
    }

    const pageWmm = pageW * PT_TO_MM, pageHmm = pageH * PT_TO_MM;
    ops.shapes.forEach((sh, shapeIdx) => {
      if (consumedShapes.has(shapeIdx)) return;
      if (sh.width < 0.3 && sh.height < 0.3) return;
      // Page-background fills (browsers paint the whole page white first) and
      // shapes entirely off the page are noise — and a full-page white rect
      // would sit on top of nothing useful while doubling the element count.
      if (sh.x + sh.width <= 0 || sh.y + sh.height <= 0 || sh.x >= pageWmm || sh.y >= pageHmm) return;
      if (sh.kind === "rect" && sh.fill && !sh.stroke && sh.width * sh.height >= pageWmm * pageHmm * 0.9) return;
      const shapeType: "rect" | "line" | "path" = sh.kind;
      const shape: ShapeElement = {
        type: "shape",
        shape: shapeType,
        position: { x: Math.round(sh.x * 100) / 100, y: Math.round(sh.y * 100) / 100 },
        width: Math.max(0.1, Math.round(sh.width * 100) / 100),
        height: Math.max(0.1, Math.round(sh.height * 100) / 100),
      };
      if (sh.fill) shape.fill = sh.fill;
      if (sh.stroke) shape.stroke = { color: sh.stroke, width: sh.strokeWidth || 0.3 };
      if (shapeType === "path" && sh.path) shape.path = sh.path;
      if (sh.opacity != null && sh.opacity < 0.999) {
        (shape as any).style = { opacity: Math.round(sh.opacity * 100) / 100 };
      }
      elements.push(shape);
    });

    const imgs = await extractImages(page, ops.imagePositions, runtime, dataUrlCache);
    for (const { pos, dataUrl } of imgs) {
      // Re-use a single resources.images entry per PDF XObject. Without
      // this, a 1000-page PDF with the same logo on every page produces
      // 1000 copies of identical base64 data — multi-GB output that OOMs
      // JSON.stringify and inflates RAG embedding cost.
      let resourceKey = resourceKeyByName.get(pos.name);
      if (!resourceKey) {
        resourceKey = `img${imgCounter++}`;
        resourceKeyByName.set(pos.name, resourceKey);
        const base64 = dataUrl.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
        imageResources[resourceKey] = {
          src: "embedded",
          mimeType: "image/png",
          data: base64,
        };
      }
      elements.push({
        type: "image",
        resource: resourceKey,
        position: { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100 },
        width: Math.max(1, Math.round(pos.w * 100) / 100),
        height: Math.max(1, Math.round(pos.h * 100) / 100),
        fit: "fill",
      });
    }

    // Visual rows: runs on one baseline that sit right next to each other but
    // differ in style ("Full Stack Developer," bold + " Decktopus AI" regular).
    // As separate absolutely-positioned boxes they overlap whenever the
    // rendering font is wider than the PDF's; as one `richtext` the browser
    // lays the runs out inline. Also lets a single run know its right-hand
    // neighbour so its width can be capped before the neighbour starts.
    const rowOf = new Map<number, number[]>();   // first index → all indices in the visual row
    const rowStartOf = new Map<number, number>();
    const nextOnRow = new Map<number, number>(); // index → next run on the same baseline (any gap)
    {
      const order = lines.map((_, i) => i).filter((i) => !consumedLines.has(i));
      for (let a = 0; a < order.length; a++) {
        const i = order[a], li = lines[i];
        let bestNext = -1, bestX = Infinity;
        for (let b = 0; b < order.length; b++) {
          const j = order[b], lj = lines[j];
          // Half the larger font size: a subscript/small-caps run ("BERT" + "LARGE"),
          // a superscript footnote mark or an inline formula sits on a shifted
          // baseline but belongs to the same visual row. Line pitch is ≥ 1 em, so
          // the next line stays out.
          const tolY = Math.max(0.6, Math.max(li.fontSize, lj.fontSize) * PT_TO_MM * 0.5);
          if (j === i || Math.abs(lj.y - li.y) > tolY || lj.x <= li.x) continue;
          if (lj.x < bestX) { bestX = lj.x; bestNext = j; }
        }
        if (bestNext >= 0) nextOnRow.set(i, bestNext);
      }
      const seen = new Set<number>();
      for (const i of order) {
        if (seen.has(i)) continue;
        const row = [i]; seen.add(i);
        let cur = i;
        while (nextOnRow.has(cur)) {
          const j = nextOnRow.get(cur)!, lc = lines[cur], lj = lines[j];
          const em = Math.min(lc.fontSize, lj.fontSize) * PT_TO_MM;
          const gap = lj.x - (lc.x + lc.width);
          if (gap < -em * 0.3 || gap > em * 0.6) break; // a real gap → separate column / element
          row.push(j); seen.add(j); cur = j;
        }
        rowOf.set(i, row);
        for (const j of row) rowStartOf.set(j, i);
      }
    }
    const runStyle = (l: TextRun) => {
      const cls = fontMap.get(l.fontName) || classifyFont(l.fontName || "");
      return { cls, bold: cls.weight === "bold", italic: cls.style === "italic" };
    };

    lines.forEach((l, lineIdx) => {
      const tableEl = tableAtLine.get(lineIdx);
      if (tableEl) elements.push(tableEl);
      if (consumedLines.has(lineIdx)) return;
      const row = rowOf.get(lineIdx);
      if (!row) return; // continuation of a richtext row already emitted
      if (row.length > 1) {
        const first = lines[row[0]], last = lines[row[row.length - 1]];
        const base = runStyle(first);
        const rowEnd = last.x + last.width;
        const measuredW = Math.max((rowEnd - first.x) * 1.2 + first.fontSize * PT_TO_MM * 0.4, first.fontSize * PT_TO_MM);
        const nextIdx = nextOnRow.get(row[row.length - 1]);
        const cap = nextIdx != null ? lines[nextIdx].x - first.x - first.fontSize * PT_TO_MM * 0.3 : pageWmm - first.x;
        const runs: any[] = [];
        row.forEach((idx, k) => {
          const r = lines[idx];
          const st = runStyle(r);
          let text = r.text;
          if (k > 0) {
            const prev = lines[row[k - 1]];
            const gap = r.x - (prev.x + prev.width);
            if (gap > r.fontSize * PT_TO_MM * 0.08 && !/\s$/.test(prev.text) && !/^\s/.test(text)) text = " " + text;
          }
          const run: any = { text };
          if (st.bold) run.bold = true;
          if (st.italic) run.italic = true;
          if (r.color !== "#000000") run.color = r.color;
          if (Math.abs(r.fontSize - first.fontSize) >= 0.5) run.fontSize = Math.round(r.fontSize * 10) / 10;
          if (st.cls.family !== base.cls.family) run.fontFamily = st.cls.family;
          const lk = findLinkForRun(r);
          if (lk) run.link = lk.url ? lk.url : lk.destPage != null ? { type: "internal", target: `#page-${lk.destPage + 1}` } : undefined;
          runs.push(run);
        });
        const style: any = { fontSize: Math.round(first.fontSize * 10) / 10, fontFamily: base.cls.family };
        if (first.opacity < 0.999) style.opacity = Math.round(first.opacity * 100) / 100;
        const rt: any = {
          type: "richtext",
          runs,
          position: { x: Math.max(0, Math.round(first.x * 100) / 100), y: Math.max(0, Math.round(Math.min(...row.map((i) => lines[i].y)) * 100) / 100) },
          width: Math.max(2, Math.round(Math.max(first.fontSize * PT_TO_MM, Math.min(measuredW, cap)) * 100) / 100),
          style,
        };
        // Size/face of the row = the run carrying most characters ("BERT" + small-caps "LARGE" + body text → body).
        const dominant = row.map((i) => lines[i]).sort((a, b) => b.text.trim().length - a.text.trim().length)[0];
        lineMeta.set(rt, { w: Math.max(first.fontSize * PT_TO_MM, rowEnd - first.x), size: dominant.fontSize, face: fontKey(dominant.fontName) });
        elements.push(rt);
        return;
      }
      const cls = fontMap.get(l.fontName) || classifyFont(l.fontName || "");
      const style: any = {
        fontSize: Math.round(l.fontSize * 10) / 10,
        fontFamily: cls.family,
      };
      if (cls.weight === "bold") style.fontWeight = "bold";
      if (cls.style === "italic") style.fontStyle = "italic";
      if (l.color !== "#000000") style.color = l.color;
      if (l.opacity < 0.999) style.opacity = Math.round(l.opacity * 100) / 100;

      const link = findLinkForRun(l);

      // The rendering font (Inter/Helvetica fallback) is often wider than the
      // PDF's embedded face; a box cut to the PDF's advance width wraps the
      // line onto the one below. Give single lines 20% slack, capped at the page.
      const measured = Math.max(l.width * 1.2 + l.fontSize * PT_TO_MM * 0.4, l.fontSize * PT_TO_MM);
      // If l.x is past the page edge (CropBox-offset PDFs sometimes do this
      // for trailing artifacts), `pageWmm - l.x` goes negative and clamps to
      // a 2mm-wide invisible run. Clamp to a positive minimum so the run
      // keeps its measured width and the renderer can still place it.
      const remaining = Math.max(measured, pageWmm - l.x);
      // Never run into the next run on the same baseline (a column to the right).
      const nextIdx = nextOnRow.get(lineIdx);
      const cap = nextIdx != null ? Math.max(l.fontSize * PT_TO_MM, lines[nextIdx].x - l.x - l.fontSize * PT_TO_MM * 0.3) : Infinity;
      const elWidth = Math.min(measured, remaining, cap);
      const text: TextElement = {
        type: "text",
        content: l.text,
        position: { x: Math.max(0, Math.round(l.x * 100) / 100), y: Math.max(0, Math.round(l.y * 100) / 100) },
        width: Math.max(2, Math.round(elWidth * 100) / 100),
        style,
      };
      // Heading detection: bold AND clearly larger than the page's body text.
      // Relative to the body size (not a fixed 16pt) so a report set in 11pt
      // with 15pt section titles gets its headings — which is what `jdf chunk`
      // splits sections on. Boldness stays required so a 24pt regular
      // paragraph in a marketing PDF is still body text; short lines only,
      // so an emphasised sentence never becomes a heading.
      if (cls.weight === "bold" && l.text.trim().length <= 120 && !consumedLines.has(lineIdx)) {
        const ratio = bodyFontSize > 0 ? l.fontSize / bodyFontSize : 1;
        if (l.fontSize >= 22 || ratio >= 1.8) text.heading = 1;
        else if (l.fontSize >= 17 || ratio >= 1.35) text.heading = 2;
        else if (l.fontSize >= 16 || ratio >= 1.2) text.heading = 3;
      }
      if (text.heading) text.tocEntry = text.content;
      if (link) {
        if (link.url) text.link = link.url;
        else if (link.destPage != null) text.link = { type: "internal", target: `#page-${link.destPage + 1}` };
      }
      // A heading that wrapped onto a second line arrives as two bold lines of
      // the same size, one line apart, both starting at the same x. Fold the
      // continuation into the previous heading so the TOC and `jdf chunk`'s
      // breadcrumb see one title, not "Acme … Operations" + "Report".
      const prev = elements[elements.length - 1] as TextElement | undefined;
      if (text.heading && prev && prev.type === "text" && prev.heading === text.heading && !link && !prev.link &&
          Math.abs((prev.style as any)?.fontSize - style.fontSize) < 0.5 &&
          Math.abs(prev.position!.x - text.position!.x) < 1 &&
          text.position!.y - prev.position!.y < l.fontSize * PT_TO_MM * 2.2 && text.position!.y > prev.position!.y) {
        prev.content = `${prev.content} ${text.content}`.replace(/\s+/g, " ");
        prev.tocEntry = prev.content;
        prev.width = Math.max(prev.width ?? 0, text.width ?? 0);
        return;
      }
      lineMeta.set(text, { w: Math.max(l.fontSize * PT_TO_MM, l.width), size: l.fontSize, face: fontKey(l.fontName) });
      elements.push(text);
    });

    // Multi-column pages: put the flow elements (text, richtext, table) into
    // reading order — column by column between full-width blocks — so
    // `jdf chunk`, search and the TOC see the page the way a reader does.
    // Shapes/images keep their place in front so paint order is unchanged.
    if (options.readingOrder !== false) {
      if (gutters.length) {
        const isFlow = (e: Element) => e.type === "text" || e.type === "richtext" || e.type === "table";
        const flow = elements.filter(isFlow), rest = elements.filter((e) => !isFlow(e));
        elements.splice(0, elements.length, ...rest, ...orderByColumns(flow as any[], gutters, pageWmm));
      }
    }
    // Lines → paragraphs (same boxes, whole sentences) for chunking, search and LLMs.
    if (options.foldParagraphs !== false) {
      const folded = foldParagraphs(elements as any[], lineMeta, pageWmm);
      elements.splice(0, elements.length, ...(folded as Element[]));
    }

    // Form widgets — emit on top of text/shape so the user can interact
    // with them in jdf.js / the reader. Skip pushbuttons (no form value
    // semantics) and radio buttons (we don't yet have a radio element type;
    // map them to a single-select if all radios in the same field share a
    // name, otherwise drop them).
    for (const w of formWidgets) {
      if (w.pushButton) continue;
      const baseEl: any = {
        name: w.fieldName,
        position: { x: Math.max(0, Math.round(w.rectMm.x * 100) / 100), y: Math.max(0, Math.round(w.rectMm.y * 100) / 100) },
        width: Math.max(2, Math.round(w.rectMm.w * 100) / 100),
        height: Math.max(2, Math.round(w.rectMm.h * 100) / 100),
      };
      if (w.readonly) baseEl.readonly = true;
      if (w.required) baseEl.required = true;
      if (w.fieldType === "Tx") {
        if (w.multiLine) {
          elements.push({ type: "textarea", ...baseEl, value: typeof w.fieldValue === "string" ? w.fieldValue : "" });
        } else {
          elements.push({ type: "input", ...baseEl, inputType: "text", value: typeof w.fieldValue === "string" ? w.fieldValue : "" });
        }
      } else if (w.fieldType === "Btn" && !w.radio) {
        const checked = w.fieldValue !== "Off" && !!w.fieldValue;
        elements.push({ type: "checkbox", ...baseEl, checked });
      } else if (w.fieldType === "Ch") {
        const value = typeof w.fieldValue === "string" ? w.fieldValue : "";
        const values = Array.isArray(w.fieldValue) ? (w.fieldValue as string[]) : undefined;
        const opts = w.options.length > 0 ? w.options : (value ? [{ value }] : []);
        if (w.multiSelect) {
          elements.push({ type: "select", ...baseEl, options: opts, multiple: true, values: values ?? (value ? [value] : []) });
        } else {
          elements.push({ type: "select", ...baseEl, options: opts, value });
        }
      } else if (w.fieldType === "Sig") {
        elements.push({ type: "signature", ...baseEl, value: "" });
      }
      // Radio groups and unknown types fall through silently.
    }

    pages.push({
      id: `page-${pi}`,
      pageSize: { width: Math.round(pageW * PT_TO_MM * 100) / 100, height: Math.round(pageH * PT_TO_MM * 100) / 100 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      elements,
    });
  }

  applyOutline(pages, outline);

  const meta: JdfDocument["meta"] = {
    title,
    pageSize: pages[0]?.pageSize || "A4",
    unit: "mm",
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  // Carry the PDF's own document info through — authorship and dates matter
  // for RAG provenance and for `{{author}}` header/footer templates.
  if (pdfInfo) {
    if (typeof pdfInfo.Author === "string" && pdfInfo.Author.trim()) meta.author = pdfInfo.Author.trim();
    const created = pdfDateToIso(pdfInfo.CreationDate);
    const modified = pdfDateToIso(pdfInfo.ModDate);
    if (created) meta.created = created;
    if (modified) meta.modified = modified;
    if (typeof pdfInfo.Keywords === "string") {
      const kws = pdfInfo.Keywords.split(/[,;]+/).map((k: string) => k.trim()).filter(Boolean);
      if (kws.length) meta.keywords = kws;
    }
    if (typeof pdfInfo.Language === "string" && pdfInfo.Language.trim()) meta.language = pdfInfo.Language.trim();
  }
  if (!meta.language && pdfMetadata && typeof pdfMetadata.get === "function") {
    try {
      const lang = pdfMetadata.get("dc:language");
      const first = Array.isArray(lang) ? lang[0] : lang;
      if (typeof first === "string" && first.trim()) meta.language = first.trim();
    } catch { /* ignore */ }
  }

  const result: JdfDocument = {
    $jdf: "1.0.0",
    meta,
    pages,
  };
  if (Object.keys(imageResources).length > 0) {
    result.resources = { images: imageResources };
  }

  return result;
}
