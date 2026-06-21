import type { JdfDocument } from "@jdf/core";
import { importPdfToJdf as coreImportPdfToJdf, type ImportPdfOptions } from "./core";
import type { PdfImportRuntime } from "./types";

let pdfjsModule: any | null = null;
async function loadBrowserPdfJs() {
  if (pdfjsModule) return pdfjsModule;
  // @ts-ignore — pdfjs-dist subpath
  const lib = await import("pdfjs-dist/build/pdf.mjs");
  // @ts-ignore — Vite worker URL syntax
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  pdfjsModule = lib;
  return lib;
}

function imageDataToUrlDom(width: number, height: number, kind: number, data: Uint8ClampedArray | Uint8Array): string | null {
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

/**
 * Browser entry point — uses DOM <canvas> for PDF.js rendering and PNG encoding.
 *
 * If passed a string source that isn't a URL or data: URI, the call falls back to
 * the Tauri filesystem plugin (only meaningful inside the desktop reader app).
 */
export async function importPdfToJdf(
  source: Uint8Array | ArrayBuffer | string,
  title: string,
  options: ImportPdfOptions = {},
): Promise<JdfDocument> {
  const pdfjs = options.pdfjs || (await loadBrowserPdfJs());
  const runtime: PdfImportRuntime = {
    pdfjs,
    createCanvas(width: number, height: number) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      return { canvas, context };
    },
    encodePng: imageDataToUrlDom,
    async readFile(filePath: string) {
      // Tauri-only — desktop reader uses this for path inputs. In a plain browser
      // build, callers should pass bytes directly.
      // @ts-ignore — optional dependency
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const data = await readFile(filePath);
      return data as Uint8Array;
    },
  };
  return coreImportPdfToJdf(source, title, runtime, options);
}

export type { ImportPdfOptions } from "./core";
export type { PdfImportRuntime } from "./types";
