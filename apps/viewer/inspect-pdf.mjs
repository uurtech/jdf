// Inspect PDF features — operator coverage, font variety, image count, color spaces
import fs from "node:fs";
import path from "node:path";

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const file = process.argv[2];
if (!file) { console.error("usage: node inspect-pdf.mjs <file.pdf>"); process.exit(1); }
const data = fs.readFileSync(file);
const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useWorkerFetch: false, disableWorker: true, isEvalSupported: false }).promise;

const OPS = pdfjs.OPS;
const opNameOf = (n) => Object.keys(OPS).find((k) => OPS[k] === n) || `op${n}`;

const summary = {
  file: path.basename(file),
  pages: doc.numPages,
  fonts: new Map(), // name → count
  fontFamilies: new Set(),
  fontSizes: new Set(),
  colors: new Set(),
  opCounts: new Map(),
  imagesPerPage: [],
  textItemsPerPage: [],
  pageSizesPt: [],
  hasAnnotations: 0,
  hasLinks: 0,
  hasOutline: false,
};

const outline = await doc.getOutline().catch(() => null);
summary.hasOutline = !!(outline && outline.length);

const N = Math.min(doc.numPages, 10); // sample first 10 pages
for (let pi = 1; pi <= N; pi++) {
  const page = await doc.getPage(pi);
  const vp = page.getViewport({ scale: 1 });
  summary.pageSizesPt.push([Math.round(vp.width), Math.round(vp.height)]);

  // Annotations / links
  const annots = await page.getAnnotations().catch(() => []);
  summary.hasAnnotations += annots.length;
  summary.hasLinks += annots.filter((a) => a.subtype === "Link").length;

  // Text content + fonts
  const tc = await page.getTextContent({ disableCombineTextItems: false });
  summary.textItemsPerPage.push(tc.items.length);
  for (const k of Object.keys(tc.styles || {})) {
    const s = tc.styles[k];
    summary.fontFamilies.add(s.fontFamily || k);
  }
  for (const it of tc.items) {
    if (!it.str) continue;
    const tr = it.transform;
    const fs = Math.hypot(tr[2], tr[3]);
    summary.fontSizes.add(Math.round(fs * 10) / 10);
    summary.fonts.set(it.fontName, (summary.fonts.get(it.fontName) || 0) + 1);
  }

  // Op list — count distinct ops, track colors and images
  const opList = await page.getOperatorList();
  let imgs = 0;
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] || [];
    const name = opNameOf(fn);
    summary.opCounts.set(name, (summary.opCounts.get(name) || 0) + 1);
    if (fn === OPS.setFillRGBColor || fn === OPS.setStrokeRGBColor) {
      summary.colors.add(`rgb(${args[0].toFixed(2)},${args[1].toFixed(2)},${args[2].toFixed(2)})`);
    }
    if (fn === OPS.setFillCMYKColor) summary.colors.add(`cmyk`);
    if (fn === OPS.setFillGray || fn === OPS.setStrokeGray) summary.colors.add(`gray(${args[0].toFixed(2)})`);
    if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintInlineImageXObject) imgs++;
  }
  summary.imagesPerPage.push(imgs);
}

// Print
console.log("=".repeat(60));
console.log("File:", summary.file);
console.log("Pages:", summary.pages, "(sampled", N, ")");
console.log("Page sizes (pt):", summary.pageSizesPt.slice(0, 3).map((s) => s.join("x")).join(", "), summary.pageSizesPt.length > 3 ? "..." : "");
console.log("Outline (TOC):", summary.hasOutline);
console.log("Annotations:", summary.hasAnnotations, " Links:", summary.hasLinks);
console.log();
console.log("Font families (", summary.fontFamilies.size, "):");
for (const f of [...summary.fontFamilies].slice(0, 15)) console.log("  -", f);
if (summary.fontFamilies.size > 15) console.log("  ...");
console.log();
console.log("Font sizes:", [...summary.fontSizes].sort((a,b) => a-b).slice(0, 20).join(", "));
console.log("Distinct colors:", summary.colors.size);
[...summary.colors].slice(0, 10).forEach((c) => console.log("  ", c));
console.log();
console.log("Text items per sampled page:", summary.textItemsPerPage.join(", "));
console.log("Images per sampled page:", summary.imagesPerPage.join(", "));
console.log();
console.log("Top 30 ops:");
const sortedOps = [...summary.opCounts.entries()].sort((a,b) => b[1] - a[1]);
for (const [name, cnt] of sortedOps.slice(0, 30)) console.log(`  ${name.padEnd(30)} ${cnt}`);
