// PDF → JDF conversion lives in the shared package so the desktop reader,
// the CLI, and any future consumer (build pipelines, RAG ingestion workers,
// CI checks) all run the same algorithm. The browser entry point uses the
// DOM canvas + the Tauri filesystem plugin for path inputs.
export { importPdfToJdf } from "@jdf/pdf-import/browser";
