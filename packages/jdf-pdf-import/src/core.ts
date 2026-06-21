import type { JdfDocument, Page, Element, TextElement, ImageResource, ShapeElement } from "@jdf/core";
import type { PdfImportRuntime } from "./types";

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

interface ImagePos { name: string; x: number; y: number; w: number; h: number }

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
  textColors: string[];
  textOpacities: number[];
  textRenderingModes: number[];
  shapes: ShapeOp[];
  imagePositions: ImagePos[];
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
  const opList = await page.getOperatorList();
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
  };
  const stack: typeof gs[] = [];

  const textColors: string[] = [];
  const textOpacities: number[] = [];
  const textRenderingModes: number[] = [];
  const shapes: ShapeOp[] = [];
  const imagePositions: ImagePos[] = [];

  let textIdx = 0;
  let pathSegments: { type: "M" | "L" | "C" | "Q" | "Z" | "RECT"; pts: number[] }[] = [];
  let pathRect: { x: number; y: number; w: number; h: number } | null = null;
  let pathStart: { x: number; y: number } | null = null;
  let pathLast: { x: number; y: number } | null = null;

  function flushPath(isFill: boolean, isStroke: boolean) {
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
      shapes.push({
        kind: "path",
        x: minX * PT_TO_MM,
        y: minY * PT_TO_MM,
        width: Math.max(0.05, (maxX - minX) * PT_TO_MM),
        height: Math.max(0.05, (maxY - minY) * PT_TO_MM),
        stroke: isStroke ? gs.stroke : undefined,
        strokeWidth: isStroke ? gs.lineWidth * PT_TO_MM : undefined,
        opacity: gs.strokeAlpha,
        path: `M ${x1Local.toFixed(2)} ${y1Local.toFixed(2)} L ${x2Local.toFixed(2)} ${y2Local.toFixed(2)}`,
      });
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
      stack.push({ ctm: [...gs.ctm], fill: gs.fill, stroke: gs.stroke, lineWidth: gs.lineWidth, fillAlpha: gs.fillAlpha, strokeAlpha: gs.strokeAlpha, textRenderingMode: gs.textRenderingMode });
    } else if (fn === OPS.restore) {
      const s = stack.pop();
      if (s) Object.assign(gs, s);
    } else if (fn === OPS.transform) {
      gs.ctm = multiplyCtm(gs.ctm, args as number[]);
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
    } else if (
      fn === OPS.showText || fn === OPS.showSpacedText ||
      fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText
    ) {
      textColors[textIdx] = gs.fill;
      textOpacities[textIdx] = gs.fillAlpha;
      textRenderingModes[textIdx] = gs.textRenderingMode;
      textIdx++;
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
      pathRect = null;
      pathStart = null;
      pathLast = null;
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintInlineImageXObject) {
      const name = args[0];
      const c = gs.ctm;
      const corners = [tx(c, 0, 0), tx(c, 1, 0), tx(c, 1, 1), tx(c, 0, 1)];
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
      });
    }
  }

  return { textColors, textOpacities, textRenderingModes, shapes, imagePositions };
}

async function extractImages(
  page: any,
  positions: ImagePos[],
  runtime: PdfImportRuntime,
): Promise<{ pos: ImagePos; dataUrl: string }[]> {
  const out: { pos: ImagePos; dataUrl: string }[] = [];
  for (const pos of positions) {
    let imgObj: any = null;
    try {
      imgObj = await new Promise<any>((resolve) => {
        let settled = false;
        const done = (v: any) => { if (!settled) { settled = true; resolve(v); } };
        try {
          page.objs.get(pos.name, (img: any) => done(img));
        } catch {
          try {
            page.commonObjs.get(pos.name, (img: any) => done(img));
          } catch {
            done(null);
          }
        }
        // If the image XObject isn't realised yet (page.render didn't reach
        // it, or commonObjs callback never fires), bail after a short wait
        // instead of wedging the whole import.
        setTimeout(() => done(null), 250);
      });
    } catch {
      imgObj = null;
    }
    if (!imgObj || !imgObj.data || !imgObj.width || !imgObj.height) continue;
    const dataUrl = runtime.encodePng(imgObj.width, imgObj.height, imgObj.kind || 0, imgObj.data);
    if (!dataUrl) continue;
    out.push({ pos, dataUrl });
  }
  return out;
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

async function extractLinks(page: any, viewport: any): Promise<LinkAnnot[]> {
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
    out.push({ rectMm, url });
  }
  return out;
}

async function flattenOutline(doc: any, outline: any[] | null): Promise<{ title: string; pageIndex: number }[]> {
  if (!outline) return [];
  const out: { title: string; pageIndex: number }[] = [];
  async function walk(items: any[]) {
    for (const item of items) {
      try {
        let dest = item.dest;
        if (typeof dest === "string") {
          dest = await doc.getDestination(dest);
        }
        if (Array.isArray(dest) && dest[0]) {
          const ref = dest[0];
          const idx = await doc.getPageIndex(ref);
          if (typeof idx === "number") out.push({ title: item.title, pageIndex: idx });
        }
      } catch { /* ignore */ }
      if (item.items?.length) await walk(item.items);
    }
  }
  await walk(outline);
  return out;
}

export interface ImportPdfOptions {
  /** Optional pdfjs-dist module override (already initialised). */
  pdfjs?: any;
}

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

  const doc = await pdfjs.getDocument({
    data,
    // The runtime adapter declares whether it supports a real Web Worker.
    // We don't sniff `typeof Worker` here because Node 22+ exposes a global
    // `Worker` (worker_threads) that isn't compatible with PDF.js's worker
    // protocol — the sniff would silently re-enable the broken path on
    // newer Node. Browser entry leaves this unset (= false = real worker
    // via GlobalWorkerOptions.workerSrc); node entry sets `true`.
    disableWorker: runtime.disableWorker === true,
    isEvalSupported: false,
  }).promise;
  const pages: Page[] = [];
  const imageResources: Record<string, ImageResource> = {};
  let imgCounter = 0;

  const outline = await doc.getOutline().catch(() => null);
  await flattenOutline(doc, outline); // currently informational

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
    const links = await extractLinks(page, viewport);
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
    items.forEach((it, idx) => {
      if (!it.str || !it.str.length) return;
      if ((ops.textRenderingModes[idx] ?? 0) === 3) return;
      const tr = it.transform as number[];
      const fontSize = Math.hypot(tr[2], tr[3]) || it.height || 10;
      const baseX = tr[4];
      const baseY = tr[5];
      const [vx, vy] = viewport.convertToViewportPoint(baseX, baseY) as [number, number];
      const ascent = it.height ? it.height * 0.78 : fontSize * 0.78;
      const yTop = vy - ascent;
      const w = (it.width || 0);
      runs.push({
        text: it.str,
        x: vx * PT_TO_MM,
        y: yTop * PT_TO_MM,
        fontSize,
        fontName: it.fontName,
        width: w * PT_TO_MM,
        height: (it.height || fontSize) * PT_TO_MM,
        color: ops.textColors[idx] || "#000000",
        opacity: ops.textOpacities[idx] ?? 1,
      });
    });

    runs.sort((a, b) => (a.y - b.y) || (a.x - b.x));

    const lines: TextRun[] = [];
    const Y_TOL = 0.6;
    for (const r of runs) {
      if (!r.text.length) continue;
      const last = lines[lines.length - 1];
      if (!last) { lines.push({ ...r }); continue; }
      const sameLine = Math.abs(last.y - r.y) <= Y_TOL;
      const sameStyle =
        Math.abs(last.fontSize - r.fontSize) < 0.4 &&
        last.fontName === r.fontName &&
        last.color === r.color &&
        Math.abs(last.opacity - r.opacity) < 0.05;
      const gapMm = r.x - (last.x + last.width);
      const emMm = r.fontSize * PT_TO_MM;
      const mergeOk = sameLine && sameStyle && gapMm >= -0.2 && gapMm <= emMm * 0.45;

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
        last.width = Math.max(last.width, newExtent);
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

    for (const sh of ops.shapes) {
      if (sh.width < 0.3 && sh.height < 0.3) continue;
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
    }

    const imgs = await extractImages(page, ops.imagePositions, runtime);
    for (const { pos, dataUrl } of imgs) {
      const resourceKey = `img${imgCounter++}`;
      const base64 = dataUrl.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
      imageResources[resourceKey] = {
        src: "embedded",
        mimeType: "image/png",
        data: base64,
      };
      elements.push({
        type: "image",
        resource: resourceKey,
        position: { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100 },
        width: Math.max(1, Math.round(pos.w * 100) / 100),
        height: Math.max(1, Math.round(pos.h * 100) / 100),
        fit: "fill",
      });
    }

    for (const l of lines) {
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

      const pageWmm = pageW * PT_TO_MM;
      const measured = Math.max(l.width + l.fontSize * PT_TO_MM * 0.4, l.fontSize * PT_TO_MM);
      // If l.x is past the page edge (CropBox-offset PDFs sometimes do this
      // for trailing artifacts), `pageWmm - l.x` goes negative and clamps to
      // a 2mm-wide invisible run. Clamp to a positive minimum so the run
      // keeps its measured width and the renderer can still place it.
      const remaining = Math.max(measured, pageWmm - l.x);
      const elWidth = Math.min(measured, remaining);
      const text: TextElement = {
        type: "text",
        content: l.text,
        position: { x: Math.max(0, Math.round(l.x * 100) / 100), y: Math.max(0, Math.round(l.y * 100) / 100) },
        width: Math.max(2, Math.round(elWidth * 100) / 100),
        style,
      };
      // Heading detection: large body text is common in marketing PDFs and
      // shouldn't pollute the TOC. Require boldness for every heading level
      // — if a paragraph happens to be 24pt regular, it's still body text.
      // Larger threshold for H3 (16pt+ bold) avoids tagging emphasised words.
      if (cls.weight === "bold") {
        if (l.fontSize >= 22) text.heading = 1;
        else if (l.fontSize >= 17) text.heading = 2;
        else if (l.fontSize >= 16) text.heading = 3;
      }
      if (text.heading) text.tocEntry = text.content;
      if (link) {
        if (link.url) text.link = link.url;
        else if (link.destPage != null) text.link = { type: "internal", target: `#page-${link.destPage + 1}` };
      }
      elements.push(text);
    }

    pages.push({
      id: `page-${pi}`,
      pageSize: { width: Math.round(pageW * PT_TO_MM * 100) / 100, height: Math.round(pageH * PT_TO_MM * 100) / 100 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      elements,
    });
  }

  const result: JdfDocument = {
    $jdf: "1.0.0",
    meta: {
      title,
      pageSize: pages[0]?.pageSize || "A4",
      unit: "mm",
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    pages,
  };
  if (Object.keys(imageResources).length > 0) {
    result.resources = { images: imageResources };
  }

  return result;
}
