declare module "pdfjs-dist/build/pdf.mjs" {
  export const GlobalWorkerOptions: { workerSrc: string };
  export const OPS: Record<string, number>;
  export function getDocument(args: { data: ArrayBuffer | Uint8Array; [k: string]: unknown }): {
    promise: Promise<any>;
  };
}

declare module "pdfjs-dist/build/pdf.worker.mjs?url" {
  const url: string;
  export default url;
}
