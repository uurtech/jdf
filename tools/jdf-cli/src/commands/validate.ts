import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, "../../../../spec/jdf-schema.json");

export async function validate(file: string): Promise<boolean> {
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return false;
  }

  let doc: unknown;
  try {
    doc = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e: any) {
    console.error(`Invalid JSON: ${e.message}`);
    return false;
  }

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
    console.log(`  Format:    ${d.$jdf}`);
    console.log(`  Title:     ${d.meta?.title}`);
    console.log(`  Pages:     ${pageCount}`);
    console.log(`  Elements:  ${elCount}`);
    return true;
  }

  console.error(`✗ Invalid: ${path.basename(filePath)}`);
  for (const err of validateFn.errors || []) {
    const loc = err.instancePath || "(root)";
    console.error(`  ${loc} — ${err.message}`);
  }
  return false;
}
