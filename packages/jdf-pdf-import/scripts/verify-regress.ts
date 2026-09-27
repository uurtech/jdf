/**
 * PDF → JDF regression gate.
 *
 * Converts every PDF of the regression corpus and compares a structural
 * fingerprint of the result with the committed baseline
 * (`regress/baseline.json`). A PDF that converted well yesterday must convert
 * the same way today: same pages, same element mix, same tables (rows ×
 * columns), same words, same fonts, same form fields. Any difference fails
 * the gate — intended changes are accepted explicitly with `--update`, after
 * a side-by-side render check.
 *
 * Corpus (whatever exists locally):
 *   spec/examples/sample.pdf        the canonical fixture
 *   bench/corpus/docs/*.pdf         the benchmark corpus (committed)
 *   ref_docs/*.pdf                  third-party QA PDFs (gitignored; the
 *                                   fingerprints are committed, the PDFs never)
 *
 *   pnpm --filter @jdf/pdf-import verify:regress            compare
 *   pnpm --filter @jdf/pdf-import verify:regress --update   accept current output
 *   pnpm --filter @jdf/pdf-import verify:regress --only FAB  subset (substring)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { importPdfToJdf } from "../src/node";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const baselinePath = path.join(here, "../regress/baseline.json");

const args = process.argv.slice(2);
const update = args.includes("--update");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

interface PageFp {
  types: Record<string, number>;
  tables: string[];       // "rows×cols" per table, in page order
  styledCells: number;    // table cells carrying their own style
  words: number;
  fonts: string[];        // first family of every fontFamily seen, sorted unique
  forms: number;          // input/textarea/checkbox/select/signature
}
interface DocFp { pages: number; textHash: string; words: number; page: PageFp[] }

function textOf(e: any): string {
  switch (e.type) {
    case "text": return String(e.content ?? "");
    case "richtext": return (e.runs ?? []).map((r: any) => String(r.text ?? "")).join("");
    case "table": {
      const cell = (c: any) => (typeof c === "string" ? c : c?.content ?? "");
      return [...(e.headers ?? []), ...(e.rows ?? []).flatMap((r: any) => (Array.isArray(r) ? r.map(cell) : []))].join(" ");
    }
    case "list": return (e.items ?? []).map((it: any) => (typeof it === "string" ? it : it?.content ?? "")).join(" ");
    case "input": case "textarea": case "select": return String(e.value ?? "");
    default: return "";
  }
}

function fingerprint(doc: any): DocFp {
  const page: PageFp[] = [];
  const allWords: string[] = [];
  for (const pg of doc.pages ?? []) {
    const types: Record<string, number> = {};
    const tables: string[] = [];
    const fonts = new Set<string>();
    let styledCells = 0, forms = 0;
    const words: string[] = [];
    for (const e of pg.elements ?? []) {
      types[e.type] = (types[e.type] ?? 0) + 1;
      const fam = e.style?.fontFamily;
      if (typeof fam === "string") fonts.add(fam.split(",")[0].replace(/['"]/g, "").trim());
      if (e.type === "table") {
        const cols = Array.isArray(e.columns) ? e.columns.length : Math.max(0, ...(e.rows ?? []).map((r: any) => (Array.isArray(r) ? r.length : 0)));
        tables.push(`${(e.rows ?? []).length}×${cols}`);
        for (const r of e.rows ?? []) if (Array.isArray(r)) for (const c of r) if (c && typeof c === "object" && c.style) styledCells++;
      }
      if (["input", "textarea", "checkbox", "select", "signature"].includes(e.type)) forms++;
      const t = textOf(e).toLowerCase().replace(/\s+/g, " ").trim();
      if (t) words.push(...t.split(" ").filter(Boolean));
    }
    allWords.push(...words);
    page.push({ types, tables, styledCells, words: words.length, fonts: [...fonts].sort(), forms });
  }
  // Order-insensitive word multiset: reading-order tweaks are not regressions,
  // lost or duplicated words are.
  const textHash = crypto.createHash("sha1").update(allWords.slice().sort().join("\n")).digest("hex").slice(0, 16);
  return { pages: page.length, textHash, words: allWords.length, page };
}

function corpus(): { key: string; file: string }[] {
  const out: { key: string; file: string }[] = [];
  const sample = path.join(root, "spec/examples/sample.pdf");
  if (fs.existsSync(sample)) out.push({ key: "spec/examples/sample.pdf", file: sample });
  for (const dir of ["bench/corpus/docs", "ref_docs"]) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((f) => f.toLowerCase().endsWith(".pdf")).sort()) out.push({ key: `${dir}/${f}`, file: path.join(abs, f) });
  }
  return out.filter((d) => !only || d.key.includes(only));
}

function diffPage(a: PageFp, b: PageFp): string[] {
  const out: string[] = [];
  const keys = new Set([...Object.keys(a.types), ...Object.keys(b.types)]);
  for (const k of keys) {
    const x = a.types[k] ?? 0, y = b.types[k] ?? 0;
    if (x === y) continue;
    // Shapes/images are noisy (a false table used to swallow them); allow 10%.
    const tol = k === "shape" || k === "image" ? Math.max(2, Math.ceil(Math.max(x, y) * 0.1)) : 0;
    if (Math.abs(x - y) > tol) out.push(`${k} ${x} → ${y}`);
  }
  if (a.tables.join(" ") !== b.tables.join(" ")) out.push(`tables [${a.tables.join(" ")}] → [${b.tables.join(" ")}]`);
  if (a.styledCells !== b.styledCells) out.push(`styled cells ${a.styledCells} → ${b.styledCells}`);
  if (Math.abs(a.words - b.words) > Math.max(1, Math.ceil(a.words * 0.005))) out.push(`words ${a.words} → ${b.words}`);
  if (a.fonts.join(",") !== b.fonts.join(",")) out.push(`fonts [${a.fonts.join(",")}] → [${b.fonts.join(",")}]`);
  if (a.forms !== b.forms) out.push(`form fields ${a.forms} → ${b.forms}`);
  return out;
}

async function main() {
  const docs = corpus();
  if (!docs.length) { console.error("verify:regress: no PDFs found"); process.exit(1); }
  const baseline: Record<string, DocFp> = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : {};
  const next: Record<string, DocFp> = { ...baseline };
  let failed = 0, checked = 0, fresh = 0;
  for (const d of docs) {
    const t0 = Date.now();
    let fp: DocFp;
    try {
      const conv = await importPdfToJdf(d.file, path.basename(d.file), {});
      fp = fingerprint(conv);
    } catch (e: any) {
      console.log(`✗ ${d.key}: conversion threw: ${e?.message ?? e}`);
      failed++; continue;
    }
    const ms = Date.now() - t0;
    const base = baseline[d.key];
    if (!base) {
      fresh++;
      next[d.key] = fp;
      console.log(`${update ? "+" : "?"} ${d.key}: ${fp.pages} pages, ${fp.words} words, ${fp.page.reduce((n, p) => n + p.tables.length, 0)} tables (${ms} ms) — ${update ? "added to baseline" : "no baseline yet, run with --update"}`);
      continue;
    }
    checked++;
    const problems: string[] = [];
    if (base.pages !== fp.pages) problems.push(`pages ${base.pages} → ${fp.pages}`);
    if (base.textHash !== fp.textHash) problems.push(`text changed (words ${base.words} → ${fp.words})`);
    const n = Math.min(base.pages, fp.pages);
    for (let i = 0; i < n; i++) for (const p of diffPage(base.page[i], fp.page[i])) problems.push(`p${i + 1}: ${p}`);
    if (problems.length) {
      failed++;
      console.log(`✗ ${d.key} (${ms} ms)`);
      for (const p of problems.slice(0, 12)) console.log(`    ${p}`);
      if (problems.length > 12) console.log(`    … ${problems.length - 12} more`);
      if (update) next[d.key] = fp;
    } else {
      console.log(`✓ ${d.key} (${ms} ms)`);
    }
  }
  if (update) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, JSON.stringify(next, null, 1) + "\n");
    console.log(`\nbaseline written: ${path.relative(root, baselinePath)} (${Object.keys(next).length} documents)`);
    process.exit(0);
  }
  console.log(`\nregress: ${checked} checked, ${failed} changed, ${fresh} without baseline`);
  if (failed) {
    console.log("A PDF that converted differently is a regression until proven otherwise: render it side by side (see CLAUDE.md), then accept with --update.");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
