import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import type { JdfDocument, ImageOcr, OcrBlock } from "@jdf/core";
import { JDFX_DOCUMENT_PATH } from "@jdf/core";
import { packJdfx } from "../jdfx";

/**
 * `jdf describe` — give every image the text RAG needs: OCR blocks (what is
 * written in it) and a caption (what it shows). Both land in document.json as
 * text; the picture itself stays an asset. Same pattern as `jdf transcribe`.
 *
 *   --ocr tesseract   local, WASM (tesseract.js); language data is fetched once and cached
 *   --ocr openai      OpenAI vision model returns the text
 *   --caption ollama  local vision model (default qwen2.5vl:3b; llava / gemma3 work too)
 *   --caption openai  OpenAI vision model (OPENAI_API_KEY)
 *   --ocr none / --caption none to skip either step
 *
 * Nothing leaves the machine unless you choose an openai provider.
 */
export type OcrProvider = "tesseract" | "openai" | "none";
export type CaptionProvider = "ollama" | "openai" | "none";

export interface DescribeOptions {
  element?: string;
  ocr?: OcrProvider;
  caption?: CaptionProvider;
  ocrLanguage?: string;      // tesseract language code(s), e.g. "eng", "tur", "eng+tur"
  captionModel?: string;     // ollama model (default moondream) or openai model (default gpt-4o-mini)
  /** Re-run even for images that already have text. */
  force?: boolean;
  output?: string;
  quiet?: boolean;
}

const DEFAULT_OLLAMA_MODEL = "qwen2.5vl:3b"; // moondream returns garbage on current Ollama; qwen2.5vl reads charts and text well at 3 GB
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

// ── document IO (shared shape with transcribe) ──────────────────────────────
async function loadDoc(file: string): Promise<{ doc: JdfDocument; bundle: boolean }> {
  if (file.toLowerCase().endsWith(".jdfx")) {
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const f = zip.file(JDFX_DOCUMENT_PATH);
    if (!f) throw new Error(`Bundle missing ${JDFX_DOCUMENT_PATH}`);
    const doc = JSON.parse(await f.async("string")) as JdfDocument;
    const manifest = zip.file("manifest.json") ? JSON.parse(await zip.file("manifest.json")!.async("string")) : { assets: [] };
    for (const a of manifest.assets ?? []) {
      const af = zip.file(a.path); if (!af) continue;
      const data = (await af.async("nodebuffer")).toString("base64");
      const res = { src: "embedded" as const, mimeType: a.mimeType, data };
      doc.resources ??= {};
      if (/^video\//i.test(a.mimeType || "")) (doc.resources.videos ??= {})[a.id] = res; else (doc.resources.images ??= {})[a.id] = res;
    }
    return { doc, bundle: true };
  }
  return { doc: JSON.parse(fs.readFileSync(file, "utf-8")), bundle: false };
}

export function findImages(doc: JdfDocument): { el: any; page: number; index: number }[] {
  const out: { el: any; page: number; index: number }[] = [];
  const walk = (els: any[] | undefined, page: number) => { for (const el of els ?? []) { if (el?.type === "image") out.push({ el, page, index: out.length }); if (el?.elements) walk(el.elements, page); } };
  doc.pages.forEach((p, i) => walk(p.elements as any[], i + 1));
  return out;
}

/** Image bytes + mime for an element: bundled asset, data URL, local path or URL. */
export async function imageBytes(doc: JdfDocument, el: any, docDir: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const fromData = (d: string, fallback: string) => { const m = d.match(/^data:([^;,]+)?[^,]*,(.*)$/s); return m ? { bytes: Buffer.from(m[2], "base64"), mime: m[1] || fallback } : { bytes: Buffer.from(d, "base64"), mime: fallback }; };
  const res = el.resource ? (doc.resources?.images?.[el.resource] ?? (doc.resources as any)?.[el.resource]) : undefined;
  if (res?.data) return fromData(String(res.data), res.mimeType || "image/png");
  if (res?.path) { const p = path.resolve(docDir, res.path); return fs.existsSync(p) ? { bytes: fs.readFileSync(p), mime: res.mimeType || "image/png" } : null; }
  const src: string | undefined = el.src;
  if (!src) return null;
  if (src.startsWith("data:")) return fromData(src, "image/png");
  if (/^https?:\/\//i.test(src)) { const r = await fetch(src); if (!r.ok) throw new Error(`download failed ${r.status}: ${src}`); return { bytes: Buffer.from(await r.arrayBuffer()), mime: r.headers.get("content-type") || "image/png" }; }
  const local = path.resolve(docDir, src);
  return fs.existsSync(local) ? { bytes: fs.readFileSync(local), mime: "image/png" } : null;
}

// ── OCR providers ───────────────────────────────────────────────────────────
async function ocrTesseract(bytes: Buffer, lang: string): Promise<{ blocks: OcrBlock[]; source: string }> {
  const { createWorker } = await import("tesseract.js");
  const cachePath = path.join(os.homedir(), ".cache", "jdf", "tesseract");
  fs.mkdirSync(cachePath, { recursive: true });
  const worker = await createWorker(lang, 1, { cachePath, logger: () => {} } as any);
  try {
    // tesseract.js ≥ 6 only returns the line/word tree when asked for it.
    const { data } = await worker.recognize(bytes, {}, { text: true, blocks: true } as any);
    // Pixel size for normalised bboxes — tesseract.js does not report it; @napi-rs/canvas is already a dependency.
    let w = 1, h = 1;
    try { const { loadImage } = await import("@napi-rs/canvas"); const im = await loadImage(bytes); w = im.width || 1; h = im.height || 1; } catch { /* keep 1 → pixel coordinates */ }
    const lines: any[] = (data as any).blocks?.flatMap((b: any) => b.paragraphs?.flatMap((p: any) => p.lines ?? []) ?? []) ?? (data as any).lines ?? [];
    const blocks: OcrBlock[] = lines
      .map((ln) => ({ text: String(ln.text ?? "").replace(/\s+/g, " ").trim(), confidence: ln.confidence != null ? Math.round(ln.confidence) / 100 : undefined, bbox: ln.bbox ? { x: +(ln.bbox.x0 / w).toFixed(4), y: +(ln.bbox.y0 / h).toFixed(4), w: +((ln.bbox.x1 - ln.bbox.x0) / w).toFixed(4), h: +((ln.bbox.y1 - ln.bbox.y0) / h).toFixed(4) } : undefined }))
      // Drop near-random guesses (stylised logos, gradients) — they only add noise to the index.
      .filter((b) => b.text.length > 0 && (b.confidence == null || b.confidence >= 0.3));
    if (!blocks.length && String((data as any).text ?? "").trim()) blocks.push({ text: String((data as any).text).replace(/\s+/g, " ").trim() });
    return { blocks, source: `tesseract.js:${lang}` };
  } finally { await worker.terminate(); }
}

async function openaiVision(bytes: Buffer, mime: string, model: string, prompt: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY; if (!key) throw new Error("OPENAI_API_KEY is not set");
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const r = await fetch(`${base}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` } }] }], max_tokens: 800 }) });
  if (!r.ok) throw new Error(`OpenAI vision failed ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j: any = await r.json();
  return String(j.choices?.[0]?.message?.content ?? "").trim();
}

async function ollamaVision(bytes: Buffer, model: string, prompt: string): Promise<string> {
  const r = await fetch(`${OLLAMA_HOST}/api/generate`, { method: "POST", body: JSON.stringify({ model, prompt, images: [bytes.toString("base64")], stream: false, options: { temperature: 0 } }) });
  if (!r.ok) throw new Error(`Ollama vision failed ${r.status}: ${(await r.text()).slice(0, 300)} — is the model pulled? (ollama pull ${model})`);
  const j: any = await r.json();
  return String(j.response ?? "").trim();
}

const CAPTION_PROMPT = "Describe this image for a search index in one or two factual sentences: what it shows, any chart type, axes, trends, labels, names and numbers you can read. No preamble.";
const OCR_PROMPT = "Transcribe all text visible in this image exactly, line by line, top to bottom, left to right. Output only the text.";

/** Describe every image (or one) in a document in memory. Returns what was filled. */
export async function describeDocument(doc: JdfDocument, docDir: string, opts: DescribeOptions = {}): Promise<{ ocr: number; captions: number; skipped: number; failed: string[] }> {
  const ocrP = opts.ocr ?? "tesseract";
  const capP = opts.caption ?? "ollama";
  const lang = opts.ocrLanguage ?? "eng";
  const images = findImages(doc);
  const targets = opts.element != null ? images.filter((im) => im.el.id === opts.element || String(im.index) === opts.element) : images;
  if (opts.element != null && !targets.length) throw new Error(`no image element "${opts.element}" (have: ${images.map((i) => i.el.id ?? `#${i.index}`).join(", ") || "none"})`);
  const stats = { ocr: 0, captions: 0, skipped: 0, failed: [] as string[] };
  for (const im of targets) {
    const el = im.el;
    if (!el.id) el.id = `image-${im.index + 1}`;
    const needOcr = ocrP !== "none" && (opts.force || !el.ocr?.blocks?.length);
    const needCap = capP !== "none" && (opts.force || !el.caption);
    if (!needOcr && !needCap) { stats.skipped++; continue; }
    const img = await imageBytes(doc, el, docDir);
    if (!img) { stats.failed.push(`${el.id}: image bytes not reachable`); continue; }
    if (needOcr) {
      try {
        if (ocrP === "tesseract") { const r = await ocrTesseract(img.bytes, lang); el.ocr = { language: lang, source: r.source, created: new Date().toISOString(), blocks: r.blocks } as ImageOcr; }
        else { const text = await openaiVision(img.bytes, img.mime, opts.captionModel ?? DEFAULT_OPENAI_MODEL, OCR_PROMPT); el.ocr = { source: `openai:${opts.captionModel ?? DEFAULT_OPENAI_MODEL}`, created: new Date().toISOString(), blocks: text.split(/\r?\n/).map((t) => t.trim()).filter(Boolean).map((t) => ({ text: t })) } as ImageOcr; }
        stats.ocr++;
      } catch (e: any) { stats.failed.push(`${el.id} ocr: ${e.message}`); }
    }
    if (needCap) {
      try {
        const model = opts.captionModel ?? (capP === "ollama" ? DEFAULT_OLLAMA_MODEL : DEFAULT_OPENAI_MODEL);
        const text = capP === "ollama" ? await ollamaVision(img.bytes, model, CAPTION_PROMPT) : await openaiVision(img.bytes, img.mime, model, CAPTION_PROMPT);
        if (text) { el.caption = text; el.captionSource = `${capP}:${model}`; stats.captions++; }
      } catch (e: any) { stats.failed.push(`${el.id} caption: ${e.message}`); }
    }
    if (!opts.quiet) console.log(`  · ${el.id} (page ${im.page}): ${needOcr ? `ocr ${el.ocr?.blocks?.length ?? 0} block(s)` : "ocr kept"}${needCap ? ` · caption ${el.caption ? `"${String(el.caption).slice(0, 70)}${String(el.caption).length > 70 ? "…" : ""}"` : "—"}` : ""}`);
  }
  return stats;
}

export async function describeFile(inputPath: string, opts: DescribeOptions = {}): Promise<void> {
  const input = path.resolve(inputPath);
  if (!fs.existsSync(input)) throw new Error(`File not found: ${input}`);
  const { doc, bundle } = await loadDoc(input);
  const images = findImages(doc);
  if (!images.length) { console.log(`No image elements in ${path.basename(input)} — nothing to describe.`); return; }
  console.log(`Describing: ${path.basename(input)} — ${images.length} image(s); ocr=${opts.ocr ?? "tesseract"} caption=${opts.caption ?? "ollama"}${(opts.caption ?? "ollama") === "ollama" ? ` (${opts.captionModel ?? DEFAULT_OLLAMA_MODEL}, local)` : ""}`);
  const stats = await describeDocument(doc, path.dirname(input), opts);
  const output = opts.output ? path.resolve(opts.output) : input;
  if (output.toLowerCase().endsWith(".jdfx") || (bundle && !opts.output)) fs.writeFileSync(output, (await packJdfx(doc)).bytes);
  else fs.writeFileSync(output, JSON.stringify(doc, null, 2));
  console.log(`Done: ${stats.ocr} OCR, ${stats.captions} caption(s), ${stats.skipped} already had text${stats.failed.length ? `, ${stats.failed.length} failed` : ""}.`);
  for (const f of stats.failed) console.warn(`  ! ${f}`);
  console.log(`Output: ${output}\nNext:   jdf chunk ${path.basename(output)}   # image text is now part of the chunks`);
  if (stats.failed.length && stats.ocr + stats.captions === 0) process.exitCode = 1;
}
