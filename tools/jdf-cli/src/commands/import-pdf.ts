import fs from "node:fs";
import path from "node:path";
import { importPdfToJdf } from "@jdf/pdf-import/node";
import { packJdfx, shouldUseJdfx } from "../jdfx";
import { describeDocument, type OcrProvider } from "./describe";

export interface ImportPdfOptions {
  /**
   * Force JSON output even when the PDF embeds images. With this off, output
   * defaults to `.jdfx` (a zip bundle) for documents with assets. CI / RAG
   * pipelines that prefer pure JSON should pass `forceJson: true`.
   */
  forceJson?: boolean;
  /** Password for encrypted PDFs (`--password`). */
  password?: string;
  /** Drop invisible (OCR-layer) text instead of keeping it with opacity 0. */
  dropInvisibleText?: boolean;
  /** OCR pages that have no text layer (scans): "tesseract" (local) | "openai". Off by default. */
  ocr?: OcrProvider;
}

export async function importPdf(
  inputPath: string,
  outputPath?: string,
  options: ImportPdfOptions = {},
): Promise<void> {
  const input = path.resolve(inputPath);
  if (!fs.existsSync(input)) {
    console.error(`File not found: ${input}`);
    process.exit(1);
  }

  console.log(`Importing: ${input}`);
  const title = path.basename(input, path.extname(input));
  const t0 = Date.now();
  const doc = await importPdfToJdf(input, title, {
    password: options.password,
    invisibleText: options.dropInvisibleText ? "drop" : "keep",
  });
  console.log(`Parsed in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${doc.pages.length} page(s)`);

  // Scanned pages: no text layer, a page-filling image. Without OCR they are
  // silent in RAG; with --ocr the page image gets `ocr` blocks (and an id).
  const scanned = doc.pages.filter((p) => !p.elements.some((e: any) => (e.type === "text" || e.type === "richtext" || e.type === "table")) && p.elements.some((e: any) => e.type === "image"));
  if (scanned.length) {
    if (options.ocr && options.ocr !== "none") {
      console.log(`OCR:       ${scanned.length} scanned page(s) → ${options.ocr}`);
      for (const p of scanned) for (const e of p.elements as any[]) if (e.type === "image" && !e.id) e.id = `scan-${doc.pages.indexOf(p) + 1}`;
      const ids = scanned.flatMap((p) => (p.elements as any[]).filter((e) => e.type === "image").map((e) => e.id as string));
      for (const id of ids) {
        const st = await describeDocument(doc, path.dirname(input), { element: id, ocr: options.ocr, caption: "none", quiet: true });
        if (st.failed.length) console.warn(`  ! ${st.failed.join("; ")}`);
      }
    } else {
      console.warn(`! ${scanned.length} page(s) have no text layer (scanned). RAG will skip them — re-run with --ocr tesseract (local) or --ocr openai.`);
    }
  }

  let output: string;
  if (outputPath) {
    output = path.resolve(outputPath);
  } else {
    const stem = input.replace(/\.pdf$/i, "");
    const wantJdfx = !options.forceJson && shouldUseJdfx(doc);
    output = stem + (wantJdfx ? ".jdfx" : ".jdf");
  }
  console.log(`Output:    ${output}`);

  if (output.toLowerCase().endsWith(".jdfx")) {
    const { bytes, manifest } = await packJdfx(doc);
    fs.writeFileSync(output, bytes);
    console.log(`\nDone! Created ${doc.pages.length} page(s), ${manifest.assets.length} asset(s) bundled`);
  } else {
    fs.writeFileSync(output, JSON.stringify(doc, null, 2));
    console.log(`\nDone! Created ${doc.pages.length} page(s)`);
  }
  console.log(`Open with: open -a "JDF Reader" "${output}"`);
}
