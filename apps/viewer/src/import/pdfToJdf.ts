import type { JdfDocument, Page, Element, TextElement, ImageResource, ShapeElement } from "@jdf/core";

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
  const bold = /bold|black|heavy|semibold|demibold/.test(n);
  const italic = /italic|oblique/.test(n);
  let family = "Helvetica";
  if (n.includes("times") || n.includes("serif") || n.includes("roman")) family = "Times New Roman, serif";
  else if (n.includes("courier") || n.includes("mono") || n.includes("consolas") || n.includes("menlo")) family = "JetBrains Mono, ui-monospace, monospace";
  else if (n.includes("helvetica") || n.includes("arial") || n.includes("sans")) family = "Inter, Helvetica, Arial, sans-serif";
  return {
    family,
    weight: bold ? "bold" : undefined,
    style: italic ? "italic" : undefined,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

interface ImageObj {
  name: string;
  width: number;   // px
  height: number;  // px
  dataUrl: string;
  pageX: number;   // mm
  pageY: number;   // mm
  drawW: number;   // mm
  drawH: number;   // mm
}

interface ShapeOp {
  kind: "rect" | "line" | "path";
  x: number; y: number; width: number; height: number;
  fill?: string; stroke?: string; strokeWidth?: number;
  path?: string;
  points?: { x: number; y: number }[];
}

interface ParsedOps {
  textColors: string[];
  shapes: ShapeOp[];
  imagePositions: Map<string, { x: number; y: number; w: number; h: number; transform: number[] }>;
}

function imageDataToUrl(width: number, height: number, kind: number, data: Uint8ClampedArray | Uint8Array): string | null {
  // PDF.js image kinds: 1 = GRAYSCALE_1BPP, 2 = RGB_24BPP, 3 = RGBA_32BPP
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const imgData = ctx.createImageData(width, height);
  const buf = imgData.data;
  if (kind === 3) {
    // RGBA already
    for (let i = 0; i < data.length && i < buf.length; i++) buf[i] = data[i];
  } else if (kind === 2) {
    // RGB → RGBA
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      buf[j] = data[i]; buf[j + 1] = data[i + 1]; buf[j + 2] = data[i + 2]; buf[j + 3] = 255;
    }
  } else if (kind === 1) {
    // 1bpp grayscale
    for (let i = 0, j = 0; i < width * height; i++, j += 4) {
      const byte = data[i >> 3];
      const bit = (byte >> (7 - (i & 7))) & 1;
      const v = bit ? 255 : 0;
      buf[j] = v; buf[j + 1] = v; buf[j + 2] = v; buf[j + 3] = 255;
    }
  } else {
    // Unknown — try as RGBA
    for (let i = 0; i < data.length && i < buf.length; i++) buf[i] = data[i];
  }
  ctx.putImageData(imgData, 0, 0);
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

async function walkOps(page: any, OPS: any, pageH: number): Promise<ParsedOps> {
  const opList = await page.getOperatorList();
  const fnArr: number[] = opList.fnArray;
  const argsArr: any[][] = opList.argsArray;

  // Graphics state stack
  const gs = {
    ctm: [1, 0, 0, 1, 0, 0],
    fill: "#000000",
    stroke: "#000000",
    lineWidth: 1,
  };
  const stack: typeof gs[] = [];

  function multiplyCtm(a: number[], b: number[]) {
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

  const textColors: string[] = [];
  const shapes: ShapeOp[] = [];
  const imagePositions = new Map<string, { x: number; y: number; w: number; h: number; transform: number[] }>();

  let textIdx = 0;
  let pathPoints: { x: number; y: number }[] = [];
  let pathStartX = 0, pathStartY = 0;
  let pathCurX = 0, pathCurY = 0;
  let pathHasRect = false;
  let pathRect: { x: number; y: number; w: number; h: number } | null = null;

  for (let i = 0; i < fnArr.length; i++) {
    const fn = fnArr[i];
    const args = argsArr[i] || [];

    if (fn === OPS.save) {
      stack.push({ ctm: [...gs.ctm], fill: gs.fill, stroke: gs.stroke, lineWidth: gs.lineWidth });
    } else if (fn === OPS.restore) {
      const s = stack.pop();
      if (s) { gs.ctm = s.ctm; gs.fill = s.fill; gs.stroke = s.stroke; gs.lineWidth = s.lineWidth; }
    } else if (fn === OPS.transform) {
      gs.ctm = multiplyCtm(gs.ctm, args as number[]);
    } else if (fn === OPS.setFillRGBColor) {
      gs.fill = rgbToHex(args[0], args[1], args[2]);
    } else if (fn === OPS.setStrokeRGBColor) {
      gs.stroke = rgbToHex(args[0], args[1], args[2]);
    } else if (fn === OPS.setFillGray) {
      const v = args[0]; gs.fill = rgbToHex(v, v, v);
    } else if (fn === OPS.setStrokeGray) {
      const v = args[0]; gs.stroke = rgbToHex(v, v, v);
    } else if (fn === OPS.setFillCMYKColor || fn === OPS.setStrokeCMYKColor) {
      const [c, m, y, k] = args as number[];
      const r = (1 - c) * (1 - k), g = (1 - m) * (1 - k), b = (1 - y) * (1 - k);
      const hex = rgbToHex(r, g, b);
      if (fn === OPS.setFillCMYKColor) gs.fill = hex; else gs.stroke = hex;
    } else if (fn === OPS.setLineWidth) {
      gs.lineWidth = args[0];
    } else if (
      fn === OPS.showText || fn === OPS.showSpacedText ||
      fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText
    ) {
      textColors[textIdx] = gs.fill;
      textIdx++;
    } else if (fn === OPS.rectangle) {
      const [x, y, w, h] = args as number[];
      pathRect = { x, y, w, h };
      pathHasRect = true;
      const p1 = tx(gs.ctm, x, y);
      const p3 = tx(gs.ctm, x + w, y + h);
      pathRect = { x: Math.min(p1.x, p3.x), y: Math.min(p1.y, p3.y), w: Math.abs(p3.x - p1.x), h: Math.abs(p3.y - p1.y) };
    } else if (fn === OPS.constructPath) {
      const [pathOps, pathArgs] = args as [number[], number[]];
      let ai = 0;
      for (const op of pathOps) {
        if (op === OPS.moveTo) {
          const p = tx(gs.ctm, pathArgs[ai], pathArgs[ai + 1]); ai += 2;
          pathStartX = p.x; pathStartY = p.y; pathCurX = p.x; pathCurY = p.y;
          pathPoints.push({ x: p.x, y: p.y });
        } else if (op === OPS.lineTo) {
          const p = tx(gs.ctm, pathArgs[ai], pathArgs[ai + 1]); ai += 2;
          pathCurX = p.x; pathCurY = p.y;
          pathPoints.push({ x: p.x, y: p.y });
        } else if (op === OPS.curveTo) {
          // cubic — sample endpoint
          ai += 4;
          const p = tx(gs.ctm, pathArgs[ai], pathArgs[ai + 1]); ai += 2;
          pathCurX = p.x; pathCurY = p.y;
          pathPoints.push({ x: p.x, y: p.y });
        } else if (op === OPS.curveTo2) {
          ai += 2;
          const p = tx(gs.ctm, pathArgs[ai], pathArgs[ai + 1]); ai += 2;
          pathCurX = p.x; pathCurY = p.y;
          pathPoints.push({ x: p.x, y: p.y });
        } else if (op === OPS.curveTo3) {
          const p = tx(gs.ctm, pathArgs[ai], pathArgs[ai + 1]); ai += 2;
          pathCurX = p.x; pathCurY = p.y;
          pathPoints.push({ x: p.x, y: p.y });
        } else if (op === OPS.closePath) {
          // close — line to start
          pathPoints.push({ x: pathStartX, y: pathStartY });
          pathCurX = pathStartX; pathCurY = pathStartY;
        }
      }
    } else if (
      fn === OPS.fill || fn === OPS.stroke || fn === OPS.fillStroke ||
      fn === OPS.eoFill || fn === OPS.eoFillStroke ||
      fn === OPS.closeFillStroke || fn === OPS.closeStroke || fn === OPS.closeEOFillStroke
    ) {
      const isFill = fn === OPS.fill || fn === OPS.fillStroke || fn === OPS.eoFill || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke;
      const isStroke = fn === OPS.stroke || fn === OPS.fillStroke || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke || fn === OPS.closeStroke || fn === OPS.closeEOFillStroke;
      if (pathHasRect && pathRect) {
        // PDF y is from bottom — convert to top-origin
        const r = pathRect;
        shapes.push({
          kind: "rect",
          x: r.x * PT_TO_MM,
          y: (pageH - r.y - r.h) * PT_TO_MM,
          width: r.w * PT_TO_MM,
          height: r.h * PT_TO_MM,
          fill: isFill ? gs.fill : undefined,
          stroke: isStroke ? gs.stroke : undefined,
          strokeWidth: isStroke ? gs.lineWidth * PT_TO_MM : undefined,
        });
      } else if (pathPoints.length === 2) {
        const a = pathPoints[0], b = pathPoints[1];
        shapes.push({
          kind: "line",
          x: Math.min(a.x, b.x) * PT_TO_MM,
          y: (pageH - Math.max(a.y, b.y)) * PT_TO_MM,
          width: Math.abs(b.x - a.x) * PT_TO_MM,
          height: Math.abs(b.y - a.y) * PT_TO_MM,
          stroke: isStroke ? gs.stroke : undefined,
          strokeWidth: isStroke ? gs.lineWidth * PT_TO_MM : undefined,
        });
      }
      pathPoints = [];
      pathHasRect = false;
      pathRect = null;
    } else if (fn === OPS.endPath) {
      pathPoints = [];
      pathHasRect = false;
      pathRect = null;
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintInlineImageXObject) {
      const name = args[0];
      // CTM at this point has the image transformation; default unit square (0,0)-(1,1)
      const c = gs.ctm;
      // PDF maps image to unit square; map all 4 corners
      const corners = [tx(c, 0, 0), tx(c, 1, 0), tx(c, 1, 1), tx(c, 0, 1)];
      const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      imagePositions.set(name, {
        x: minX * PT_TO_MM,
        y: (pageH - maxY) * PT_TO_MM,
        w: (maxX - minX) * PT_TO_MM,
        h: (maxY - minY) * PT_TO_MM,
        transform: [...c],
      });
    }
  }

  return { textColors, shapes, imagePositions };
}

async function extractImages(page: any, positions: Map<string, any>): Promise<ImageObj[]> {
  if (positions.size === 0) return [];
  const out: ImageObj[] = [];
  for (const [name, pos] of positions) {
    let imgObj: any = null;
    try {
      imgObj = await new Promise<any>((resolve) => {
        try {
          page.objs.get(name, (img: any) => resolve(img));
        } catch {
          try {
            page.commonObjs.get(name, (img: any) => resolve(img));
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
    out.push({
      name,
      width: imgObj.width,
      height: imgObj.height,
      dataUrl,
      pageX: pos.x,
      pageY: pos.y,
      drawW: pos.w,
      drawH: pos.h,
    });
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

  for (let pi = 1; pi <= doc.numPages; pi++) {
    const page = await doc.getPage(pi);
    const viewport = page.getViewport({ scale: 1 });
    const pageW = viewport.width;
    const pageH = viewport.height;

    // Render page first so image objects are populated
    const dummyCanvas = document.createElement("canvas");
    dummyCanvas.width = Math.ceil(pageW);
    dummyCanvas.height = Math.ceil(pageH);
    const dctx = dummyCanvas.getContext("2d")!;
    try {
      await page.render({ canvasContext: dctx, viewport }).promise;
    } catch {
      // ignore render error — we still try to extract
    }

    const ops = await walkOps(page, OPS, pageH);

    const textContent = await page.getTextContent({ disableCombineTextItems: false });
    const items: any[] = textContent.items;

    const fontMap = new Map<string, { family: string; weight?: string; style?: string }>();
    for (const k of Object.keys(textContent.styles || {})) {
      const s = (textContent.styles as any)[k];
      const realName: string = s.fontFamily || k;
      fontMap.set(k, classifyFont(realName));
    }

    const runs: TextRun[] = [];
    items.forEach((it, idx) => {
      if (!it.str || !it.str.length) return;
      const tr = it.transform as number[];
      const fontSize = Math.hypot(tr[2], tr[3]) || it.height || 10;
      const x = tr[4];
      const yBaseline = tr[5];
      const yTop = pageH - yBaseline - fontSize * 0.2;
      runs.push({
        text: it.str,
        x: x * PT_TO_MM,
        y: yTop * PT_TO_MM,
        fontSize,
        fontName: it.fontName,
        width: (it.width || 0) * PT_TO_MM,
        height: (it.height || fontSize) * PT_TO_MM,
        color: ops.textColors[idx] || "#000000",
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

    const elements: Element[] = [];

    // Background shapes first (so text overlays them)
    for (const sh of ops.shapes) {
      if (sh.width < 0.3 && sh.height < 0.3) continue; // skip dust
      const shape: ShapeElement = {
        type: "shape",
        shape: sh.kind === "line" ? "line" : "rect",
        position: { x: Math.round(sh.x * 100) / 100, y: Math.round(sh.y * 100) / 100 },
        width: Math.max(0.1, Math.round(sh.width * 100) / 100),
        height: Math.max(0.1, Math.round(sh.height * 100) / 100),
      };
      if (sh.fill) shape.fill = sh.fill;
      if (sh.stroke) shape.stroke = { color: sh.stroke, width: sh.strokeWidth || 0.3 };
      elements.push(shape);
    }

    // Images
    const imgs = await extractImages(page, ops.imagePositions);
    for (const img of imgs) {
      const resourceKey = `img${imgCounter++}`;
      // Strip "data:image/png;base64," prefix for base64 storage
      const base64 = img.dataUrl.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
      imageResources[resourceKey] = {
        src: "embedded",
        mimeType: "image/png",
        data: base64,
      };
      elements.push({
        type: "image",
        resource: resourceKey,
        position: { x: Math.round(img.pageX * 100) / 100, y: Math.round(img.pageY * 100) / 100 },
        width: Math.max(1, Math.round(img.drawW * 100) / 100),
        height: Math.max(1, Math.round(img.drawH * 100) / 100),
        fit: "fill",
      });
    }

    // Text on top
    for (const l of lines) {
      const cls = fontMap.get(l.fontName) || classifyFont(l.fontName || "");
      const style: any = {
        fontSize: Math.round(l.fontSize * 10) / 10,
        fontFamily: cls.family,
      };
      if (cls.weight === "bold") style.fontWeight = "bold";
      if (cls.style === "italic") style.fontStyle = "italic";
      if (l.color !== "#000000") style.color = l.color;
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
