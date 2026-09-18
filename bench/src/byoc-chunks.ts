/**
 * JDF side of the bring-your-own-corpus benchmark (bench/byoc.py).
 *
 *   tsx bench/src/byoc-chunks.ts <in.pdf> <out.chunks.jsonl> [docId]
 *
 * Runs the shipped importer (`jdf convert`, packages/jdf-pdf-import — the same
 * code the CLI and the desktop reader use) and the shipped chunker
 * (`jdf chunk --strategy section --max-tokens 512`) on one real PDF and writes
 * one JSON line per chunk with the exact string `jdf embed` would embed
 * (embed_text = heading breadcrumb + text). Nothing is re-implemented here.
 */
import fs from "node:fs";
import path from "node:path";
import { importPdfToJdf } from "../../packages/jdf-pdf-import/src/node.ts";
import { chunkDocument, embeddingInput } from "../../tools/jdf-cli/src/commands/chunk.ts";

const [pdf, out, docIdArg, maxTokensArg] = process.argv.slice(2);
const maxTokens = Number(maxTokensArg) || 512;
if (!pdf || !out) { console.error("usage: byoc-chunks.ts <in.pdf> <out.chunks.jsonl> [docId] [maxTokens=512]"); process.exit(2); }
const docId = docIdArg || path.basename(pdf).replace(/\.pdf$/i, "");
const t0 = Date.now();
const doc = await importPdfToJdf(pdf, docId, {});
const tConv = Date.now();
const chunks = chunkDocument(doc, { strategy: "section", maxTokens });
const lines = chunks.map((c) => JSON.stringify({ id: `${docId}-${c.id}`, doc: docId, text: c.text, embed_text: embeddingInput(c), path: c.path, page: c.page, types: c.types, tokens: c.tokens, hash: c.hash }));
fs.writeFileSync(out, lines.join("\n") + (lines.length ? "\n" : ""));
const tables = doc.pages.reduce((a, p) => a + p.elements.filter((e) => e.type === "table").length, 0);
const cliVersion = JSON.parse(fs.readFileSync(new URL("../../tools/jdf-cli/package.json", import.meta.url), "utf8")).version;
console.log(JSON.stringify({ docId, pages: doc.pages.length, tables, chunks: chunks.length, convertMs: tConv - t0, chunkMs: Date.now() - tConv, cliVersion }));
process.exit(0);
