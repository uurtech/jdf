import type { JdfDocument, Page, Element, TextElement, ImageResource, ShapeElement, RichTextElement } from "@jdf/core";

const PT_TO_MM = 0.352778;

let pdfjsModule: any | null = null;
async function loadPdfJs() {
  if (pdfjsModule) return pdfjsModule;
  const lib = await import("pdfjs-dist/build/pdf.mjs");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  pdfjsModule = lib;
  return lib;
}

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

// PDF.js v4 returns RGB / Gray / CMYK values in the 0-255 range from getOperatorList()
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

function imageDataToUrl(width: number, height: number, kind: number, data: Uint8ClampedArray | Uint8Array): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const imgData = ctx.createImageData(width, height);
  const buf = imgData.data;
  if (kind === 3) {
    for (let i = 0; i < data.length && i < buf.length; i++) buf[i] = data[i];
  } else if (kind === 2) {
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      buf[j] = data[i]; buf[j + 1] = data[i + 1]; buf[j + 2] = data[i + 2]; buf[j + 3] = 255;
    }
  } else if (kind === 1) {
    for (let i = 0, j = 0; i < width * height; i++, j += 4) {
      const byte = data[i >> 3];
      const bit = (byte >> (7 - (i & 7))) & 1;
      const v = bit ? 255 : 0;
      buf[j] = v; buf[j + 1] = v; buf[j + 2] = v; buf[j + 3] = 255;
    }
  } else {
    for (let i = 0; i < data.length && i < buf.length; i++) buf[i] = data[i];
  }
  ctx.putImageData(imgData, 0, 0);
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
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
  const pageH = viewport.height;
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
      shapes.push({
        kind: "line",
        x: Math.min(va.x, vb.x) * PT_TO_MM,
        y: Math.min(va.y, vb.y) * PT_TO_MM,
        width: Math.abs(vb.x - va.x) * PT_TO_MM,
        height: Math.abs(vb.y - va.y) * PT_TO_MM,
        stroke: isStroke ? gs.stroke : undefined,
        strokeWidth: isStroke ? gs.lineWidth * PT_TO_MM : undefined,
        opacity: gs.strokeAlpha,
      });
    } else if (pathSegments.length > 0) {
      // Convert all path points to viewport space first
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
      // CMYK args also 0-255 from PDF.js
      const c = args[0] / 255, m = args[1] / 255, y = args[2] / 255, k = args[3] / 255;
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
      // setGState arg is an array of [name, value] pairs
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
      // Apply CTM to get rect in user space; flushPath will then convert to viewport
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
          // promote to cubic with last point as control1
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
      // Clipping paths — discard, don't render
      pathSegments = [];
      pathRect = null;
      pathStart = null;
      pathLast = null;
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintInlineImageXObject) {
      const name = args[0];
      const c = gs.ctm;
      // Image is drawn into unit square [0,1]×[0,1]; map all 4 corners to user space then to viewport
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

async function extractImages(page: any, positions: ImagePos[]): Promise<{ pos: ImagePos; dataUrl: string }[]> {
  const out: { pos: ImagePos; dataUrl: string }[] = [];
  for (const pos of positions) {
    let imgObj: any = null;
    try {
      imgObj = await new Promise<any>((resolve) => {
        try {
          page.objs.get(pos.name, (img: any) => resolve(img));
        } catch {
          try {
            page.commonObjs.get(pos.name, (img: any) => resolve(img));
          } catch {
            resolve(null);
          }
        }
      });
    } catch {
      imgObj = null;
    }
    if (!imgObj || !imgObj.data || !imgObj.width || !imgObj.height) continue;
    const dataUrl = imageDataToUrl(imgObj.width, imgObj.height, imgObj.kind || 0, imgObj.data);
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
    // PDF rect corners are in user space — convert to viewport
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

export async function importPdfToJdf(source: Uint8Array | ArrayBuffer | string, title: string): Promise<JdfDocument> {
  const pdfjs = await loadPdfJs();
  const OPS = pdfjs.OPS;
  let data: any;
  if (typeof source === "string") {
    if (source.startsWith("data:") || source.startsWith("http")) {
      const r = await fetch(source);
      data = await r.arrayBuffer();
    } else {
      const { readFile } = await import("@tauri-apps/plugin-fs");
      data = await readFile(source);
    }
  } else {
    data = source;
  }

  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: Page[] = [];
  const imageResources: Record<string, ImageResource> = {};
  let imgCounter = 0;

  const outline = await doc.getOutline().catch(() => null);
  const flatOutline = await flattenOutline(doc, outline);

  for (let pi = 1; pi <= doc.numPages; pi++) {
    const page = await doc.getPage(pi);
    const viewport = page.getViewport({ scale: 1 });
    const pageW = viewport.width;
    const pageH = viewport.height;

    // Render page to populate image objects
    const dummyCanvas = document.createElement("canvas");
    dummyCanvas.width = Math.ceil(pageW);
    dummyCanvas.height = Math.ceil(pageH);
    const dctx = dummyCanvas.getContext("2d")!;
    try {
      await page.render({ canvasContext: dctx, viewport }).promise;
    } catch { /* swallow */ }

    const ops = await walkOps(page, OPS, viewport);
    const links = await extractLinks(page, viewport);
    const textContent = await page.getTextContent({ disableCombineTextItems: false });
    const items: any[] = textContent.items;

    // PDF.js gives styles keyed by internal font ref (e.g. "g_d0_f1"). The fontFamily in the style
    // is often a generic ("sans-serif"/"serif"). The real font name lives in the commonObjs cache.
    const fontMap = new Map<string, { family: string; weight?: string; style?: string }>();
    for (const k of Object.keys(textContent.styles || {})) {
      const s = (textContent.styles as any)[k];
      // Try to fetch the real font dict
      let realName: string = s.fontFamily || k;
      try {
        await new Promise<void>((resolve) => {
          try {
            page.commonObjs.get(k, (font: any) => {
              if (font?.name) realName = font.name;
              else if (font?.loadedName) realName = font.loadedName;
              resolve();
            });
          } catch { resolve(); }
        });
      } catch { /* ignore */ }
      const cls = classifyFont(realName);
      // If font name is generic, also detect bold/italic from the PDF.js style hints
      if (!cls.weight && /bold/i.test(s.fontFamily || "")) cls.weight = "bold";
      if (!cls.style && /italic|oblique/i.test(s.fontFamily || "")) cls.style = "italic";
      // Also use ascent/descent ratio as a weight hint (bold fonts have heavier ascent)
      fontMap.set(k, cls);
    }

    const runs: TextRun[] = [];
    // Use viewport.convertToViewportPoint to map PDF user-space → viewport (top-left origin)
    // accounting for rotation and CropBox offset. Viewport at scale=1 gives points in PDF pt.
    items.forEach((it, idx) => {
      if (!it.str || !it.str.length) return;
      if ((ops.textRenderingModes[idx] ?? 0) === 3) return; // invisible
      const tr = it.transform as number[];
      const fontSize = Math.hypot(tr[2], tr[3]) || it.height || 10;
      // Baseline in user space:
      const baseX = tr[4];
      const baseY = tr[5];
      // Convert baseline to viewport (top-left)
      const [vx, vy] = viewport.convertToViewportPoint(baseX, baseY) as [number, number];
      // vy is the baseline in viewport (top-down). The cap-line / top of glyph is roughly fontSize above the baseline.
      // For most Latin fonts, ascender ≈ 0.78×fontSize, but PDF.js getTextContent height is already in points.
      // Use the item's height when available, otherwise approximate.
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
    const Y_TOL = 1.0;
    for (const r of runs) {
      const last = lines[lines.length - 1];
      if (
        last &&
        Math.abs(last.y - r.y) <= Y_TOL &&
        Math.abs(last.fontSize - r.fontSize) < 0.6 &&
        last.fontName === r.fontName &&
        last.color === r.color &&
        Math.abs(last.opacity - r.opacity) < 0.05 &&
        r.x - (last.x + last.width) < r.fontSize * PT_TO_MM * 1.5
      ) {
        const gapPt = (r.x - (last.x + last.width)) / PT_TO_MM;
        const sep = gapPt > 1.0 || !last.text.endsWith(" ") ? " " : "";
        last.text = last.text + sep + r.text;
        last.width = (r.x - last.x) + r.width;
      } else {
        lines.push({ ...r });
      }
    }

    function findLinkForRun(r: TextRun) {
      // Match line center against link rects
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

    // Background shapes first
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
        // shape opacity goes via style.opacity
        (shape as any).style = { opacity: Math.round(sh.opacity * 100) / 100 };
      }
      elements.push(shape);
    }

    // Images
    const imgs = await extractImages(page, ops.imagePositions);
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

    // Text on top
    for (const l of lines) {
      // Font name from text item is the internal PDF.js ref (e.g. "g_d0_f1") — look it up first.
      // Fall back to classifying the raw name itself if not in map.
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

      const text: TextElement = {
        type: "text",
        content: l.text.trim(),
        position: { x: Math.max(0, Math.round(l.x * 100) / 100), y: Math.max(0, Math.round(l.y * 100) / 100) },
        width: Math.max(20, Math.round((pageW * PT_TO_MM - l.x) * 100) / 100),
        style,
      };
      if (l.fontSize >= 22) text.heading = 1;
      else if (l.fontSize >= 17) text.heading = 2;
      else if (l.fontSize >= 14 && cls.weight === "bold") text.heading = 3;
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

  // Resolve outline page references → internal page-N links and prepend a TOC page
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

  // If outline has entries, also add tocEntry/tocLevel hints to the closest text on each target page
  // (the auto-TOC element will pick these up if a `toc` element is present, which we don't auto-insert here
  //  since the original PDF already has its own TOC visually).

  return result;
}
