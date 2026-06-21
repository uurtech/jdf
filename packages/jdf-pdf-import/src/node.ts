import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import type { JdfDocument } from "@jdf/core";
import { importPdfToJdf as coreImportPdfToJdf, type ImportPdfOptions } from "./core";
import type { PdfImportRuntime } from "./types";

let pdfjsModule: any | null = null;

/**
 * Load pdfjs-dist's legacy ESM build — the default build assumes a browser
 * worker context that node can't satisfy. The legacy build runs the worker
 * in the main thread, which is exactly what we want for a CLI.
 */
async function loadNodePdfJs() {
  if (pdfjsModule) return pdfjsModule;
  const { createRequire } = await import("node:module");
  const require_ = createRequire(import.meta.url);
  // Use the SAME build the reader uses (`pdfjs-dist/build/pdf.mjs`). pdfjs
  // ships a separate `legacy` build for older runtimes and prints a console
  // warning when we use the modern build on node — we suppress that single
  // warning so it doesn't pollute CLI output. The algorithm is identical;
  // running the same build keeps reader and CLI output bit-identical.
  const origWarn = console.warn;
  console.warn = (...args: any[]) => {
    if (typeof args[0] === "string" && args[0].includes("legacy")) return;
    origWarn.apply(console, args);
  };
  // @ts-ignore — pdfjs-dist subpath
  const lib = await import("pdfjs-dist/build/pdf.mjs");
  console.warn = origWarn;
  // pdfjs-dist needs a `workerSrc` even when running with `disableWorker:
  // true`, because the early init checks the value before deciding to spin
  // up a fake worker. Point it at the worker bundle so the import resolution
  // succeeds when needed.
  const workerPath = require_.resolve("pdfjs-dist/build/pdf.worker.mjs");
  if (lib.GlobalWorkerOptions) {
    lib.GlobalWorkerOptions.workerSrc = workerPath;
  }
  pdfjsModule = lib;
  return lib;
}

let canvasModule: any | null = null;
async function loadCanvas() {
  if (canvasModule) return canvasModule;
  try {
    // @ts-ignore — optional peer dep, resolved at runtime
    canvasModule = await import("@napi-rs/canvas");
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
