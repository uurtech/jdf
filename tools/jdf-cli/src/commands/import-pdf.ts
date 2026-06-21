import fs from "node:fs";
import path from "node:path";
import { importPdfToJdf } from "@jdf/pdf-import/node";
import { packJdfx, shouldUseJdfx } from "../jdfx";

export interface ImportPdfOptions {
  /**
   * Force JSON output even when the PDF embeds images. With this off, output
   * defaults to `.jdfx` (a zip bundle) for documents with assets. CI / RAG
   * pipelines that prefer pure JSON should pass `forceJson: true`.
   */
  forceJson?: boolean;
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
  const doc = await importPdfToJdf(input, title);
  console.log(`Parsed in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${doc.pages.length} page(s)`);

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
