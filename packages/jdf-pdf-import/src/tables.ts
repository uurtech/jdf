/**
 * Table detection for the PDF importer.
 *
 * A PDF has no notion of a table — just glyph runs positioned on a page and,
 * usually, some rectangles/lines drawn around them. This module rebuilds the
 * grid from geometry so the importer can emit a real JDF `table` element
 * (headers + rows + column widths) instead of dozens of loose text runs. That
 * is the single biggest "structure" win for RAG: `jdf chunk` serialises a
 * table row as `Header: value | Header: value`, so a number never loses its
 * column meaning.
 *
 * Approach (runtime-agnostic, pure geometry, no ML):
 *  1. Group merged text lines into rows by baseline (y).
 *  2. Grow blocks of consecutive rows whose cells fall into a consistent set of
 *     column bands (cells cluster by x-interval overlap; no two cells of a row
 *     share a band).
 *  3. Accept a block as a table when it has >= 2 columns and >= 3 rows (or >= 2
 *     rows when drawn cell borders/backgrounds confirm the grid), with regular
 *     row spacing.
 *  4. Use drawn rectangles for hints: a filled band over the first row => header
 *     with that background; alternating fills => alternatingRowColor; thin
 *     rects/lines inside the block => borders. Those shapes are consumed so the
 *     renderer does not draw them twice.
 *
 * Deliberately conservative: a paragraph never has >= 3 consecutive lines that
 * split into the same >= 2 x-bands, so prose stays prose. Multi-line cells that
 * wrap onto a continuation line (single cell, not in the first column) are
 * folded back into the previous row.
 */
import type { TableElement, TableColumn, TableCellValue, TextAlign } from "@jdf/core";

export interface TRun {
  text: string;
  x: number;       // mm, left
  y: number;       // mm, top
  width: number;   // mm (may be over-reported by PDF.js for runs ending in a stretched space)
  height: number;  // mm
  fontSize: number; // pt
  fontName: string;
  color: string;
  bold?: boolean;
  italic?: boolean;
  /** CSS family stack the importer chose for this run's font. */
  family?: string;
}

export interface TShape {
  kind: "rect" | "line" | "path";
  x: number; y: number; width: number; height: number; // mm
  fill?: string;
  stroke?: string;
}

export interface DetectedTable {
  element: TableElement;
  lineIdx: number[];   // indices into the input runs that became cells
  shapeIdx: number[];  // indices into the input shapes consumed as borders/backgrounds
}

const PT_TO_MM = 0.352778;

interface CellPart { text: string; x0: number; x1: number; idx: number[] }
interface Cell { run: TRun; idx: number; x0: number; x1: number; parts?: CellPart[] }
interface Row { y: number; h: number; cells: Cell[]; }

/** Average glyph advance (in em) measured on this page from runs whose width
 *  PDF.js reports exactly (no trailing space). Falls back to 0.55em. */
export function calibrateGlyphWidth(runs: Pick<TRun, "text" | "width" | "fontSize">[]): number {
  const ks: number[] = [];
  for (const r of runs) {
    const t = r.text;
    if (/\s$/.test(t) || t.trim().length < 3 || r.width <= 0) continue;
    ks.push(r.width / (t.length * r.fontSize * PT_TO_MM));
  }
  if (ks.length < 3) return 0.55;
  ks.sort((a, b) => a - b);
  return Math.min(0.7, Math.max(0.4, ks[Math.floor(ks.length / 2)]));
}

/** Does this page stretch trailing spaces (browser-printed tables position the
 *  next cell with a stretched space, so PDF.js reports a width reaching the next
 *  column)? True when a good share of trailing-space runs are implausibly wide. */
export function hasStretchedSpaces(runs: Pick<TRun, "text" | "width" | "fontSize">[], k: number): boolean {
  let n = 0, wide = 0;
  for (const r of runs) {
    if (!/\s$/.test(r.text) || r.text.trim().length === 0) continue;
    const em = r.fontSize * PT_TO_MM;
    const est = r.text.trim().length * em * k + em * 0.25;
    n++; if (r.width > est * 1.4) wide++;
  }
  return n >= 4 && wide / n >= 0.3;
}

/** Text extent. On pages with stretched trailing spaces the reported width is
 *  capped at a per-page glyph estimate; elsewhere PDF.js widths are trusted
 *  unless implausibly wide. */
function textExtent(r: TRun, k: number, stretched: boolean): number {
  const em = r.fontSize * PT_TO_MM;
  if (!/\s$/.test(r.text)) return Math.max(em * 0.5, r.width);
  const chars = Math.max(1, r.text.trim().length);
  const est = chars * em * k + em * 0.25;
  if (stretched) return Math.max(em * 0.5, Math.min(r.width, est));
  return Math.max(em * 0.5, r.width > est * 1.4 ? est : r.width);
}

/** A cell value that means "number" for column alignment and header
 *  detection: 13,756 · (8,953) · $ 2,701 · 58% · 0.43 · — (dash placeholder). */
const numeric = (s: string) => {
  const t = s.trim();
  if (!t) return false;
  if (/^[—–\-]+$/.test(t)) return true;
  const core = t.replace(/[\s$€£¥(),%]/g, "").replace(/^[+\-−–]/, "");
  return /^\d+(\.\d+)?(ms|s|k|m|b|M|K|B|x|×)?$/.test(core);
};
const isCurrencySymbol = (s: string) => /^[$€£¥]$/.test(s.trim());

function groupRows(runs: TRun[], skip: (r: TRun) => boolean): Row[] {
  const k = calibrateGlyphWidth(runs);
  const stretched = hasStretchedSpaces(runs, k);
  const idx = runs.map((_, i) => i).filter((i) => !skip(runs[i]) && runs[i].text.trim().length > 0);
  idx.sort((a, b) => runs[a].y - runs[b].y || runs[a].x - runs[b].x);
  const rows: Row[] = [];
  for (const i of idx) {
    const r = runs[i];
    const tol = Math.max(0.8, r.fontSize * PT_TO_MM * 0.35);
    const last = rows[rows.length - 1];
    const cell: Cell = { run: r, idx: i, x0: r.x, x1: r.x + textExtent(r, k, stretched) };
    if (last && Math.abs(last.y - r.y) <= tol) {
      last.cells.push(cell);
      last.h = Math.max(last.h, r.height);
    } else {
      rows.push({ y: r.y, h: r.height, cells: [cell] });
    }
  }
  for (const row of rows) {
    row.cells.sort((a, b) => a.x0 - b.x0);
    // Re-join runs the importer kept apart inside one cell ("HR " + "& benefits":
    // a glyph from another font subset, a colour change, a kerning gap); cells
    // of a table are further apart than one em. Two adjacent numbers ("11,182
    // $(133,709)") are two columns even when typeset a third of an em apart,
    // so numeric neighbours only merge when they nearly touch. A lone currency sign belongs to the number on its
    // right ("$      2,701" in a 10-K is one cell), however wide the gap.
    const merged: Cell[] = [];
    let pendingSym: Cell | null = null;
    const pushCell = (c: Cell) => {
      const last = merged[merged.length - 1];
      const em = c.run.fontSize * PT_TO_MM;
      const limit = last && numeric(last.run.text) && numeric(c.run.text) ? em * 0.35 : em * 1.0;
      if (last && c.x0 - last.x1 <= limit) {
        last.parts = [...(last.parts ?? [{ text: last.run.text, x0: last.x0, x1: last.x1, idx: [last.idx, ...(((last as any).extra ?? []) as number[])] }]),
          { text: c.run.text, x0: c.x0, x1: c.x1, idx: [c.idx, ...(((c as any).extra ?? []) as number[])] }];
        last.x1 = Math.max(last.x1, c.x1);
        last.run = { ...last.run, text: `${last.run.text.replace(/\s+$/, "")} ${c.run.text.replace(/^\s+/, "")}`, width: last.x1 - last.x0 };
        (last as any).extra = [...((last as any).extra ?? []), c.idx, ...(((c as any).extra ?? []) as number[])];
      } else merged.push({ ...c });
    };
    for (const c of row.cells) {
      if (isCurrencySymbol(c.run.text)) { if (pendingSym) merged.push(pendingSym); pendingSym = { ...c }; continue; }
      if (pendingSym) {
        const em = c.run.fontSize * PT_TO_MM;
        if (numeric(c.run.text) && c.x0 - pendingSym.x1 <= em * 8) {
          const cell: Cell = { ...c, run: { ...c.run, text: `${pendingSym.run.text.trim()} ${c.run.text.trim()}` } };
          (cell as any).extra = [...(((c as any).extra ?? []) as number[]), pendingSym.idx, ...(((pendingSym as any).extra ?? []) as number[])];
          pendingSym = null;
          pushCell(cell);
          continue;
        }
        merged.push(pendingSym); pendingSym = null;
      }
      pushCell(c);
    }
    if (pendingSym) merged.push(pendingSym);
    row.cells = merged;
  }
  return rows;
}

interface BandInfo { x0: number; x1: number }
interface BandResult { bands: BandInfo[]; assign: Map<Cell, number> }

const overlaps = (c: { x0: number; x1: number }, b: BandInfo) => c.x0 < b.x1 - 0.2 && c.x1 > b.x0 + 0.2;

/** Overlap-cluster cells into x-bands (sorted left → right). */
function clusterCells(cells: { c: Cell; r: Row }[]): { x0: number; x1: number; members: { c: Cell; r: Row }[] }[] {
  const sorted = cells.slice().sort((a, b) => a.c.x0 - b.c.x0);
  const bands: { x0: number; x1: number; members: { c: Cell; r: Row }[] }[] = [];
  for (const m of sorted) {
    const last = bands[bands.length - 1];
    // Overlap test with a small tolerance so kerning drift doesn't split a column.
    if (last && m.c.x0 <= last.x1 - 0.2) { last.x1 = Math.max(last.x1, m.c.x1); last.members.push(m); }
    else bands.push({ x0: m.c.x0, x1: m.c.x1, members: [m] });
  }
  return bands;
}
/** Two cells of one row in one band → not a grid. */
function hasConflict(bands: { members: { c: Cell; r: Row }[] }[]): boolean {
  for (const b of bands) {
    const seen = new Set<Row>();
    for (const m of b.members) { if (seen.has(m.r)) return true; seen.add(m.r); }
  }
  return false;
}

/**
 * Cluster the cells of several rows into column bands. Returns null when the
 * rows cannot form a grid (two cells of one row land in one band).
 *
 * Financial statements break naive x-overlap clustering in three ways, all
 * handled here:
 *  - Long row labels ("Total net interest income and income from Islamic
 *    financing…") run under the next column's numbers. A row's first cell
 *    that starts left of every other cell is a *label* and always belongs to
 *    column 0, whatever its extent.
 *  - Group headers ("Common Stock" over "Shares | Amount", "Stage 1" over
 *    "Exposure | Provision") span bands. Bands are built from the rows with
 *    the most cells (the finest structure) and every other cell joins the
 *    band it overlaps most.
 *  - Column headers are centred while the numbers below are right-aligned,
 *    so "2025" and "2,701" may not overlap at all. Adjacent bands that never
 *    share a row and sit within 1.5 em are one column.
 */
function columnBands(rows: Row[]): BandResult | null {
  const all = rows.flatMap((r) => r.cells.map((c) => ({ c, r })));
  if (!all.length) return null;
  const firstOf = new Set(rows.map((r) => r.cells[0]));
  const others = all.filter((m) => !firstOf.has(m.c));
  const othersMin = others.length ? Math.min(...others.map((m) => m.c.x0)) : Infinity;
  // A numeric first cell ("2023" continuing "Balances, December 31,") is a
  // label only when it lines up with the textual labels; "2025" heading a
  // column of numbers is not.
  // "Clearly left" = more than 1.5 em: the leftmost header of a numeric
  // column starts a little left of the right-aligned numbers under it.
  const leftOf = (m: { c: Cell }) => m.c.x0 < othersMin - Math.max(1, m.c.run.fontSize * PT_TO_MM * 1.5);
  const textLabels = all.filter((m) => firstOf.has(m.c) && leftOf(m) && !numeric(m.c.run.text));
  const labelX = textLabels.length ? Math.min(...textLabels.map((m) => m.c.x0)) : Infinity;
  const isLabel = (m: { c: Cell }) => firstOf.has(m.c) && leftOf(m) && (!numeric(m.c.run.text) || m.c.x0 <= labelX + m.c.run.fontSize * PT_TO_MM * 3);
  const body = all.filter((m) => !isLabel(m));
  const labels = all.filter(isLabel);
  if (!body.length) return null;
  const assign = new Map<Cell, number>();

  const countOf = new Map<Row, number>();
  for (const m of body) countOf.set(m.r, (countOf.get(m.r) ?? 0) + 1);
  const maxCount = Math.max(...countOf.values());
  let anchorRows = new Set(rows.filter((r) => countOf.get(r) === maxCount));
  let bands = clusterCells(body.filter((m) => anchorRows.has(m.r)));
  if (hasConflict(bands)) {
    // Even the finest rows disagree (one of them carries a spanning cell):
    // let the first of them alone define the grid. The other anchor rows
    // then go through the placement loop below like every other row — left
    // in `anchorRows` their cells were never assigned and their text was
    // silently dropped from the table.
    const first = rows.find((r) => anchorRows.has(r))!;
    bands = clusterCells(body.filter((m) => m.r === first));
    if (hasConflict(bands)) return null;
    anchorRows = new Set([first]);
  }
  for (const m of body) {
    if (anchorRows.has(m.r)) continue;
    // Best overlapping band that has no cell of this row yet; a cell that
    // overlaps only occupied bands (or none) opens a sparse column of its own.
    let bi = -1, bestOv = 0;
    bands.forEach((b, k) => {
      if (b.members.some((o) => o.r === m.r)) return;
      const ov = Math.min(m.c.x1, b.x1) - Math.max(m.c.x0, b.x0);
      if (ov > bestOv) { bestOv = ov; bi = k; }
    });
    if (bi < 0) {
      // No free band: a new column is fine in the gaps between columns, but a
      // cell sitting on top of an occupied band ("to" under a long line of
      // cover-page text) means these rows are not a grid.
      const w = m.c.x1 - m.c.x0;
      if (bands.some((b) => Math.min(m.c.x1, b.x1) - Math.max(m.c.x0, b.x0) > w * 0.5)) return null;
      bands.push({ x0: m.c.x0, x1: m.c.x1, members: [m] });
      continue;
    }
    bands[bi].members.push(m);
    // A cell inside one band may widen it; a spanning header ("Accumulated
    // Comprehensive Stockholders'" over three columns) must not, or the band
    // would swallow its neighbours.
    const touched = bands.filter((b) => overlaps(m.c, b)).length;
    if (touched <= 1) { bands[bi].x0 = Math.min(bands[bi].x0, m.c.x0); bands[bi].x1 = Math.max(bands[bi].x1, m.c.x1); }
  }
  bands.sort((a, b) => a.x0 - b.x0);
  // Coalesce a centred header with the right-aligned numbers under it.
  for (let k = 0; k + 1 < bands.length;) {
    const a = bands[k], b = bands[k + 1];
    const shareRow = a.members.some((m) => b.members.some((o) => o.r === m.r));
    const em = Math.min(...[...a.members, ...b.members].map((m) => m.c.run.fontSize)) * PT_TO_MM;
    // Two real columns share rows (a row has a value in both); bands that
    // never do and sit this close are one column (a centred header over
    // right-aligned numbers, a dash under a wider number).
    if (!shareRow && b.x0 - a.x1 <= em * 1.5) {
      bands.splice(k, 2, { x0: a.x0, x1: Math.max(a.x1, b.x1), members: [...a.members, ...b.members] });
    } else k++;
  }
  const out: BandInfo[] = [];
  if (labels.length) {
    const lx0 = Math.min(...labels.map((m) => m.c.x0));
    const lx1 = Math.min(Math.max(...labels.map((m) => m.c.x1)), bands[0].x0 - 0.2);
    out.push({ x0: lx0, x1: Math.max(lx1, lx0 + 1) });
    for (const m of labels) assign.set(m.c, 0);
  }
  const off = out.length;
  bands.forEach((b, k) => { out.push({ x0: b.x0, x1: b.x1 }); for (const m of b.members) assign.set(m.c, k + off); });
  return { bands: out, assign };
}

/** Column gutters of a multi-column page (see columns.ts); a candidate whose
 *  bands sit on both sides of a gutter with prose-wide cells is column text. */
export interface GutterHint { x0: number; x1: number; }

const dbg = (...a: unknown[]) => { if (typeof process !== "undefined" && process.env?.JDF_TABLE_DEBUG) console.error("[tables]", ...a); };

export function detectTables(runs: TRun[], shapes: TShape[], pageWidthMm: number, gutters: GutterHint[] = []): DetectedTable[] {
  const out: DetectedTable[] = [];
  const used = new Set<number>();
  const rows = groupRows(runs, () => false);
  const pageW = pageWidthMm;
  const emOf = (c: Cell) => c.run.fontSize * PT_TO_MM;

  let i = 0;
  while (i < rows.length) {
    if (rows[i].cells.length < 2) { i++; continue; }
    dbg(`block from "${rows[i].cells.map((c) => c.run.text.slice(0, 14)).join(" | ")}"`);
    // Grow the block while the column structure stays consistent.
    let j = i;
    let cur = columnBands([rows[i]]);
    let best: { j: number; res: BandResult } | null = null;
    let loneStreak = 0;
    while (j + 1 < rows.length && cur) {
      const next = rows[j + 1];
      const gap = next.y - (rows[j].y + rows[j].h);
      const rowH = Math.max(rows[j].h, next.h);
      // An established block (3+ rows) may span a blank separator line
      // (financial statements group rows with white space); a young one may not.
      const established = !!best && best.j - i >= 2;
      if (gap > rowH * (established ? 3.4 : 2.2)) { dbg(`break: gap ${gap.toFixed(1)} after "${rows[j].cells[0].run.text.slice(0, 30)}"`); break; }
      const bands = cur.bands;
      if (next.cells.length === 1) {
        const c = next.cells[0];
        const inBands = bands.filter((b) => overlaps(c, b));
        const inBand = inBands.length ? bands.indexOf(inBands[0]) : -1;
        const spansSeveral = inBands.length > 1;
        if (inBand > 0 && !spansSeveral) { j++; continue; } // continuation line of a wrapped cell
        // A lone line starting in the label column that stops short of the
        // last column: a wrapped label (10-K labels wrap onto up to four lines
        // before the values) or a section label ("Net profit attributable
        // to:"). Kept as a spanning label row; trailing ones are trimmed
        // because `best` only advances on multi-cell rows.
        const isLabel = c.x1 <= bands[bands.length - 1].x0 - 0.5 && (c.x0 <= bands[0].x0 + emOf(c) * 3 || c.x1 < bands[0].x0 - 0.5);
        if (isLabel && loneStreak < 4) { loneStreak++; j++; continue; }
        dbg(`break: lone line "${c.run.text.slice(0, 40)}" inBand=${inBand} spans=${spansSeveral} label=${isLabel} streak=${loneStreak}`);
        break;
      }
      loneStreak = 0;
      const nb = columnBands(rows.slice(i, j + 2));
      if (!nb || nb.bands.length < 2) { dbg(`break: no bands at "${next.cells.map((c) => c.run.text.slice(0, 15)).join(" | ")}"`); break; }
      if (nb.bands.length > bands.length && j - i >= 2) {
        // A row may add a column late only when the new column is narrow
        // (a sparse "Note" column first used far down the statement); a wide
        // new band means the structure changed → the table ends here.
        const fresh = nb.bands.filter((b) => !bands.some((o) => overlaps(b, o)) && b.x0 > bands[0].x0);
        if (fresh.some((b) => b.x1 - b.x0 > 20)) { dbg(`break: wide fresh band at "${next.cells.map((c) => c.run.text.slice(0, 15)).join(" | ")}"`); break; }
      }
      cur = nb; j++;
      if (cur.bands.length >= 2) best = { j, res: cur };
    }
    const blockRows = best ? rows.slice(i, best.j + 1) : [];
    const multiRows = blockRows.filter((r) => r.cells.length >= 2).length;
    // Lattice evidence: drawn rects/lines within the block's bbox.
    const bbox = blockRows.length ? {
      x0: Math.min(...best!.res.bands.map((b) => b.x0)) - 5, x1: Math.max(...best!.res.bands.map((b) => b.x1)) + 5,
      // Cell padding puts backgrounds/borders well above the first baseline and below the last.
      y0: blockRows[0].y - blockRows[0].h * 2.5, y1: blockRows[blockRows.length - 1].y + blockRows[blockRows.length - 1].h * 3,
    } : null;
    // Fills must sit inside the block; a horizontal rule may run past the
    // text (an empty last column still has its borders drawn) as long as
    // most of it overlaps the block.
    const thinH = (s: TShape) => (s.kind === "line" || s.kind === "rect") && s.height < 0.6 && s.width >= s.height && !!(s.fill || s.stroke);
    const gridShapes = bbox ? shapes.map((s, k) => ({ s, k })).filter(({ s }) =>
      s.y >= bbox.y0 - 1 && s.y + s.height <= bbox.y1 + 1 && (s.kind === "line" || s.kind === "rect") &&
      (thinH(s)
        ? Math.min(s.x + s.width, bbox.x1) - Math.max(s.x, bbox.x0) >= s.width * 0.5
        : s.x >= bbox.x0 - 1 && s.x + s.width <= bbox.x1 + 1)) : [];
    const tableW = bbox ? bbox.x1 - bbox.x0 : 0;
    const isRule = (s: TShape) => s.kind === "line" || (s.kind === "rect" && (s.height < 0.6 || s.width < 0.6) && !!(s.fill || s.stroke));
    // Horizontal rules spanning the block (cell borders) tell wrapped rows apart
    // from new rows far more reliably than baseline pitch.
    const ruleYs = gridShapes
      .filter(({ s }) => isRule(s) && s.width >= s.height && s.width >= tableW * 0.45)
      .map(({ s }) => s.y + s.height / 2).sort((a, b) => a - b);
    const verticalRules = blockRows.length ? gridShapes.filter(({ s }) => isRule(s) && s.height > s.width && s.height >= blockRows[0].h * 1.5).length : 0;
    // Background fill of a row = the non-white filled rects that cover the
    // row's vertical centre (one wide rect, or one per cell as browsers print).
    const rowFill = (row: Row): { fill: string; rects: { s: TShape; k: number }[] } | null => {
      const cy = row.y + row.h * 0.5;
      const rects = gridShapes.filter(({ s }) => s.kind === "rect" && s.fill && s.fill.toLowerCase() !== "#ffffff" && s.height >= row.h * 0.6 && s.height < row.h * 4.5 && s.y <= cy && s.y + s.height >= cy);
      const covered = rects.reduce((a, { s }) => a + s.width, 0);
      if (!rects.length || covered < tableW * 0.5) return null;
      const counts = new Map<string, number>();
      for (const { s } of rects) counts.set(s.fill!, (counts.get(s.fill!) ?? 0) + s.width);
      const fill = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { fill, rects };
    };
    const filledRows = blockRows.filter((r) => rowFill(r)).length;
    // Lattice = drawn table structure: vertical rules, several rules spanning
    // the block, or filled rows. Any three shapes nearby (a cover page's
    // section rules, a chart) are not.
    const hasLattice = verticalRules >= 2 || ruleYs.length >= 3 || filledRows >= 2;

    if (!best || multiRows < (hasLattice ? 2 : 3) || best.res.bands.length < 2) { if (best) dbg(`reject: ${multiRows} multi rows from "${rows[i].cells[0].run.text.slice(0, 30)}"`); i++; continue; }
    // Two columns of justified prose form perfectly consistent x-bands. If a
    // gutter runs between two adjacent bands and both bands are wide enough to
    // hold a sentence (> 30 mm), this is column text, not a table. Genuine
    // full-width tables have narrow cells on at least one side.
    if (gutters.length && !hasLattice) {
      const b = best.res.bands;
      // Any sentence-wide band on each side of a gutter (not only the two
      // adjacent ones: a stray word that landed in the gutter must not hide it).
      const straddles = gutters.some((g) => b.some((band) => band.x1 <= g.x1 + 1 && band.x1 - band.x0 > 30) && b.some((band) => band.x0 >= g.x0 - 1 && band.x1 - band.x0 > 30));
      if (straddles) { dbg("reject: straddles a column gutter"); i++; continue; }
    }

    // ── build the element ──────────────────────────────────────────────────
    const { bands, assign } = best.res;
    const ruleBetween = (a: Row, b: Row) => { const y0 = a.y + a.h * 0.5, y1 = b.y + b.h * 0.5; return ruleYs.some((y) => y > y0 && y < y1); };
    // Only a per-row lattice can tell wrapped rows apart; a statement's few
    // total underlines cannot.
    const denseRules = ruleYs.length >= Math.max(2, multiRows * 0.6);

    // "Item 1A." + "Risk Factors" merged into one cell because the gap was
    // under an em, while the rows around them keep the title in the next
    // column: give the tail back to the empty neighbouring band.
    for (const row of blockRows) {
      for (const c of row.cells.slice()) {
        const b = assign.get(c);
        if (b == null || b + 1 >= bands.length) continue;
        if (row.cells.some((o) => o !== c && assign.get(o) === b + 1)) continue;
        const nextX0 = bands[b + 1].x0;
        let cut: number;
        if (!c.parts) {
          // Merged before it reached us (one PDF.js item, or a sub-half-em gap):
          // cut at the space nearest to where the next column starts.
          const w = c.x1 - c.x0;
          if (c.x1 <= nextX0 + w * 0.3 || !/\s/.test(c.run.text.trim())) continue;
          const text = c.run.text.trim();
          const at = Math.round(((nextX0 - c.x0) / w) * text.length);
          let best = -1;
          for (let q = 0; q < text.length; q++) if (text[q] === " " && (best < 0 || Math.abs(q - at) < Math.abs(best - at))) best = q;
          if (best <= 0 || best >= text.length - 1 || Math.abs(best - at) > text.length * 0.25) continue;
          const perChar = w / text.length;
          c.parts = [
            { text: text.slice(0, best), x0: c.x0, x1: c.x0 + best * perChar, idx: [c.idx, ...(((c as any).extra ?? []) as number[])] },
            { text: text.slice(best + 1), x0: c.x0 + (best + 1) * perChar, x1: c.x1, idx: [c.idx] },
          ];
          cut = 1; // the estimate was made at the band edge by construction
        } else {
          cut = c.parts.findIndex((p) => p.x0 >= nextX0 - 0.5);
        }
        if (cut <= 0) continue;
        const head = c.parts.slice(0, cut), tail = c.parts.slice(cut);
        const tailCell: Cell = { run: { ...c.run, text: tail.map((p) => p.text.trim()).join(" ") }, idx: tail[0].idx[0], x0: tail[0].x0, x1: tail[tail.length - 1].x1, parts: tail };
        (tailCell as any).extra = tail.flatMap((p) => p.idx).filter((k) => k !== tailCell.idx);
        c.run = { ...c.run, text: head.map((p) => p.text.trim()).join(" ") };
        c.x1 = head[head.length - 1].x1; c.idx = head[0].idx[0]; (c as any).extra = head.flatMap((p) => p.idx).filter((k) => k !== c.idx); c.parts = head.length > 1 ? head : undefined;
        row.cells.push(tailCell); assign.set(tailCell, b + 1);
      }
      row.cells.sort((a, b2) => a.x0 - b2.x0);
    }
    // Dot leaders ("Business . . . . . . 4") carry no text.
    const clean = (t: string) => t.replace(/(?:\s*\.){3,}\s*$/, "").replace(/\s+/g, " ").trim();
    const cellText = (row: Row, b: number) => clean(row.cells
      .filter((c) => assign.get(c) === b)
      .map((c) => c.run.text.trim()).join(" "));
    const cellIdx = (c: Cell) => [c.idx, ...(((c as any).extra ?? []) as number[])];
    const grid: string[][] = [];
    const gridRows: Row[] = [];   // source row of each grid row (first line)
    const lineIdx: number[] = [];
    const pitches: number[] = [];
    for (let r = 1; r < blockRows.length; r++) pitches.push(blockRows[r].y - blockRows[r - 1].y);
    const medPitch = pitches.length ? pitches.slice().sort((a, b) => a - b)[Math.floor(pitches.length / 2)] : blockRows[0].h * 1.3;
    let pendingLabel: { text: string; idx: number[]; row: Row } | null = null;
    // First line(s) of a wrapped cell in column b > 0 whose row label sits on
    // a later baseline ("6" centred beside two description lines): held until
    // the row with the label arrives.
    const pendingCells = new Map<number, { text: string; idx: number[]; row: Row }>();
    const flushPendingCells = () => {
      if (!pendingCells.size) return;
      const cells = bands.map(() => "");
      let row: Row | null = null;
      for (const [b, pc] of pendingCells) { cells[b] = pc.text; lineIdx.push(...pc.idx); row = row ?? pc.row; }
      grid.push(cells); gridRows.push(row!); pendingCells.clear();
    };
    const flushPending = () => {
      if (!pendingLabel) return;
      const cells = bands.map(() => ""); cells[0] = pendingLabel.text;
      for (const [b, pc] of pendingCells) { cells[b] = pc.text; lineIdx.push(...pc.idx); }
      pendingCells.clear();
      grid.push(cells); gridRows.push(pendingLabel.row); lineIdx.push(...pendingLabel.idx); pendingLabel = null;
    };
    for (let r = 0; r < blockRows.length; r++) {
      const row = blockRows[r];
      if (row.cells.length === 1 && grid.length + (pendingLabel ? 1 : 0) > 0) {
        const c = row.cells[0];
        const b = assign.get(c) ?? bands.findIndex((bb) => overlaps(c, bb));
        if (b > 0) {
          const prevRow = gridRows[gridRows.length - 1];
          if (denseRules && prevRow && ruleBetween(prevRow, row) && !pendingLabel) {
            // A rule separates it from the previous row: it is the head of the
            // next row's cell, not a continuation.
            const pc = pendingCells.get(b);
            if (pc) { pc.text = `${pc.text} ${c.run.text.trim()}`.trim(); pc.idx.push(...cellIdx(c)); }
            else pendingCells.set(b, { text: c.run.text.trim(), idx: cellIdx(c), row });
            continue;
          }
          // Continuation of a wrapped cell → append to the same column of the previous row.
          flushPending();
          grid[grid.length - 1][b] = (grid[grid.length - 1][b] + " " + c.run.text.trim()).trim();
          lineIdx.push(...cellIdx(c));
          continue;
        }
        // Lone label line: the tail of the previous row's label (no rule between
        // them / starts lowercase or "("), the head of the next row's label
        // (next label starts lowercase), or a section label of its own.
        const text = clean(c.run.text);
        const prev = gridRows[gridRows.length - 1];
        const nextRow = blockRows[r + 1];
        const nextLabel = nextRow && nextRow.cells.length >= 2 ? cellText(nextRow, 0) : "";
        const lower = /^[(\[a-zà-ÿ]/.test(text);
        const attachPrev = !pendingLabel && prev && grid.length && (denseRules ? !ruleBetween(prev, row) : lower);
        if (attachPrev) { grid[grid.length - 1][0] = (grid[grid.length - 1][0] + " " + text).trim(); lineIdx.push(...cellIdx(c)); continue; }
        const attachNext = nextLabel && (denseRules ? !ruleBetween(row, nextRow) : /^[a-zà-ÿ]/.test(nextLabel) || !/[.:]$/.test(text) && row.cells[0].x0 <= bands[0].x0 + emOf(c) * 0.5 && nextRow.y - row.y <= medPitch * 1.25);
        if (pendingLabel) { pendingLabel.text = `${pendingLabel.text} ${text}`; pendingLabel.idx.push(...cellIdx(c)); }
        else pendingLabel = { text, idx: cellIdx(c), row };
        if (!attachNext) flushPending();
        continue;
      }
      // Blank separator line between groups → an empty spacer row keeps the
      // vertical rhythm of the statement when rendered.
      const prevRow = gridRows[gridRows.length - 1];
      // A gap after a row that wrapped onto several lines is that row's own
      // height, not a blank separator: measure the gap from its last line.
      const prevLastY = (() => { let y = prevRow?.y ?? row.y; for (let q = r - 1; q >= 0 && blockRows[q] !== prevRow; q--) { if (blockRows[q].cells.length === 1) { y = Math.max(y, blockRows[q].y); } else break; } return y; })();
      if (prevRow && !pendingLabel && !pendingCells.size && row.y - prevLastY > medPitch * 1.7 && grid.length) { grid.push(bands.map(() => "")); gridRows.push(row); }
      const cells = bands.map((_, b) => cellText(row, b));
      if (pendingLabel) { cells[0] = `${pendingLabel.text} ${cells[0]}`.trim(); lineIdx.push(...pendingLabel.idx); pendingLabel = null; }
      if (pendingCells.size) {
        const prevRow = gridRows[gridRows.length - 1];
        // The held lines belong to this row unless a rule separates them from it.
        const pcRow = [...pendingCells.values()][0].row;
        if (denseRules && ruleBetween(pcRow, row)) flushPendingCells();
        else { for (const [b, pc] of pendingCells) { cells[b] = `${pc.text} ${cells[b]}`.trim(); lineIdx.push(...pc.idx); } pendingCells.clear(); }
        void prevRow;
      }
      grid.push(cells); gridRows.push(row);
      for (const c of row.cells) lineIdx.push(...cellIdx(c));
    }
    flushPending();
    flushPendingCells();
    // A row with no label whose predecessor has no values is the wrapped
    // second line of that predecessor ("Item 5. Market For … Equity" /
    // "Securities 33").
    for (let r = 1; r < grid.length; r++) {
      const cur = grid[r], prev = grid[r - 1];
      if (cur[0] !== "" || !prev[0] || !prev.some(Boolean) || !cur.some(Boolean)) continue;
      const last = bands.length - 1;
      if (prev[last] !== "" || cur[last] === "") continue;
      if (prev.slice(1).some((v, k) => v && cur[k + 1] && numeric(v) && numeric(cur[k + 1]))) continue;
      for (let k = 0; k < bands.length; k++) prev[k] = [prev[k], cur[k]].filter(Boolean).join(" ");
      grid.splice(r, 1); gridRows.splice(r, 1); r--;
    }
    while (grid.length && grid[grid.length - 1].every((c) => !c)) { grid.pop(); gridRows.pop(); }
    if (lineIdx.some((k) => used.has(k))) { i = best.j + 1; continue; }

    // Numeric columns: at least two numeric cells and 60% of the non-empty ones.
    const isNumCol = bands.map((_, k) => {
      const vals = grid.map((r) => r[k]).filter(Boolean);
      const n = vals.filter(numeric).length;
      return n >= 2 && n / vals.length >= 0.6;
    });
    const numCols = isNumCol.filter(Boolean).length;
    // A two-column, three-line block of prose with no ruling and no numbers
    // (a résumé's side-by-side sections, a caption next to a figure) is not a table.
    // Without ruling and without a numeric column, only a solid block of
    // aligned rows is a table; a cover page's two-column address block, a
    // résumé's side-by-side sections or a caption beside a figure are not.
    const hasLoneLabel = blockRows.some((r) => r.cells.length === 1 && (assign.get(r.cells[0]) ?? -1) === 0);
    // Horizontal rules alone only count as structure when numbers sit between
    // them (a statement); a cover page's section rules around text do not.
    const structural = verticalRules >= 2 || filledRows >= 2 || (ruleYs.length >= 3 && numCols > 0);
    // …and its rows must agree on the cell count: prose lines that happen to
    // align do not, a real text table does.
    const counts = new Set(blockRows.filter((r) => r.cells.length >= 2).map((r) => r.cells.length));
    if (!structural && numCols === 0 && (multiRows < 4 || hasLoneLabel || counts.size > 1 || bands.length === 2 && grid.length <= 3)) { dbg("reject text block", grid[0]); i++; continue; }
    // A chart's axis labels and legend sit between plenty of rules but fill
    // only a corner of their grid; a real table of three rows is mostly full.
    const fillRatio = grid.flat().filter(Boolean).length / Math.max(1, grid.length * bands.length);
    const multiFilled = grid.filter((r) => r.filter(Boolean).length >= 2).length;
    // …and a wide block that is mostly empty cells is a form grid, not a table.
    if ((grid.length <= 3 && fillRatio < 0.6) || (fillRatio < 0.5 && multiFilled <= 2) || (bands.length >= 6 && fillRatio < 0.3)) { dbg("reject sparse block", grid[0]); i++; continue; }

    // Header: first row is a header when its runs are bold, or when a filled band covers exactly that row.
    const first = blockRows[0];
    const headerBg = rowFill(first);
    const firstBold = first.cells.every((c) => c.run.bold);
    const bodyFills = blockRows.slice(1).map(rowFill);
    const headerDistinct = !!headerBg && !bodyFills.every((f) => f?.fill === headerBg.fill);
    let headerRows = (headerDistinct || (firstBold && !blockRows.slice(1).every((r) => r.cells.every((c) => c.run.bold)))) ? 1 : 0;
    // Consecutive leading rows set entirely in bold are the header when the
    // body is not ("Legal Name / Country of / Incorporation" over regular rows).
    const rowBold = (r: Row) => r.cells.every((c) => c.run.bold);
    if (!blockRows.every(rowBold)) {
      let b = 0;
      while (b < Math.min(5, gridRows.length - 1) && gridRows[b] && rowBold(gridRows[b]) && grid[b].some(Boolean)) b++;
      headerRows = Math.max(headerRows, b);
    }
    // In a ruled table every line above the first rule that has body rows under
    // it belongs to the header (a three-line header shares one cell box).
    if (denseRules && ruleYs.length) {
      const firstRule = ruleYs.find((y) => y > gridRows[0].y + gridRows[0].h * 0.5);
      if (firstRule != null) {
        const above = gridRows.filter((r) => r.y + r.h * 0.5 < firstRule).length;
        // …unless those lines already carry figures in the numeric columns: a
        // table of contents ruled under every entry has no header row.
        const figuresAbove = grid.slice(0, above).some((row) => row.some((v, k) => isNumCol[k] && v && numeric(v)));
        if (above >= 1 && above <= 5 && gridRows.length - above >= 2 && !figuresAbove) headerRows = Math.max(headerRows, above);
      }
    }
    // Multi-line column headers ("31 Mar 2026" / "AED million", "Additional" /
    // "Paid-In" / "Capital"): leading rows whose cells in the numeric columns
    // are all non-numeric, as long as at least two body rows remain.
    if (numCols > 0) {
      let h = 0;
      while (h < Math.min(5, grid.length - 2)) {
        const row = grid[h];
        const nonEmpty = row.filter(Boolean);
        if (!nonEmpty.length) break;
        const numericHere = row.some((v, k) => isNumCol[k] && v && numeric(v));
        if (numericHere) break;
        // Header cells sit in the numeric columns (or the row is styled as a header).
        if (!row.some((v, k) => isNumCol[k] && v) && h >= headerRows) break;
        h++;
      }
      headerRows = Math.max(headerRows, h);
    }
    if (headerRows > 0 && grid.length - headerRows < 1) headerRows = 0;

    // A grid needs vertical rules; horizontal underlines alone (statement
    // totals, header rules) do not make a bordered table.
    // …or a Word grid: one short vertical segment per cell plus a rule under
    // every row. The table then draws its own borders at its own row
    // positions and consumes the drawn ones, so they cannot clash.
    const shortVerticals = gridShapes.filter(({ s }) => isRule(s) && s.height > s.width).length;
    const hasGrid = verticalRules >= 2 || (shortVerticals >= 2 && denseRules && ruleYs.length >= 2);
    // Drawn vertical rules are the column edges: when every text band falls
    // into its own rule interval, the table gets exactly the drawn columns —
    // including empty ones — instead of bands split at text midpoints, so the
    // rendered borders sit where the PDF drew them.
    // Horizontal rules that stop short of the table width are cell borders of
    // rows that share a taller neighbour (rowspan: "1" beside three
    // description lines). The grid has no rowspan; text and rules stay put.
    // Any drawn vertical border counts here (Word draws one short segment per
    // cell, below the `hasGrid` length threshold); a statement's underlines
    // have no vertical rules at all and are unaffected.
    const anyVertical = shortVerticals >= 2;
    if (hasGrid || anyVertical) {
      const bx0 = Math.min(...bands.map((b) => b.x0)), bx1 = Math.max(...bands.map((b) => b.x1));
      const partial = gridShapes.filter(({ s }) => isRule(s) && s.width >= s.height && s.width >= tableW * 0.3 && (s.x > bx0 + 3 || s.x + s.width < bx1 - 3)).length;
      if (partial >= 2) { dbg("reject rowspan grid", grid[0]); i++; continue; }
    }
    let colBands: { x0: number; x1: number }[] = bands;
    let colGrid: string[][] = grid;
    let colNum: boolean[] = isNumCol;
    let edges: number[] | null = null;
    if (hasGrid) {
      // Vertical rule positions, each weighted by the rule length stacked on
      // it (Word/browsers draw one short segment per cell): a column edge is
      // an x where the segments add up to at least half the block height.
      const acc = new Map<number, number>();
      const blockH = blockRows[blockRows.length - 1].y + blockRows[blockRows.length - 1].h - blockRows[0].y;
      for (const { s } of gridShapes) {
        if (!(isRule(s) && s.height > s.width)) continue;
        const cx = s.x + s.width / 2;
        const key = [...acc.keys()].find((x) => Math.abs(x - cx) < 1) ?? cx;
        acc.set(key, (acc.get(key) ?? 0) + s.height);
      }
      const xs = [...acc.entries()].filter(([, h]) => h >= blockH * 0.5).map(([x]) => x).sort((a, b) => a - b);
      dbg(`grid rules x=${xs.map((x) => x.toFixed(1)).join(",")} bands=${bands.length}`);
      if (xs.length >= 3) {
        const bandCol = bands.map((b) => { const c = (b.x0 + b.x1) / 2; return xs.findIndex((x, k) => k < xs.length - 1 && c > x && c < xs[k + 1]); });
        // Every cell must stay inside its rule interval: text running across
        // a drawn rule is a merged cell (colspan), which the grid cannot hold.
        // A cell straddling a rule (text on both sides of a drawn vertical
        // line) is the merged-cell signal; cells outside the ruled range
        // (a column whose border did not survive) are fine.
        const straddles = (c: Cell) => xs.some((x) => c.x0 < x - 1.5 && c.x1 > x + 1.5);
        // …and so is one ruled cell holding two text bands (a form's
        // "label: value" pairs boxed together): no single column layout fits.
        const crowded = bandCol.some((c, k) => c >= 0 && bandCol.indexOf(c) !== k);
        const inside = !crowded && !blockRows.some((row) => row.cells.some(straddles));
        if (!inside) {
          // Text running across a drawn rule = merged cells (colspan), or a
          // per-row column layout (a Word form): a rows×columns table cannot
          // express it; text and rules stay where the PDF put them.
          dbg("reject merged-cell grid", grid[0]); i++; continue;
        }
        if (xs.length - 1 >= bands.length && bandCol.every((c) => c >= 0) && new Set(bandCol).size === bandCol.length) {
          edges = xs;
          colBands = xs.slice(0, -1).map((x, k) => ({ x0: x, x1: xs[k + 1] }));
          colGrid = grid.map((row) => { const out = colBands.map(() => ""); row.forEach((v, k) => { out[bandCol[k]] = v; }); return out; });
          colNum = colBands.map((_, k) => { const b = bandCol.indexOf(k); return b >= 0 && isNumCol[b]; });
        }
      }
    }
    // Column alignment: numeric columns → right.
    const columns: TableColumn[] = colBands.map((b, k) => {
      const col: TableColumn = { width: Math.round((b.x1 - b.x0) * 10) / 10 };
      if (colNum[k]) col.align = "right" as TextAlign;
      return col;
    });
    // Widen bands to fill the gaps between them (cells have padding).
    const x0 = edges ? edges[0] : Math.max(0, bands[0].x0 - 2.5);
    const x1 = edges ? edges[edges.length - 1] : Math.min(pageW, bands[bands.length - 1].x1 + 2.5);
    if (!edges) {
      // Column edges = midpoints between neighbouring bands, forced to increase
      // so an overlapping pair can never produce a negative width.
      edges = [x0];
      for (let k = 1; k < bands.length; k++) edges.push(Math.max(edges[k - 1] + 2, Math.min((bands[k - 1].x1 + bands[k].x0) / 2, x1 - 2 * (bands.length - k))));
      edges.push(Math.max(edges[edges.length - 1] + 2, x1));
    }
    for (let k = 0; k < colBands.length; k++) columns[k].width = Math.round((edges[k + 1] - edges[k]) * 10) / 10;
    const colOfBand = colBands === bands ? bands.map((_, k) => k) : bands.map((b) => colBands.findIndex((cb) => (b.x0 + b.x1) / 2 > cb.x0 && (b.x0 + b.x1) / 2 < cb.x1));

    // Alternating row background: every other body row shares one fill, the
    // others have none. Body rows are the source rows that became grid rows
    // (spacer rows excluded), in grid order.
    const bodyRows = gridRows.slice(headerRows).filter((r, k, arr) => grid[headerRows + k]?.some(Boolean));
    const rowFills = bodyRows.map(rowFill).map((f) => f?.fill ?? null);
    const odd = rowFills.filter((_, k) => k % 2 === 1), even = rowFills.filter((_, k) => k % 2 === 0);
    const oddAlt = odd.length && odd[0] && odd.every((f) => f === odd[0]) && even.every((f) => f !== odd[0]) ? odd[0] : undefined;
    const evenAlt = !oddAlt && even.length > 1 && even[0] && even.every((f) => f === even[0]) && odd.every((f) => f !== even[0]) ? even[0] : undefined;
    const altColor = oddAlt || evenAlt;
    const borderShape = gridShapes.find(({ s }) => isRule(s));
    const borderColor = borderShape ? (borderShape.s.stroke || borderShape.s.fill) : undefined;

    // Cell font = the size carrying most characters in the block; compact cell
    // padding derived from the source row pitch so the rendered table occupies
    // the same box as the PDF's rows instead of growing 3× and covering the
    // text below it.
    const sizeChars = new Map<number, number>();
    for (const row of blockRows) for (const c of row.cells) { const k = Math.round(c.run.fontSize * 2) / 2; sizeChars.set(k, (sizeChars.get(k) ?? 0) + c.run.text.length); }
    const fontSize = [...sizeChars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? Math.round(first.cells[0].run.fontSize * 10) / 10;
    const lineMm = fontSize * PT_TO_MM * 1.2;
    const padV = Math.max(0.2, Math.min(2.5, (medPitch - lineMm) / 2));
    const padH = Math.max(0.5, Math.min(3, fontSize * PT_TO_MM * 0.35));
    const y0 = headerBg ? Math.min(...headerBg.rects.map(({ s }) => s.y)) : first.y - padV;
    // Table face/colour = the family and colour carrying most characters;
    // cells that differ (a bold total row, an italic note, a red figure, a
    // serif label) carry their own style so nothing the PDF set is lost.
    const tally = (pick: (c: Cell) => string | undefined) => {
      const m = new Map<string, number>();
      for (const row of blockRows) for (const c of row.cells) { const k = pick(c); if (k) m.set(k, (m.get(k) ?? 0) + c.run.text.trim().length); }
      return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    };
    const tableFamily = tally((c) => c.run.family);
    const tableColor = tally((c) => c.run.color) ?? "#000000";
    // Runs behind each grid cell: the source row's cells in that band, plus the
    // lone label lines folded into column 0 of a row without its own label.
    const runsAt = (r: number, b: number): TRun[] => {
      const src = gridRows[r];
      if (!src) return [];
      const own = src.cells.filter((c) => assign.get(c) === b).map((c) => c.run);
      if (own.length || b !== 0) return own;
      const at = blockRows.indexOf(src);
      for (let q = at - 1; q >= Math.max(0, at - 3); q--) {
        const row = blockRows[q];
        if (row.cells.length !== 1) break;
        if ((assign.get(row.cells[0]) ?? 0) === 0) return [row.cells[0].run];
      }
      return [];
    };
    const styledCell = (text: string, runs: TRun[]): TableCellValue => {
      if (!text || !runs.length) return text;
      const st: Record<string, unknown> = {};
      const chars = (f: (r: TRun) => boolean) => runs.filter(f).reduce((a, r) => a + r.text.trim().length, 0) / Math.max(1, runs.reduce((a, r) => a + r.text.trim().length, 0));
      if (chars((r) => !!r.bold) >= 0.5) st.fontWeight = "bold";
      if (chars((r) => !!r.italic) >= 0.5) st.fontStyle = "italic";
      const color = runs.slice().sort((a, b) => b.text.trim().length - a.text.trim().length)[0].color;
      if (color && color !== tableColor) st.color = color;
      const fam = runs.slice().sort((a, b) => b.text.trim().length - a.text.trim().length)[0].family;
      if (fam && tableFamily && fam !== tableFamily) st.fontFamily = fam;
      const size = Math.round(runs[0].fontSize * 2) / 2;
      if (Math.abs(size - fontSize) >= 1) st.fontSize = size;
      return Object.keys(st).length ? { content: text, style: st as any } : text;
    };
    const bodyStart = (() => { let k = headerRows; while (k < colGrid.length - 1 && colGrid[k].every((c) => !c)) k++; return k; })();
    const styledRows: TableCellValue[][] = colGrid.slice(bodyStart).map((row, ri) => {
      const r = bodyStart + ri;
      return row.map((text, col) => { const b = colOfBand.indexOf(col); return styledCell(text, b >= 0 ? runsAt(r, b) : []); });
    });
    const tableStyle: Record<string, unknown> = { fontSize, lineHeight: 1.2, padding: `${Math.round(padV * 100) / 100}mm ${Math.round(padH * 100) / 100}mm` };
    if (tableFamily) tableStyle.fontFamily = tableFamily;
    if (tableColor !== "#000000") tableStyle.color = tableColor;
    const element: TableElement = {
      type: "table",
      position: { x: Math.round(x0 * 100) / 100, y: Math.round(Math.max(0, y0) * 100) / 100 },
      width: Math.round((x1 - x0) * 100) / 100,
      columns,
      rows: styledRows,
      style: tableStyle as any,
    };
    if (headerRows > 0) {
      element.headers = colBands.map((_, k) => colGrid.slice(0, headerRows).map((r) => r[k]).filter(Boolean).join(" ").trim());
      const hs: Record<string, unknown> = { fontWeight: "bold" };
      if (headerBg) hs.backgroundColor = headerBg.fill;
      // One text colour for the header row: the colour carrying most header
      // characters, and only when a header band gives it contrast (white on
      // blue). Without a band the first cell's white would be white on white.
      if (headerBg) {
        const tally = new Map<string, number>();
        for (const c of blockRows.slice(0, headerRows).flatMap((r) => r.cells)) tally.set(c.run.color, (tally.get(c.run.color) ?? 0) + c.run.text.length);
        const hc = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (hc && hc !== "#000000") hs.color = hc;
      }
      element.headerStyle = hs as any;
    }
    if (oddAlt) element.alternatingRowColor = oddAlt;
    // Even rows filled (the first body row carries the band): every row gets
    // the fill and the odd ones are painted back to white. Both HTML
    // renderers and the Rust exporter read rowStyle / alternateRowStyle.
    if (evenAlt) { element.rowStyle = { backgroundColor: evenAlt } as any; element.alternateRowStyle = { backgroundColor: "#ffffff" } as any; }
    element.borders = hasGrid && borderColor ? { outer: true, inner: true, color: borderColor, width: 1 } : false;
    // Consume the rules and the row fills the table now expresses itself;
    // other rects (a shaded column, a logo box) stay as shapes behind it.
    const fillRects = new Set<number>();
    if (headerBg) for (const { k } of headerBg.rects) fillRects.add(k);
    // Fills under the header lines (a dark box behind one column's header) are
    // consumed too: left behind they would sit under black header text.
    if (headerRows > 0) {
      const hy0 = gridRows[0].y - gridRows[0].h * 0.5, hy1 = gridRows[headerRows - 1].y + gridRows[headerRows - 1].h * 1.2;
      // Only a band spanning most of the table is a header background the
      // `headerStyle` can express; a box behind one column's header (FAB's
      // dark-blue "31 Mar 2026") stays as a shape so the box is not lost.
      for (const { s, k } of gridShapes) if (s.kind === "rect" && s.fill && s.fill.toLowerCase() !== "#ffffff" && !isRule(s) && s.width >= tableW * 0.5 && s.y < hy1 && s.y + s.height > hy0 && s.y >= hy0 - gridRows[0].h) fillRects.add(k);
    }
    if (altColor) for (const row of blockRows) { const f = rowFill(row); if (f) for (const { k } of f.rects) fillRects.add(k); }
    // Rules are consumed only when the table draws them itself (a bordered
    // grid). Underlines under totals and header rules of an unruled statement
    // stay as shapes at their PDF position — dropping them lost every line.
    const consumedShapes = gridShapes.filter(({ s, k }) => (hasGrid && isRule(s)) || fillRects.has(k)).map(({ k }) => k);
    dbg(`table ${grid.length} rows × ${bands.length} cols at y=${element.position!.y}`, element.headers ?? grid[0]);

    for (const k of lineIdx) used.add(k);
    out.push({ element, lineIdx, shapeIdx: consumedShapes });
    i = best.j + 1;
  }
  return out;
}
