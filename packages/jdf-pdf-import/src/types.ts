/**
 * Runtime adapter — abstracts the two things the PDF import needs from the
 * environment: a canvas (PDF.js needs one to render pages so image XObjects
 * are realised) and an image encoder (we need a PNG data URL for each image).
 *
 * The browser entry point provides one backed by DOM <canvas>; the node entry
 * point provides one backed by @napi-rs/canvas.
 */
export interface PdfImportRuntime {
  /** Create a canvas + 2d context. PDF.js calls render() against this. */
  createCanvas(width: number, height: number): {
    canvas: any;
    context: any;
  };

  /**
   * Turn raw image bytes (as PDF.js exposes them via page.objs / commonObjs)
   * into a `data:image/png;base64,...` URL.
   */
  encodePng(width: number, height: number, kind: number, data: Uint8ClampedArray | Uint8Array): string | null;

  /**
   * Read a file from disk into bytes when the input is a path.
   * Browser implementations should throw — only node provides this.
   */
  readFile?(path: string): Promise<Uint8Array>;

  /**
   * Optional: a custom pdfjs-dist module. If omitted, the runtime imports
   * the default browser/node build itself.
   */
  pdfjs?: any;
}
