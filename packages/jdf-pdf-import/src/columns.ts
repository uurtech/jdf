/**
 * Multi-column reading order for the PDF importer.
 *
 * PDF.js hands us glyph runs sorted by y then x, so a two-column page comes
 * out interleaved: line 1 of the left column, line 1 of the right column,
 * line 2 of the left column … Rendering does not care (elements are
 * positioned absolutely) but everything that reads the document as a
 * sequence does: `jdf chunk`, search, the TOC, a screen reader, an LLM.
 *
 * Approach (pure geometry, per page):
 *  1. Take the body-size lines that are narrower than 60% of the page (a
 *     full-width title or abstract is not a column line) and build a
 *     horizontal coverage histogram.
 *  2. A run of (almost) uncovered bins at least 3 mm wide, away from both
 *     margins, with real text on both sides, is a gutter. k gutters → k+1
 *     column bands.
 *  3. Order the flow elements (text, richtext, table) by walking down the
 *     page: an element whose left edge sits in one band and whose right edge
 *     reaches past the middle of the next band spans the columns (title,
 *     abstract, wide figure caption, full-width table) and closes the current
 *     band of columns — everything above it is emitted column by column,
 *     then the spanning element, then the next band starts.
 *
 * Single-column pages produce no gutter and are left untouched, so the
 * bench corpus, forms and résumés keep their exact previous order.
 */

export interface ColLine { text: string; x: number; y: number; width: number; fontSize: number; }
export interface Gutter { x0: number; x1: number; }
interface Placed { position?: { x: number; y: number }; width?: number; }

/** Vertical whitespace gutters between text columns, in page mm. Empty when the page is single-column. */
export function detectGutters(lines: ColLine[], bodyFontSize: number, pageWmm: number): Gutter[] {
  const body = lines.filter((l) => l.text.trim().length > 0 && Math.abs(l.fontSize - bodyFontSize) <= 1.5 && l.width < pageWmm * 0.6 && l.width > 0);
  if (body.length < 12) return [];
  const minX = Math.min(...body.map((l) => l.x));
  const maxX = Math.max(...body.map((l) => l.x + l.width));
  const span = maxX - minX;
  if (span < pageWmm * 0.4) return [];
  const BIN = 0.5;
  const n = Math.ceil(span / BIN) + 1;
  const cov = new Array<number>(n).fill(0);
  for (const l of body) {
    const a = Math.max(0, Math.floor((l.x - minX) / BIN)), b = Math.min(n, Math.ceil((l.x + l.width - minX) / BIN));
    for (let i = a; i < b; i++) cov[i]++;
  }
  // A few lines crossing the gutter must not hide it: a centred author line or
  // affiliation in a paper's header, a wide formula, a mis-measured run.
  const noise = Math.max(2, Math.round(body.length * 0.05));
  const gutters: Gutter[] = [];
  let i = 0;
  while (i < n) {
    if (cov[i] > noise) { i++; continue; }
    let j = i;
    while (j < n && cov[j] <= noise) j++;
    const g0 = minX + i * BIN, g1 = minX + j * BIN;
    if (g1 - g0 >= 3 && g0 > minX + span * 0.15 && g1 < maxX - span * 0.15) gutters.push({ x0: g0, x1: g1 });
    i = j;
  }
  // Every side of every gutter must carry real text, or it is just a ragged right edge.
  const solid = gutters.every((g) => body.filter((l) => l.x + l.width <= g.x0 + 0.5).length >= 4 && body.filter((l) => l.x >= g.x1 - 0.5).length >= 4);
  return solid ? gutters : [];
}

/** Reorder flow elements into reading order given the page's gutters. Stable for single-column pages. */
export function orderByColumns<T extends Placed>(els: T[], gutters: Gutter[], pageWmm: number): T[] {
  if (!gutters.length || els.length < 2) return els;
  const bands: Gutter[] = [];
  let left = 0;
  for (const g of gutters) { bands.push({ x0: left, x1: g.x0 }); left = g.x1; }
  bands.push({ x0: left, x1: pageWmm });
  const colOf = (e: T) => {
    const x = e.position?.x ?? 0;
    const k = bands.findIndex((b) => x >= b.x0 && x < b.x1);
    if (k >= 0) return k;
    // Left edge inside a gutter (centred text): nearest band.
    let best = 0, d = Infinity;
    bands.forEach((b, i) => { const dd = Math.min(Math.abs(x - b.x0), Math.abs(x - b.x1)); if (dd < d) { d = dd; best = i; } });
    return best;
  };
  const spans = (e: T) => {
    const c = colOf(e);
    if (c >= bands.length - 1) return false;
    const right = (e.position?.x ?? 0) + (e.width ?? 0);
    const next = bands[c + 1];
    return right > (next.x0 + next.x1) / 2;
  };
  const sorted = els.slice().sort((a, b) => ((a.position?.y ?? 0) - (b.position?.y ?? 0)) || ((a.position?.x ?? 0) - (b.position?.x ?? 0)));
  const out: T[] = [];
  let band: T[] = [];
  const flush = () => {
    for (let c = 0; c < bands.length; c++) for (const e of band) if (colOf(e) === c) out.push(e);
    band = [];
  };
  for (const e of sorted) {
    if (spans(e)) { flush(); out.push(e); }
    else band.push(e);
  }
  flush();
  return out;
}
