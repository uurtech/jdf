import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import JSZip from "jszip";
import { JDFX_DOCUMENT_PATH, JDFX_MANIFEST_PATH, JDFX_ASSET_DIR } from "@jdf/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the schema path so the same code works in:
//  - dev (`tsx src/index.ts`): src/commands/validate.ts → ../../../spec/jdf-schema.json
//  - bundled (`dist/index.js`): tsup copies the schema next to the bundle as dist/jdf-schema.json
function resolveSchemaPath(): string {
  const bundled = path.resolve(__dirname, "jdf-schema.json");
  if (fs.existsSync(bundled)) return bundled;
  const dev = path.resolve(__dirname, "../../../../spec/jdf-schema.json");
  return dev;
}
const SCHEMA_PATH = resolveSchemaPath();

async function loadDocument(filePath: string): Promise<{ doc: unknown; bundle?: { manifest: any; assetCount: number } } | null> {
  if (filePath.toLowerCase().endsWith(".jdfx")) {
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const docFile = zip.file(JDFX_DOCUMENT_PATH);
    if (!docFile) {
      console.error(`✗ Bundle missing ${JDFX_DOCUMENT_PATH}`);
      return null;
    }
    const doc = JSON.parse(await docFile.async("string"));
    let manifest: any = null;
    const mf = zip.file(JDFX_MANIFEST_PATH);
    if (mf) {
      try { manifest = JSON.parse(await mf.async("string")); } catch { /* tolerate missing */ }
    }
    const assetPrefix = `${JDFX_ASSET_DIR}/`;
    const assetCount = Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith(assetPrefix)).length;
    // Reject zips whose entries try to escape the bundle root via `..`. JSZip
    // doesn't write to disk so this isn't a filesystem traversal, but a
    // crafted manifest with `path: "../whatever"` could shadow document.json
    // or feed a renderer an asset binding it never declared.
    for (const fname of Object.keys(zip.files)) {
      if (fname.includes("..") || fname.startsWith("/")) {
        console.error(`✗ Refusing zip entry with traversal: ${fname}`);
        return null;
      }
    }
    return { doc, bundle: { manifest, assetCount } };
  }
  return { doc: JSON.parse(fs.readFileSync(filePath, "utf-8")) };
}

export async function validate(file: string): Promise<boolean> {
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return false;
  }

  let loaded: Awaited<ReturnType<typeof loadDocument>>;
  try {
    loaded = await loadDocument(filePath);
  } catch (e: any) {
    console.error(`Invalid file: ${e.message}`);
    return false;
  }
  if (!loaded) return false;
  const { doc, bundle } = loaded;

  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(`Schema not found at ${SCHEMA_PATH}`);
    return false;
  }
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8"));

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateFn = ajv.compile(schema);
  const ok = validateFn(doc);

  if (ok) {
    const d = doc as any;
    const pageCount = Array.isArray(d.pages) ? d.pages.length : 0;
    const elCount = Array.isArray(d.pages) ? d.pages.reduce((acc: number, p: any) => acc + (Array.isArray(p?.elements) ? p.elements.length : 0), 0) : 0;
    console.log(`✓ Valid: ${path.basename(filePath)}`);
    console.log(`  Format:    ${d.$jdf}${bundle ? " (jdfx bundle)" : ""}`);
    console.log(`  Title:     ${d.meta?.title}`);
    console.log(`  Pages:     ${pageCount}`);
    console.log(`  Elements:  ${elCount}`);
    if (bundle) {
      console.log(`  Assets:    ${bundle.assetCount}`);
      if (bundle.manifest?.generator) {
        console.log(`  Generator: ${bundle.manifest.generator}`);
      }
    }
    return true;
  }

  console.error(`✗ Invalid: ${path.basename(filePath)}`);
  for (const err of validateFn.errors || []) {
    const loc = err.instancePath || "(root)";
    console.error(`  ${loc} — ${err.message}`);
  }
  return false;
}
