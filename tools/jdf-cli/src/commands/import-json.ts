import fs from "node:fs";
import path from "node:path";
import type { JdfDocument, Page, Element } from "@jdf/core";
import { packJdfx, shouldUseJdfx } from "../jdfx";
import { validate as validateDoc } from "./validate";

export interface ImportJsonOptions {
  /** Force `.jdf` (pure JSON) output even when the document carries assets. */
  forceJson?: boolean;
  /** Skip schema validation after normalisation. */
  skipValidate?: boolean;
}

/**
 * Error thrown by importJson when the input is malformed or schema-invalid.
 * Programmatic callers (long-lived ingestion workers, batch wrappers) catch
 * this; the CLI's `index.ts` translates it into a non-zero exit code.
 *
 * The previous version called `process.exit(1)` directly from this module,
 * which killed the host process on the first bad file — a bug for any
 * pipeline that imports more than one document per run.
 */
export class ImportJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportJsonError";
  }
}

/**
 * JSON → JDF.
 *
 * The CLI's JSON path is for the AI / RAG / CI workflow: models and
 * pipelines emit JSON, and we want to wrap that JSON into a real `.jdf`
 * (or `.jdfx`) without anyone hand-writing the envelope.
 *
 * Supported JSON shapes:
 *   1. A full JDF document — has `$jdf` and `pages` already. We just
 *      validate, optionally re-emit as `.jdfx` if it carries images.
 *   2. A bare element array — wrapped into a single-page A4 doc.
 *   3. A `{ elements: [...] }` or `{ pages: [...] }` partial — filled in
 *      with sensible defaults (A4, no margins, format 1.0.0).
 *
 * Validation runs at the end (skip with `skipValidate: true`); the function
 * throws `ImportJsonError` on schema failure so callers can decide whether
 * to halt the pipeline or skip the bad doc.
 */
export async function importJson(
  inputPath: string,
  outputPath?: string,
  options: ImportJsonOptions = {},
): Promise<void> {
  const input = path.resolve(inputPath);
  if (!fs.existsSync(input)) {
    throw new ImportJsonError(`File not found: ${input}`);
  }

  console.log(`Importing: ${input}`);
  const raw = fs.readFileSync(input, "utf-8");
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    throw new ImportJsonError(`Not valid JSON: ${e.message}`);
  }

  const title = path.basename(input, path.extname(input));
  const doc = normaliseToJdf(parsed, title);

  let output: string;
  if (outputPath) {
    output = path.resolve(outputPath);
  } else {
    const stem = input.replace(/\.json$/i, "");
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

  if (!options.skipValidate) {
    console.log("");
    const ok = await validateDoc(output);
    if (!ok) throw new ImportJsonError(`Schema validation failed for ${output}`);
  }

  console.log(`Open with: open -a "JDF Reader" "${output}"`);
}

function normaliseToJdf(input: any, title: string): JdfDocument {
  // Shape 1: already a full JDF doc. Build a fresh object so we never
  // mutate the caller's parsed input — earlier the meta merge ran in-place
  // on `input`, which surprised programmatic callers passing a shared
  // reference.
  if (input && typeof input === "object" && typeof input.$jdf === "string" && Array.isArray(input.pages)) {
    if (input.pages.length === 0) {
      throw new ImportJsonError("JDF document has zero pages — `pages` must contain at least one page");
    }
    const meta = input.meta && typeof input.meta === "object"
      ? { title: input.meta.title ?? title, pageSize: "A4", unit: "mm", ...input.meta }
      : { title, pageSize: "A4", unit: "mm" };
    return {
      $jdf: input.$jdf,
      meta,
      ...(input.styles ? { styles: input.styles } : {}),
      ...(input.resources ? { resources: input.resources } : {}),
      ...(input.header ? { header: input.header } : {}),
      ...(input.footer ? { footer: input.footer } : {}),
      pages: input.pages as Page[],
    };
  }

  // Shape 2: bare element array.
  if (Array.isArray(input)) {
    if (input.length === 0) {
      throw new ImportJsonError("Element array is empty — wrap at least one element");
    }
    return wrapElements(input as Element[], title);
  }

  // Shape 3: partials.
  if (input && typeof input === "object") {
    if (Array.isArray(input.pages)) {
      if (input.pages.length === 0) {
        throw new ImportJsonError("`pages` is empty — provide at least one page");
      }
      return {
        $jdf: input.$jdf || "1.0.0",
        meta: { title, pageSize: "A4", unit: "mm", ...(input.meta || {}) },
        ...(input.styles ? { styles: input.styles } : {}),
        ...(input.resources ? { resources: input.resources } : {}),
        ...(input.header ? { header: input.header } : {}),
        ...(input.footer ? { footer: input.footer } : {}),
        pages: input.pages as Page[],
      };
    }
    if (Array.isArray(input.elements)) {
      if (input.elements.length === 0) {
        throw new ImportJsonError("`elements` is empty — provide at least one element");
      }
      return wrapElements(input.elements as Element[], title, input.meta);
    }
  }

  throw new ImportJsonError(
    "Unrecognised JSON shape — expected a JDF document, an element array, or { pages: [...] } / { elements: [...] }",
  );
}

function wrapElements(elements: Element[], title: string, meta?: any): JdfDocument {
  return {
    $jdf: "1.0.0",
    meta: {
      title,
      pageSize: "A4",
      unit: "mm",
      ...(meta || {}),
    },
    pages: [
      {
        id: "page-1",
        elements,
      } as Page,
    ],
  };
}
