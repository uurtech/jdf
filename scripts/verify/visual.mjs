// Visual match: PDF page (pdftoppm) vs the same page converted with `jdf convert`
// and rendered by jdf.js — for every PDF in the QA corpus (ref_docs/*.pdf +
// spec/examples/sample.pdf), first three pages. Also renders page 1 in the
// desktop reader (built dist, Tauri IPC mocked) and compares it with jdf.js.
//
// The score per page is a similarity in [0, 1]: half pixel similarity on a
// 240 px-wide grayscale downsample, a quarter each for the correlation of the
// row and column ink profiles (robust to font-metric drift, sensitive to a
// lost table, a missing banner or text landing on the wrong line). Scores are
// compared against the committed baseline; a page may not drop by more than
// TOLERANCE. Side-by-side sheets go to verify-out/visual/ for human review.
//
//   node scripts/verify/visual.mjs             compare with regress/visual-baseline.json
//   node scripts/verify/visual.mjs --update    accept the current scores
//   node scripts/verify/visual.mjs --only FAB  subset
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Playwright lives in the bench workspace (pnpm hoists it under node_modules/.pnpm); fall back to a root install.
const requireHoisted = (name, from) => { try { return require(path.join(from, "node_modules/.pnpm/node_modules", name)); } catch { return require(name); } };
const { chromium } = requireHoisted("playwright", path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
const { createCanvas, loadImage } = requireHoisted("@napi-rs/canvas", path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const args = process.argv.slice(2);
const update = args.includes("--update");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const PAGES = 3;
const WIDTH = 800;
const TOLERANCE = 0.02;
const READER_TOLERANCE = 0.03;
const baselinePath = path.join(repo, "packages/jdf-pdf-import/regress/visual-baseline.json");
const outDir = path.join(process.env.JDF_VERIFY_OUT || path.join(repo, "verify-out"), "visual");
const tmpDir = path.join(repo, "verify-out/.visual-tmp"); // served from the repo root
fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(tmpDir, { recursive: true, force: true }); fs.mkdirSync(tmpDir, { recursive: true });

for (const bin of ["pdftoppm", "pdfinfo"]) {
  try { execFileSync("which", [bin], { stdio: "ignore" }); } catch { console.error(`✗ ${bin} not found — install poppler (brew install poppler / apt install poppler-utils)`); process.exit(2); }
}
if (!fs.existsSync(path.join(repo, "jdfjs/dist/jdfjs.js"))) { console.error("✗ jdfjs/dist missing — run pnpm --filter @uurtech/jdf build"); process.exit(2); }
if (!fs.existsSync(path.join(repo, "apps/reader/dist/index.html"))) { console.error("✗ apps/reader/dist missing — run pnpm --filter @jdf/reader build"); process.exit(2); }

// ── corpus ──────────────────────────────────────────────────────────────────
const docs = [];
const sample = path.join(repo, "spec/examples/sample.pdf");
if (fs.existsSync(sample)) docs.push({ key: "spec/examples/sample.pdf", file: sample });
const refDir = path.join(repo, "ref_docs");
if (fs.existsSync(refDir)) for (const f of fs.readdirSync(refDir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort()) docs.push({ key: `ref_docs/${f}`, file: path.join(refDir, f) });
const selected = docs.filter((d) => !only || d.key.includes(only));
if (!selected.length) { console.error("no PDFs to check"); process.exit(2); }

// ── helpers ─────────────────────────────────────────────────────────────────
const slug = (s) => s.replace(/^.*\//, "").replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9._-]+/g, "_");
function convert(pdf, outJdf) {
  execFileSync("npx", ["--no-install", "tsx", "src/index.ts", "convert", pdf, "-o", outJdf, "--json"], { cwd: path.join(repo, "tools/jdf-cli"), stdio: ["ignore", "ignore", "pipe"] });
}
function trimPages(jdfPath, n) {
  const d = JSON.parse(fs.readFileSync(jdfPath, "utf8"));
  d.pages = d.pages.slice(0, n);
  fs.writeFileSync(jdfPath, JSON.stringify(d));
  return d.pages.length;
}
async function gray(pngPath, w, h) {
  const img = await loadImage(pngPath);
  const c = createCanvas(w, h); const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 1 - (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255; // ink: 0 = white
  return g;
}
function corr(a, b) {
  const n = a.length; let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  if (saa === 0 || sbb === 0) return saa === sbb ? 1 : 0;
  return Math.max(0, sab / Math.sqrt(saa * sbb));
}
function blur1D(v, r) {
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const j = i + k; if (j >= 0 && j < v.length) { s += v[j]; n++; } } out[i] = s / n; }
  return out;
}
// Similarity of two page renders. Text lines drift by a few pixels when the
// browser font is not the PDF's, so both terms tolerate small shifts: the
// pixel term takes the best of ±SHIFT row offsets, the profile terms are
// blurred before correlating. A lost table, a missing banner, text on the
// wrong half of the page or a page bleeding onto the next still cost a lot.
async function score(pngA, pngB) {
  const w = 240; const meta = await loadImage(pngA); const h = Math.max(20, Math.round((w * meta.height) / meta.width));
  const a = await gray(pngA, w, h), b = await gray(pngB, w, h);
  const SHIFT = 4;
  let bestPixel = 0;
  for (let dy = -SHIFT; dy <= SHIFT; dy++) {
    let diff = 0, n = 0;
    for (let y = 0; y < h; y++) { const yb = y + dy; if (yb < 0 || yb >= h) continue; for (let x = 0; x < w; x++) { diff += Math.abs(a[y * w + x] - b[yb * w + x]); n++; } }
    bestPixel = Math.max(bestPixel, 1 - diff / Math.max(1, n));
  }
  const rows = (g) => { const r = new Float32Array(h); for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) s += g[y * w + x]; r[y] = s; } return blur1D(r, 4); };
  const cols = (g) => { const c = new Float32Array(w); for (let x = 0; x < w; x++) { let s = 0; for (let y = 0; y < h; y++) s += g[y * w + x]; c[x] = s; } return blur1D(c, 3); };
  const s = 0.5 * bestPixel + 0.25 * corr(rows(a), rows(b)) + 0.25 * corr(cols(a), cols(b));
  return Math.round(s * 1000) / 1000;
}
function sideBySide(left, right, out) {
  try { execFileSync("magick", [left, right, "-background", "#888", "-splice", "6x0+0+0", "+append", "-bordercolor", "#888", "-border", "2", out], { stdio: "ignore" }); } catch { /* ImageMagick optional */ }
}

// ── servers + browser ───────────────────────────────────────────────────────
const PORT = 48160;
const srvRepo = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: repo, stdio: "ignore" });
const srvReader = spawn("python3", ["-m", "http.server", String(PORT + 1), "--bind", "127.0.0.1"], { cwd: path.join(repo, "apps/reader/dist"), stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : {};
const next = { ...baseline };
let failed = 0, checked = 0, fresh = 0;
const rows = [];

try {
  for (const d of selected) {
    const name = slug(d.key);
    const jdf = path.join(tmpDir, `${name}.jdf`);
    let pagesN;
    try { convert(d.file, jdf); pagesN = trimPages(jdf, PAGES); } catch (e) { console.log(`✗ ${d.key}: convert failed: ${String(e.stderr || e.message).split("\n")[0]}`); failed++; continue; }
    const rel = path.relative(repo, jdf).split(path.sep).join("/");

    // jdf.js
    const page = await browser.newPage({ viewport: { width: WIDTH + 40, height: 1400 }, deviceScaleFactor: 1 });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const html = `<!doctype html><html><head><link rel="stylesheet" href="/jdfjs/dist/jdfjs.css"><script type="module" src="/jdfjs/dist/jdfjs.js"></script><style>body{margin:0;background:#fff}</style></head><body><jdf src="/${encodeURI(rel)}" toolbar="false" sidebar="false" fit="manual" height="1400"></jdf></body></html>`;
    fs.writeFileSync(path.join(tmpDir, `${name}.html`), html);
    await page.goto(`http://127.0.0.1:${PORT}/verify-out/.visual-tmp/${encodeURIComponent(name)}.html`);
    try { await page.waitForSelector(".jdfjs-page", { timeout: 60000 }); } catch { console.log(`✗ ${d.key}: jdf.js did not render`); failed++; await page.close(); continue; }
    await page.waitForTimeout(700);
    const pageScores = {};
    for (let p = 1; p <= pagesN; p++) {
      const el = page.locator(".jdfjs-page-wrapper").nth(p - 1);
      await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(120);
      const jdfPng = path.join(outDir, `${name}-p${p}-jdf.png`);
      await el.screenshot({ path: jdfPng });
      const box = await el.boundingBox();
      const pdfBase = path.join(outDir, `${name}-p${p}-pdf`);
      execFileSync("pdftoppm", ["-r", "96", "-f", String(p), "-l", String(p), "-png", "-scale-to-x", String(Math.round(box.width)), "-scale-to-y", "-1", d.file, pdfBase], { stdio: "ignore" });
      const pdfPng = fs.readdirSync(outDir).filter((f) => f.startsWith(`${name}-p${p}-pdf`) && f.endsWith(".png")).map((f) => path.join(outDir, f))[0];
      const s = await score(pdfPng, jdfPng);
      pageScores[`p${p}`] = s;
      sideBySide(pdfPng, jdfPng, path.join(outDir, `${name}-p${p}.png`));
      fs.rmSync(pdfPng, { force: true }); fs.rmSync(jdfPng, { force: true });
    }
    // reader, page 1 — the same document rendered by the desktop app must match jdf.js
    let readerScore = null;
    {
      const rp = await browser.newPage({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 1 });
      const b64 = fs.readFileSync(jdf).toString("base64");
      const abs = jdf;
      await rp.addInitScript(({ abs, b64 }) => {
        const bin = () => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        window.__TAURI_INTERNALS__ = {
          metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" }, windows: [{ label: "main" }] },
          transformCallback: (cb) => cb, convertFileSrc: (p) => p,
          async invoke(cmd, a) {
            if (cmd === "read_text_file" && a?.path === abs) return new TextDecoder().decode(bin());
            if (cmd === "read_binary_file" && a?.path === abs) return bin().buffer;
            if (cmd === "save_document" || cmd === "write_binary_file" || cmd === "consume_pending_file") return null;
            throw new Error(`mock: unhandled ${cmd}`);
          },
        };
        localStorage.setItem("jdf-recent", JSON.stringify([abs]));
        localStorage.setItem("jdf-first-run-done", "1");
      }, { abs, b64 });
      const rerr = []; rp.on("pageerror", (e) => rerr.push(e.message));
      try {
        await rp.goto(`http://127.0.0.1:${PORT + 1}/`);
        await rp.getByText(path.basename(abs), { exact: true }).click();
        await rp.waitForSelector(".jdf-page", { timeout: 30000 }); await rp.waitForTimeout(700);
        const pg = rp.locator(".jdf-page").first();
        const readerPng = path.join(outDir, `${name}-p1-reader.png`);
        await pg.screenshot({ path: readerPng });
        // jdf.js page 1 again at the reader's size is unnecessary: score() normalises both to 240 px
        const el = page.locator(".jdfjs-page-wrapper").first(); await el.scrollIntoViewIfNeeded();
        const jdfPng = path.join(outDir, `${name}-p1-jdf-for-reader.png`); await el.screenshot({ path: jdfPng });
        readerScore = await score(jdfPng, readerPng);
        fs.rmSync(jdfPng, { force: true }); fs.rmSync(readerPng, { force: true });
        if (rerr.length) errors.push(`reader: ${rerr[0]}`);
      } catch (e) { errors.push(`reader render failed: ${String(e.message).split("\n")[0]}`); }
      await rp.close();
    }
    await page.close();

    const entry = { pages: pageScores, reader: readerScore };
    const base = baseline[d.key];
    const problems = [];
    if (errors.length) problems.push(`errors: ${errors.slice(0, 2).join(" | ")}`);
    if (base) {
      for (const [p, s] of Object.entries(pageScores)) if (base.pages?.[p] != null && s < base.pages[p] - TOLERANCE) problems.push(`${p} ${base.pages[p]} → ${s}`);
      if (readerScore != null && base.reader != null && readerScore < base.reader - READER_TOLERANCE) problems.push(`reader ${base.reader} → ${readerScore}`);
      checked++;
    } else { fresh++; }
    if (readerScore != null && readerScore < 0.85) problems.push(`reader vs jdf.js only ${readerScore}`);
    if (problems.length) failed++;
    if (!base || update || problems.length === 0) next[d.key] = entry;
    const mark = problems.length ? "✗" : base ? "✓" : update ? "+" : "?";
    rows.push([mark, d.key, Object.values(pageScores).map((s) => s.toFixed(3)).join(" "), readerScore == null ? "-" : readerScore.toFixed(3), problems.join("; ")]);
    console.log(`${mark} ${d.key}  pages [${Object.values(pageScores).map((s) => s.toFixed(3)).join(" ")}]  reader ${readerScore == null ? "-" : readerScore.toFixed(3)}${problems.length ? "  — " + problems.join("; ") : ""}`);
  }
} finally {
  await browser.close(); srvRepo.kill(); srvReader.kill();
}

fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ date: new Date().toISOString(), tolerance: TOLERANCE, rows }, null, 1));
if (update) {
  fs.writeFileSync(baselinePath, JSON.stringify(next, null, 1) + "\n");
  console.log(`\nvisual baseline written: ${path.relative(repo, baselinePath)} (${Object.keys(next).length} documents)`);
  process.exit(0);
}
console.log(`\nvisual: ${checked} compared, ${failed} regressed, ${fresh} without baseline — sheets in ${path.relative(repo, outDir)}/`);
if (fresh && !only) console.log("documents without a baseline are reported, not failed; accept them with --update");
process.exit(failed ? 1 : 0);
