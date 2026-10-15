import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import type { JdfDocument } from "@jdf/core";
import { importPdfToJdf as coreImportPdfToJdf, type ImportPdfOptions } from "./core";
import type { PdfImportRuntime } from "./types";

let pdfjsModule: any | null = null;
let pdfjsLoadPromise: Promise<any> | null = null;
let pdfjsAssetDirs: { standardFontDataUrl: string; cMapUrl: string } | null = null;

/**
 * Load pdfjs-dist's modern ESM build — same one the desktop reader uses, so
 * the algorithm and output are bit-identical between surfaces.
 *
 * Concurrency: two simultaneous importPdfToJdf() calls before this completes
 * would each capture `console.warn` as `origWarn`. The second capture would
 * be the first call's wrapper, and the second restore would put that wrapper
 * back permanently. Guard with a single in-flight promise so the second
 * caller awaits the first one's load.
 */
async function loadNodePdfJs() {
  if (pdfjsModule) return pdfjsModule;
  if (pdfjsLoadPromise) return pdfjsLoadPromise;
  pdfjsLoadPromise = (async () => {
    const { createRequire } = await import("node:module");
    const require_ = createRequire(import.meta.url);
    // pdfjs prints "Please use the `legacy` build in Node.js environments."
    // at module load when we use the modern build on node. The output is
    // identical, so suppress that one line for the duration of the import.
    // PDF.js's `warn()` writes through console.log (not console.warn), which
    // is why the earlier console.warn shim never caught it.
    const origLog = console.log;
    console.log = (...args: any[]) => {
      if (typeof args[0] === "string" && args[0].includes("`legacy` build")) return;
      origLog.apply(console, args);
    };
    let lib: any;
    try {
      // @ts-ignore — pdfjs-dist subpath
      lib = await import("pdfjs-dist/build/pdf.mjs");
    } finally {
      console.log = origLog;
    }
    const workerPath = require_.resolve("pdfjs-dist/build/pdf.worker.mjs");
    if (lib.GlobalWorkerOptions) {
      // The fake worker `import()`s this string. Node's ESM loader rejects
      // bare absolute paths on Windows ("Received protocol 'd:'"), so hand
      // it a proper file:// URL on every platform.
      const { pathToFileURL } = await import("node:url");
      lib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    }
    // Sibling asset directories shipped in the pdfjs-dist package.
    const { dirname, join } = await import("node:path");
    const pkgDir = dirname(dirname(workerPath));
    pdfjsAssetDirs = { standardFontDataUrl: join(pkgDir, "standard_fonts") + "/", cMapUrl: join(pkgDir, "cmaps") + "/" };
    pdfjsModule = lib;
    return lib;
  })();
  return pdfjsLoadPromise;
}

let canvasModule: any | null = null;
async function loadCanvas() {
  if (canvasModule) return canvasModule;
  try {
    // @ts-ignore — optional peer dep, resolved at runtime
    canvasModule = await import("@napi-rs/canvas");
    // PDF.js's canvas renderer reaches for browser globals (DOMMatrix for
    // pattern transforms, Path2D for clipping / glyph paths, ImageData).
    // Without them `page.render()` throws on any page with a clip or a
    // gradient — the throw was swallowed, but a page that never finished
    // rendering never materialised its image XObjects either, so those
    // images were silently missing from CLI output. @napi-rs/canvas ships
    // compatible implementations; install them once if the host has none.
    const g = globalThis as any;
    if (typeof g.DOMMatrix === "undefined" && canvasModule.DOMMatrix) g.DOMMatrix = canvasModule.DOMMatrix;
    if (typeof g.Path2D === "undefined" && canvasModule.Path2D) g.Path2D = canvasModule.Path2D;
    if (typeof g.ImageData === "undefined" && canvasModule.ImageData) g.ImageData = canvasModule.ImageData;
    return canvasModule;
  } catch (err) {
    throw new Error(
      "[@jdf/pdf-import/node] @napi-rs/canvas is required for the node entry point. Install it: pnpm add @napi-rs/canvas",
    );
  }
}

function makeNodeEncoder(canvasMod: any) {
  return function encodePngNode(width: number, height: number, kind: number, data: Uint8ClampedArray | Uint8Array): string | null {
    const canvas = canvasMod.createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const imgData = ctx.createImageData(width, height);
    const buf = imgData.data as Uint8ClampedArray;
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
      const png: Buffer = canvas.toBuffer("image/png");
      return `data:image/png;base64,${png.toString("base64")}`;
    } catch {
      return null;
    }
  };
}

/**
 * Node entry point — uses @napi-rs/canvas (Rust-native, pure-Node, no system
 * libraries to install) for PDF.js rendering + PNG encoding, and node:fs for
 * reading file paths.
 *
 * Use this from CLIs, build pipelines, RAG ingestion workers, anywhere that
 * isn't a browser. Output is identical to the browser entry point — same
 * algorithm, same JdfDocument structure.
 */
export async function importPdfToJdf(
  source: Uint8Array | ArrayBuffer | string,
  title: string,
  options: ImportPdfOptions = {},
): Promise<JdfDocument> {
  const pdfjs = options.pdfjs || (await loadNodePdfJs());
  const canvasMod = await loadCanvas();
  const runtime: PdfImportRuntime = {
    pdfjs,
    disableWorker: true,
    ...(pdfjsAssetDirs ?? {}),
    createCanvas(width: number, height: number) {
      const canvas = canvasMod.createCanvas(width, height);
      const context = canvas.getContext("2d");
      return { canvas, context };
    },
    encodePng: makeNodeEncoder(canvasMod),
    async readFile(filePath: string) {
      const buf = await readFile(filePath);
      return new Uint8Array(buf);
    },
  };
  return coreImportPdfToJdf(source, title, runtime, options);
}

export type { ImportPdfOptions } from "./core";
export type { PdfImportRuntime } from "./types";
