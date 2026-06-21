// Default entry point — re-exports the runtime-agnostic core. Most consumers
// should pick the matching environment-specific entry point instead:
//   import { importPdfToJdf } from "@jdf/pdf-import/browser";
//   import { importPdfToJdf } from "@jdf/pdf-import/node";
export { importPdfToJdf } from "./core";
export type { ImportPdfOptions } from "./core";
export type { PdfImportRuntime } from "./types";
