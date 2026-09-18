/**
 * Paragraph folding for the PDF importer.
 *
 * A PDF stores lines, not paragraphs. Emitting one element per line is
 * faithful to the page but hostile to everything that reads the document as
 * text: a sentence split across two `jdf chunk` chunks cannot be retrieved,
 * search for a phrase that wraps at a line break finds nothing, and an LLM
 * sees "representa-" and "tion" as two facts. This pass folds consecutive
 * body lines that visibly belong to one paragraph into one `text` (or
 * `richtext`) element whose box covers the same area, so rendering stays put
 * and the text becomes whole.
 *
 * Two lines are folded when (pure geometry + light typography, no dictionary):
 *  - same face and size (within 0.5 pt), neither is a heading or a whole-line link;
 *  - the second sits one line below the first (0.9–1.75 × the font size);
 *  - left edges align (the first line of a paragraph may be indented ±6 mm);
 *  - the second line does not start a list item;
 *  - the first line looks unfinished: it fills the block width, ends with a
 *    hyphen, or has no terminal punctuation while the next line starts in
 *    lower case (or is at least 60% of the block width).
 * Hyphenated breaks keep their hyphen (lossless — "English-to-German" must not
 * become "Englishto-German"); whitespace-insensitive search still matches.
 *
 * Rendering fidelity: the PDF's line breaks are kept as "\n" inside the
 * paragraph (both renderers use white-space: pre-wrap) and `style.lineHeight`
 * is the measured pitch, so every line still lands where the PDF put it even
 * when the viewer's font is wider than the PDF's embedded face. The box gets
 * the same 20% slack a single line got.
 */
import type { Element } from "@jdf/core";

const PT_TO_MM = 0.352778;

/** Per-line facts the importer knows while emitting elements but the element does not carry. */
export interface LineMeta { w: number; size: number; face: string; }

interface Placed { type: string; position?: { x: number; y: number }; width?: number; height?: number; style?: any; content?: string; runs?: any[]; heading?: number; link?: unknown; }

const LIST_START = /^\s*(?:[•◦▪●■\-–—*]\s|\(?\d{1,3}[.)]\s|\(?[a-zA-Z][.)]\s|[ivx]{1,4}[.)]\s)/;
const TERMINAL = /[.!?:;]["'”’)\]]*$/;

function textOf(e: Placed): string {
  if (e.type === "text") return String(e.content ?? "");
  return (e.runs ?? []).map((r: any) => String(r.text ?? "")).join("");
}

export function foldParagraphs<T extends Placed>(elements: T[], meta: WeakMap<object, LineMeta>, pageWmm: number): T[] {
  // Whole-line links (a citation whose annotation covers the line's centre) fold too — the link moves onto that line's run.
  const foldable = (e: T) => !!meta.get(e) && !!e.position && ((e.type === "text" && !e.heading) || e.type === "richtext");
  const out: T[] = [];
  let i = 0;
  while (i < elements.length) {
    const first = elements[i];
    if (!foldable(first)) { out.push(first); i++; continue; }
    const para: T[] = [first];
    let j = i + 1;
    while (j < elements.length) {
      const prev = para[para.length - 1], next = elements[j];
      if (!foldable(next) || !continues(para, prev, next, meta)) break;
      para.push(next); j++;
    }
    out.push(para.length > 1 ? merge(para, meta, pageWmm) : first);
    i = j;
  }
  return out;
}

function continues<T extends Placed>(para: T[], prev: T, next: T, meta: WeakMap<object, LineMeta>): boolean {
  const mp = meta.get(prev)!, mn = meta.get(next)!, m0 = meta.get(para[0])!;
  if (mp.face !== mn.face || Math.abs(mp.size - mn.size) >= 0.5) return false;
  const lineH = mp.size * PT_TO_MM;
  const pitch = next.position!.y - prev.position!.y;
  if (pitch < lineH * 0.9 || pitch > lineH * 1.75) return false;
  const dx = next.position!.x - (para.length === 1 ? prev.position!.x : para[0].position!.x);
  if (para.length === 1 ? Math.abs(dx) > 6 : Math.abs(dx) > 1.2) return false;
  if (para.length >= 2 && Math.abs(next.position!.x - para[1].position!.x) > 1.2) return false;
  const nText = textOf(next), pText = textOf(prev).trimEnd();
  if (LIST_START.test(nText) || !nText.trim()) return false;
  const maxW = Math.max(mp.w, mn.w, ...para.map((e) => meta.get(e)!.w));
  const full = mp.w >= maxW * 0.85;
  const endsHyphen = /[-‐‑]$/.test(pText);
  const softEnd = !TERMINAL.test(pText);
  const startsLower = /^[a-z(\[]/.test(nText.trimStart());
  void m0;
  return full || endsHyphen || (softEnd && (startsLower || mp.w >= maxW * 0.6));
}

function merge<T extends Placed>(para: T[], meta: WeakMap<object, LineMeta>, pageWmm: number): T {
  const first = para[0], last = para[para.length - 1];
  const m0 = meta.get(first)!;
  const lineH = m0.size * PT_TO_MM;
  // The box starts at the paragraph's left edge; an indented first line becomes style.textIndent.
  const x = Math.min(...para.map((e) => e.position!.x));
  const indent = first.position!.x - x;
  const right = Math.max(...para.map((e) => e.position!.x + meta.get(e)!.w));
  const pitch = (last.position!.y - first.position!.y) / (para.length - 1);
  const width = Math.min(pageWmm - x, (right - x) * 1.2 + lineH * 0.4);
  // Line breaks stay where the PDF had them: "\n" between lines (pre-wrap in both renderers).
  const joiner = () => "\n";
  const style = { ...(first.style ?? {}), lineHeight: Math.round((pitch / lineH) * 100) / 100, ...(indent > 0.5 ? { textIndent: Math.round(indent * 100) / 100 } : {}) };
  const allText = para.every((e) => e.type === "text" && !e.link);
  const base: any = { position: { x, y: first.position!.y }, width: Math.round(width * 100) / 100, style };
  if (allText) {
    const content = para.map((e) => String(e.content ?? "").trim().replace(/[ \t]+/g, " ")).join(joiner());
    const { height: _hh, ...firstRest } = first as any;
    void _hh;
    return { ...firstRest, ...base, content } as T;
  }
  // Mixed rows: one richtext whose runs are the lines' runs in order, separated by a space run.
  const runs: any[] = [];
  for (const e of para) {
    const lineRuns: any[] = e.type === "text" ? [{ text: String(e.content ?? "").trim(), ...(e.style?.fontWeight === "bold" ? { bold: true } : {}), ...(e.style?.fontStyle === "italic" ? { italic: true } : {}), ...(e.style?.color && e.style.color !== "#000000" ? { color: e.style.color } : {}), ...(e.link ? { link: e.link } : {}) }] : (e.runs ?? []).map((r: any) => ({ ...r }));
    if (runs.length) runs[runs.length - 1].text = `${String(runs[runs.length - 1].text).trimEnd()}${joiner()}`;
    runs.push(...lineRuns);
  }
  const { content: _c, heading: _h, link: _l, height: _hh, ...rest } = first as any;
  void _c; void _h; void _l; void _hh;
  return { ...rest, ...base, type: "richtext", runs, style: { fontSize: style.fontSize, fontFamily: style.fontFamily, lineHeight: style.lineHeight, ...(style.textIndent ? { textIndent: style.textIndent } : {}), ...(style.opacity != null ? { opacity: style.opacity } : {}) } } as T;
}
