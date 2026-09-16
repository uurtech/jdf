import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import type { JdfDocument, Element } from "@jdf/core";
import { JDFX_DOCUMENT_PATH } from "@jdf/core";

/**
 * `jdf chunk` — turn a .jdf / .jdfx document into retrieval-ready chunks.
 *
 * This is deliberately SEPARATE from `jdf convert`: convert is a pure, offline,
 * deterministic format transform that must never depend on a chunking strategy
 * or an embedding model. Chunking is a derived, cacheable RAG layer — you run
 * it only when you want to feed a vector store. `jdf embed` builds on top of
 * this (it calls chunkDocument internally, then adds vectors).
 *
 * The output is deterministic: same document + same options → byte-identical
 * chunks (and therefore stable content hashes). That determinism is what makes
 * `jdf embed --incremental` able to skip unchanged chunks and only re-embed
 * what actually changed — the core RAG-ingestion speed win.
 */

export type ChunkStrategy = "section" | "element" | "fixed";
export type ChunkFormat = "jsonl" | "json" | "inline";

export interface Chunk {
  /** Stable id: derived from element ids/positions, so it survives re-runs. */
  id: string;
  /** Serialized, embed-ready text of everything in the chunk. */
  text: string;
  /** Heading breadcrumb, e.g. ["Report", "Pricing"] — great as a vector-DB metadata filter. */
  path: string[];
  /** 1-based page number the chunk starts on. */
  page: number;
  /** Element types present in the chunk (e.g. ["text","table"]). */
  types: string[];
  /** Approximate token count (~4 chars/token) for context-budget planning. */
  tokens: number;
  /** SHA-256 (first 12 hex) of `text` — the incremental-reindex key. */
  hash: string;
  /** Set on chunks cut from a video transcript: which element and which time window
   *  (seconds). A retrieval hit becomes "open the video at 02:13" via viewer.seek(). */
  media?: { element: string; t0: number; t1: number };
}

export interface ChunkOptions {
  strategy?: ChunkStrategy;
  /** Soft cap; a chunk that exceeds it is split on element boundaries. */
  maxTokens?: number;
  /** Transcript window for video chunks, in seconds (default 45). Segments are
   *  never split; a window closes at the first segment boundary past this. */
  transcriptWindowSec?: number;
}

const DEFAULT_TRANSCRIPT_WINDOW = 45;

const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

/**
 * Cut a video's transcript into time-windowed chunks. Each chunk text starts
 * with "[hh:mm:ss–hh:mm:ss]" so the embedded vector, BM25 and the LLM all see
 * the time; `media` carries the same window structurally. Chapters extend the
 * breadcrumb so retrieval metadata reads "Report > 3. Section > Talk > Chapter".
 */
function transcriptChunks(el: any, elementId: string, page: number, crumb: string[], windowSec: number, maxTokens: number): Chunk[] {
  const segs: any[] = Array.isArray(el?.transcript?.segments) ? el.transcript.segments : [];
  if (!segs.length) return [];
  const chapters: any[] = Array.isArray(el?.chapters) ? [...el.chapters].sort((a, b) => a.t - b.t) : [];
  const chapterAt = (t: number) => { let cur: any = null; for (const c of chapters) { if (c.t <= t + 1e-6) cur = c; else break; } return cur; };
  const out: Chunk[] = [];
  let win: any[] = [];
  const flush = () => {
    if (!win.length) return;
    const t0 = win[0].t0, t1 = win[win.length - 1].t1;
    const body = win.map((sg) => (sg.speaker ? `${sg.speaker}: ${sg.text}` : sg.text)).join(" ").replace(/\s+/g, " ").trim();
    const text = `[${fmtTime(t0)}–${fmtTime(t1)}] ${body}`;
    const chapter = chapterAt(t0);
    const path = [...crumb, ...(el.title ? [String(el.title)] : []), ...(chapter ? [String(chapter.title)] : [])];
    out.push({ id: `${elementId}@${Math.round(t0)}`, text, path, page, types: ["video"], tokens: estimateTokens(text), hash: hashText(text), media: { element: elementId, t0, t1 } });
    win = [];
  };
  for (const sg of segs) {
    if (typeof sg?.text !== "string" || !sg.text.trim()) continue;
    const startsNewChapter = win.length && chapterAt(sg.t0) !== chapterAt(win[0].t0);
    const spansWindow = win.length && sg.t1 - win[0].t0 > windowSec;
    const overBudget = win.length && estimateTokens(win.map((w) => w.text).join(" ") + sg.text) > maxTokens;
    if (startsNewChapter || spansWindow || overBudget) flush();
    win.push(sg);
  }
  flush();
  return out;
}

const DEFAULT_MAX_TOKENS = 512;

/** Rough token estimate. Good enough for budgeting; not a real tokenizer. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function headingLevel(el: any): number | null {
  const h = el.heading;
  if (h === true) return 1;
  if (typeof h === "number" && h >= 1 && h <= 6) return h;
  if (typeof el.tocLevel === "number") return el.tocLevel;
  return null;
}

/**
 * Serialize an element to plain text optimized for embedding. Tables become
 * "header: value" rows (the single biggest RAG win over PDF, where table
 * structure is lost); lists become bulletless lines; richtext concatenates its
 * runs; collapsible recurses. Returns "" for purely visual elements (shape).
 */
export function serializeElement(el: Element): string {
  const e = el as any;
  switch (e.type) {
    case "text":
      return String(e.content ?? "").trim();
    case "richtext":
      return (e.runs || []).map((r: any) => r.text ?? "").join("").trim();
    case "list": {
      const walk = (items: any[], depth = 0): string[] =>
        (items || []).flatMap((it) => {
          const line = "  ".repeat(depth) + "- " + String(it.content ?? "").trim();
          return it.children?.length ? [line, ...walk(it.children, depth + 1)] : [line];
        });
      return walk(e.items).join("\n");
    }
    case "table": {
      const headers: string[] = e.headers
        ?? e.columns?.map((c: any) => c.header || "").filter((h: string) => h) ?? [];
      const cell = (c: any) => (typeof c === "string" ? c : c?.content ?? "");
      const rows: any[][] = e.rows || [];
      // "header: value | header: value" per row keeps column semantics attached
      // to each value — retrievers can match "Price: $4,800" instead of a bare
      // number floating away from its column.
      const lines = rows.map((row) =>
        row
          .map((c, i) => {
            const h = headers[i];
            const v = cell(c).trim();
            return h ? `${h}: ${v}` : v;
          })
          .filter((s) => s !== "")
          .join(" | "),
      );
      return lines.join("\n");
    }
    case "collapsible": {
      const title = String(e.title ?? "").trim();
      const inner = (e.elements || []).map(serializeElement).filter(Boolean).join("\n");
      return [title, inner].filter(Boolean).join("\n");
    }
    case "input":
    case "textarea":
    case "select": {
      const label = e.label ? `${e.label}: ` : "";
      const val = e.multiple ? (e.values || []).join(", ") : (e.value ?? "");
      return `${label}${val}`.trim();
    }
    case "checkbox":
      return `${e.checked ? "[x]" : "[ ]"} ${e.label ?? ""}`.trim();
    case "image": {
      // Everything we know about the picture, so a chart or a scanned page is
      // retrievable: alt, the vision caption, then the OCR text.
      const parts: string[] = [];
      if (e.alt) parts.push(`[image: ${e.alt}]`);
      if (e.caption) parts.push(String(e.caption).trim());
      const ocr = (e.ocr?.blocks || []).map((b: any) => String(b.text ?? "").trim()).filter(Boolean).join("\n");
      if (ocr) parts.push(ocr);
      return parts.join("\n");
    }
    case "video":
      return e.title ? `[video: ${e.title}]` : "";
    case "toc":
    case "shape":
    case "signature":
      return "";
    default:
      return "";
  }
}

/**
 * The string that actually gets embedded for a chunk: the heading breadcrumb
 * followed by the chunk text ("contextual chunk header"). A table row deep in
 * section 7 of a quarterly report embeds as
 *   "Acme — Q3 2025 Operations Report > 7. Vendor Spend\nVendor: … | Annual spend: …"
 * so the vector carries *which document and section* the row belongs to. The
 * chunk `hash` stays a hash of `text` only, so a heading rename does not
 * invalidate every chunk below it. `jdf embed` and the bench both use this.
 */
export function embeddingInput(chunk: Pick<Chunk, "text" | "path">): string {
  const crumb = (chunk.path || []).filter((s) => s && s.trim().length > 0);
  return crumb.length ? `${crumb.join(" > ")}\n${chunk.text}` : chunk.text;
}

/** Stable per-element id: use author-provided `id`, else page+index coordinate. */
function elementId(el: any, pageIdx: number, elIdx: number): string {
  if (typeof el.id === "string" && el.id.length > 0) return el.id;
  return `p${pageIdx + 1}e${elIdx}`;
}

interface FlatEl { el: Element; page: number; id: string; }

function flatten(doc: JdfDocument): FlatEl[] {
  const out: FlatEl[] = [];
  (doc.pages || []).forEach((page, pi) => {
    (page.elements || []).forEach((el, ei) => {
      out.push({ el, page: pi + 1, id: elementId(el as any, pi, ei) });
    });
  });
  return out;
}

/** Build a chunk record from a run of flattened elements + the active heading path. */
function makeChunk(group: FlatEl[], breadcrumb: string[]): Chunk | null {
  const parts = group.map((g) => serializeElement(g.el)).filter((s) => s.length > 0);
  const text = parts.join("\n\n").trim();
  if (!text) return null;
  const types = Array.from(new Set(group.map((g) => (g.el as any).type)));
  return {
    id: group[0].id,
    text,
    path: [...breadcrumb],
    page: group[0].page,
    types,
    tokens: estimateTokens(text),
    hash: hashText(text),
  };
}

/**
 * Core chunker — pure, deterministic, no I/O. Exported so `jdf embed` reuses
 * the exact same chunk boundaries (and therefore hashes).
 */
export function chunkDocument(doc: JdfDocument, options: ChunkOptions = {}): Chunk[] {
  const strategy = options.strategy ?? "section";
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const windowSec = options.transcriptWindowSec ?? DEFAULT_TRANSCRIPT_WINDOW;
  const flat = flatten(doc);
  const chunks: Chunk[] = [];
  // Video transcripts ride along: whenever a group of elements is emitted, every
  // video in it with a transcript contributes time-windowed chunks right after,
  // under the same breadcrumb. Videos without a transcript stay "[video: title]".
  const withTranscripts = (group: FlatEl[], crumb: string[], c: Chunk | null) => {
    if (c) chunks.push(c);
    for (const f of group) {
      if ((f.el as any).type === "video") chunks.push(...transcriptChunks(f.el, f.id, f.page, crumb, windowSec, maxTokens));
    }
  };

  if (strategy === "element") {
    // One chunk per element, breadcrumb tracked from headings along the way.
    const crumb: string[] = [];
    for (const f of flat) {
      const lvl = headingLevel(f.el);
      if (lvl != null) {
        crumb.length = Math.max(0, lvl - 1);
        crumb[lvl - 1] = serializeElement(f.el);
      }
      withTranscripts([f], crumb, makeChunk([f], crumb));
    }
    return chunks;
  }

  if (strategy === "fixed") {
    // Accumulate elements until the token budget is hit, ignoring headings for
    // boundaries (but still tracking breadcrumb for metadata).
    const crumb: string[] = [];
    let buf: FlatEl[] = [];
    let bufTokens = 0;
    const flush = () => { withTranscripts(buf, crumb, makeChunk(buf, crumb)); buf = []; bufTokens = 0; };
    for (const f of flat) {
      const lvl = headingLevel(f.el);
      if (lvl != null) { crumb.length = Math.max(0, lvl - 1); crumb[lvl - 1] = serializeElement(f.el); }
      const t = estimateTokens(serializeElement(f.el));
      if (bufTokens + t > maxTokens && buf.length > 0) flush();
      buf.push(f);
      bufTokens += t;
    }
    flush();
    return chunks;
  }

  // strategy === "section" (default): each heading starts a new chunk holding
  // the heading + all following non-heading elements until the next heading.
  // The breadcrumb reflects the heading hierarchy via tocLevel.
  const crumb: string[] = [];
  let buf: FlatEl[] = [];
  const flushSection = () => {
    if (buf.length === 0) return;
    // Split oversized sections on element boundaries so no chunk blows the budget.
    let sub: FlatEl[] = [];
    let subTokens = 0;
    for (const f of buf) {
      const t = estimateTokens(serializeElement(f.el));
      if (subTokens + t > maxTokens && sub.length > 0) {
        withTranscripts(sub, crumb, makeChunk(sub, crumb));
        sub = []; subTokens = 0;
      }
      sub.push(f); subTokens += t;
    }
    withTranscripts(sub, crumb, makeChunk(sub, crumb));
    buf = [];
  };

  for (const f of flat) {
    const lvl = headingLevel(f.el);
    if (lvl != null) {
      // A section whose buffer holds nothing but headings (a title directly
      // followed by "1. Introduction", or an empty H2) carries no content of
      // its own — emitting it as a chunk creates a title-only fragment that
      // dense retrievers latch onto ("Acme — Q3 report" matches every Acme Q3
      // question) while answering none of them. Keep accumulating so the
      // headings become the opening lines of the next section instead.
      const onlyHeadings = buf.length > 0 && buf.every((b) => headingLevel(b.el) != null);
      if (!onlyHeadings) flushSection();
      crumb.length = Math.max(0, lvl - 1);
      crumb[lvl - 1] = serializeElement(f.el);
    }
    buf.push(f);
  }
  flushSection();
  return chunks;
}

async function loadJdf(filePath: string): Promise<JdfDocument> {
  if (filePath.toLowerCase().endsWith(".jdfx")) {
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const docFile = zip.file(JDFX_DOCUMENT_PATH);
    if (!docFile) throw new Error(`Bundle missing ${JDFX_DOCUMENT_PATH}`);
    return JSON.parse(await docFile.async("string"));
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * Media coverage: which images/videos carry text RAG can index. An image counts
 * as covered when it has a caption or OCR text (alt alone is usually a filename);
 * a video when it has a transcript. `jdf chunk` warns, `jdf rag` fills or fails.
 */
export interface MediaCoverage {
  images: { total: number; covered: number; missing: { id?: string; page: number; alt?: string }[] };
  videos: { total: number; covered: number; missing: { id?: string; page: number; title?: string }[] };
}
export function mediaCoverage(doc: JdfDocument): MediaCoverage {
  const cov: MediaCoverage = { images: { total: 0, covered: 0, missing: [] }, videos: { total: 0, covered: 0, missing: [] } };
  const walk = (els: any[] | undefined, page: number) => {
    for (const el of els ?? []) {
      if (el?.type === "image") {
        cov.images.total++;
        const has = !!(el.caption && String(el.caption).trim()) || !!(el.ocr?.blocks?.some((b: any) => String(b.text ?? "").trim()));
        if (has) cov.images.covered++; else cov.images.missing.push({ id: el.id, page, alt: el.alt });
      } else if (el?.type === "video") {
        cov.videos.total++;
        if (el.transcript?.segments?.length) cov.videos.covered++; else cov.videos.missing.push({ id: el.id, page, title: el.title });
      }
      if (el?.elements) walk(el.elements, page);
    }
  };
  doc.pages.forEach((p, i) => walk(p.elements as any[], i + 1));
  return cov;
}
export function coverageSummary(cov: MediaCoverage): string | null {
  const parts: string[] = [];
  if (cov.images.missing.length) parts.push(`${cov.images.missing.length} of ${cov.images.total} image(s) have no caption/OCR text → jdf describe`);
  if (cov.videos.missing.length) parts.push(`${cov.videos.missing.length} of ${cov.videos.total} video(s) have no transcript → jdf transcribe`);
  return parts.length ? parts.join("; ") : null;
}

export interface ChunkCliOptions extends ChunkOptions {
  format?: ChunkFormat;
  output?: string;
}

/**
 * CLI entry: read a .jdf/.jdfx, chunk it, write JSONL (default) / JSON / an
 * inline `index` block back into a .jdf. Returns the chunks for programmatic use.
 */
export async function chunkFile(inputPath: string, opts: ChunkCliOptions = {}): Promise<Chunk[]> {
  const input = path.resolve(inputPath);
  if (!fs.existsSync(input)) throw new Error(`File not found: ${input}`);
  const doc = await loadJdf(input);
  const strategy = opts.strategy ?? "section";
  const chunks = chunkDocument(doc, { strategy, maxTokens: opts.maxTokens, transcriptWindowSec: opts.transcriptWindowSec });
  const gap = coverageSummary(mediaCoverage(doc));
  if (gap) console.warn(`  ! media without text (skipped by retrieval): ${gap}`);

  const format = opts.format ?? "jsonl";
  console.log(`Chunking:  ${input}`);
  console.log(`Strategy:  ${strategy}${opts.maxTokens ? ` (max ${opts.maxTokens} tokens)` : ""}`);

  if (format === "inline") {
    // Write chunks into the document itself under a top-level `index` block.
    // Renderers ignore it (data-only); RAG pipelines read it instead of
    // recomputing. Only meaningful for .jdf (plain JSON) output.
    const out = opts.output ? path.resolve(opts.output) : input.replace(/\.(jdf|jdfx)$/i, ".jdf");
    const withIndex = { ...doc, index: { chunker: `jdf-${strategy}-v1`, chunks } };
    fs.writeFileSync(out, JSON.stringify(withIndex, null, 2));
    console.log(`Output:    ${out}  (${chunks.length} chunks in "index" block)`);
  } else if (format === "json") {
    const out = opts.output ? path.resolve(opts.output) : input.replace(/\.(jdf|jdfx)$/i, ".chunks.json");
    fs.writeFileSync(out, JSON.stringify(chunks, null, 2));
    console.log(`Output:    ${out}  (${chunks.length} chunks)`);
  } else {
    const out = opts.output ? path.resolve(opts.output) : input.replace(/\.(jdf|jdfx)$/i, ".chunks.jsonl");
    fs.writeFileSync(out, chunks.map((c) => JSON.stringify(c)).join("\n") + "\n");
    console.log(`Output:    ${out}  (${chunks.length} chunks)`);
  }

  const totalTokens = chunks.reduce((a, c) => a + c.tokens, 0);
  console.log(`\nDone! ${chunks.length} chunks, ~${totalTokens} tokens total.`);
  return chunks;
}
