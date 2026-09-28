// Forms end to end — the path a user of the site actually takes:
//   1. the fillable demo (docs/examples/customer-form.jdf) renders in jdf.js with
//      every label visible and normal-sized controls (0.2.6 stretched a checkbox
//      across the row and nobody noticed because every element tally matched);
//   2. the user types / ticks / picks, clicks the Save button → a .jdf downloads;
//   3. that file validates with the CLI and opens in the desktop reader (built
//      dist, Tauri IPC mocked) with the same values in the same fields;
//   4. a PDF form imported with `jdf convert` (HCFA-1500, ref_docs/) renders its
//      widgets compact and inside the printed boxes in both renderers.
//
//   node scripts/verify/forms.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Playwright lives in the bench workspace (pnpm hoists it under node_modules/.pnpm); fall back to a root install.
const requireHoisted = (name, from) => { try { return require(path.join(from, "node_modules/.pnpm/node_modules", name)); } catch { return require(name); } };
const { chromium } = requireHoisted("playwright", path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const outDir = path.join(process.env.JDF_VERIFY_OUT || path.join(repo, "verify-out"), "forms");
fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
const tmp = path.join(repo, "verify-out/.forms-tmp"); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });

const PORT = 48170;
const srvRepo = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: repo, stdio: "ignore" });
const srvReader = spawn("python3", ["-m", "http.server", String(PORT + 1), "--bind", "127.0.0.1"], { cwd: path.join(repo, "apps/reader/dist"), stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ channel: "chrome", headless: true });
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };
const expect = (cond, m) => (cond ? ok(m) : bad(m));

const formChecks = () => ({
  labels: [...document.querySelectorAll(".jdfjs-form-field")].map((f) => { const l = f.querySelector(".jdfjs-form-label, .jdfjs-form-checkbox-label"); return l ? { text: l.textContent.trim().slice(0, 30), visible: !!(l.offsetWidth && l.offsetHeight) } : null; }).filter(Boolean),
  checkboxes: [...document.querySelectorAll('input[type="checkbox"]')].map((c) => { const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), checked: c.checked }; }),
  values: Object.fromEntries([...document.querySelectorAll("input:not([type=checkbox]), textarea, select")].map((i) => [i.name, i.value])),
  compact: document.querySelectorAll(".jdfjs-form-compact").length,
  unknown: (document.body.innerText.match(/\[unknown:[^\]]*\]/g) || []).length,
});

async function openInReader(jdfPath) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = []; p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(m.text()); });
  const b64 = fs.readFileSync(jdfPath).toString("base64");
  await p.addInitScript(({ abs, b64 }) => {
    const bin = () => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" }, windows: [{ label: "main" }] },
      transformCallback: (cb) => cb, convertFileSrc: (x) => x,
      async invoke(cmd, a) {
        if (cmd === "read_text_file" && a?.path === abs) return new TextDecoder().decode(bin());
        if (cmd === "read_binary_file" && a?.path === abs) return bin().buffer;
        if (cmd === "save_document" || cmd === "write_binary_file" || cmd === "consume_pending_file") return null;
        throw new Error(`mock: unhandled ${cmd}`);
      },
    };
    localStorage.setItem("jdf-recent", JSON.stringify([abs])); localStorage.setItem("jdf-first-run-done", "1");
  }, { abs: jdfPath, b64 });
  await p.goto(`http://127.0.0.1:${PORT + 1}/`);
  await p.getByText(path.basename(jdfPath), { exact: true }).click();
  await p.waitForSelector(".jdf-page", { timeout: 30000 }); await p.waitForTimeout(600);
  return { p, errors };
}

try {
  // ── 1 + 2: fillable demo in jdf.js ─────────────────────────────────────────
  console.log("→ fillable demo (docs/examples/customer-form.jdf) in jdf.js");
  const page = await browser.newPage({ viewport: { width: 1100, height: 1200 }, acceptDownloads: true });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(m.text()); });
  fs.writeFileSync(path.join(tmp, "form.html"), `<!doctype html><html><head><link rel="stylesheet" href="/jdfjs/dist/jdfjs.css"><script type="module" src="/jdfjs/dist/jdfjs.js"></script></head><body style="margin:0"><jdf src="/docs/examples/customer-form.jdf" save-button="Save form" save-filename="filled.jdf" toolbar="false" sidebar="false" height="1100"></jdf></body></html>`);
  await page.addInitScript(() => document.addEventListener("jdf-ready", (e) => { window.__viewer = e.detail.viewer; }));
  await page.goto(`http://127.0.0.1:${PORT}/verify-out/.forms-tmp/form.html`);
  await page.waitForFunction(() => window.__viewer, null, { timeout: 30000 }); await page.waitForTimeout(500);
  let c = await page.evaluate(formChecks);
  expect(errors.length === 0, `no page errors (${errors.slice(0, 1).join("")})`);
  expect(c.labels.length >= 7 && c.labels.every((l) => l.visible), `all ${c.labels.length} labels visible`);
  expect(c.checkboxes.length === 2 && c.checkboxes.every((b) => b.w <= 24 && b.h <= 24), `checkboxes normal size (${c.checkboxes.map((b) => `${b.w}×${b.h}`).join(", ")})`);
  expect(c.compact === 0, "no compact fields on an authored form");
  await page.screenshot({ path: path.join(outDir, "customer-form-jdfjs.png"), fullPage: true });

  await page.fill('input[name="fullName"]', "Jane Tester");
  await page.fill('input[name="email"]', "jane@example.com");
  await page.fill('input[name="birthDate"]', "1990-05-17");
  await page.selectOption('select[name="country"]', "us");
  await page.fill('textarea[name="notes"]', "Verified by scripts/verify/forms.mjs");
  await page.check('input[name="newsletter"]');
  await page.check('input[name="terms"]');
  const exported = await page.evaluate(async () => JSON.parse(await window.__viewer.exportJdf().text()));
  const field = (n) => exported.pages.flatMap((p) => p.elements).find((e) => e.name === n);
  expect(field("fullName")?.value === "Jane Tester" && field("email")?.value === "jane@example.com", "typed values live in the document (exportJdf)");
  expect(field("country")?.value === "us" && field("terms")?.checked === true && field("newsletter")?.checked === true, "select + checkboxes live in the document");
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: /Save form/ }).click()]);
  const saved = path.join(tmp, "filled.jdf"); await download.saveAs(saved);
  const savedDoc = JSON.parse(fs.readFileSync(saved, "utf8"));
  expect(JSON.stringify(savedDoc) === JSON.stringify(exported), `Save button downloads the same document (${download.suggestedFilename()})`);
  await page.close();

  // ── 3: CLI validate + reader ───────────────────────────────────────────────
  console.log("→ downloaded file: CLI validate, then open in the desktop reader");
  try { execFileSync("npx", ["--no-install", "tsx", "src/index.ts", "validate", saved], { cwd: path.join(repo, "tools/jdf-cli"), stdio: "pipe" }); ok("jdf validate filled.jdf"); } catch (e) { bad(`jdf validate filled.jdf: ${String(e.stderr || e.message).split("\n").slice(-2).join(" ")}`); }
  {
    const { p, errors: rerr } = await openInReader(saved);
    const r = await p.evaluate(formChecks);
    expect(rerr.length === 0, `reader: no errors (${rerr.slice(0, 1).join("")})`);
    expect(r.unknown === 0, "reader: no [unknown: …] elements");
    expect(r.values.fullName === "Jane Tester" && r.values.email === "jane@example.com" && r.values.country === "us", "reader shows the typed values");
    expect(r.checkboxes.length === 2 && r.checkboxes.every((b) => b.checked), "reader shows both checkboxes ticked");
    expect(r.checkboxes.every((b) => b.w <= 24 && b.h <= 24) && r.labels.every((l) => l.visible), "reader: labels visible, checkboxes normal size");
    await p.locator(".jdf-page").first().screenshot({ path: path.join(outDir, "customer-form-reader.png") });
    await p.close();
  }

  // ── 4: imported PDF form (HCFA-1500) ───────────────────────────────────────
  const hcfaPdf = path.join(repo, "ref_docs/432938035-HCFA1500-10-Arial-Blue-1155-1.pdf");
  if (fs.existsSync(hcfaPdf)) {
    console.log("→ imported PDF form (HCFA-1500): compact widgets inside the printed boxes, both renderers");
    const hcfa = path.join(tmp, "hcfa.jdf");
    execFileSync("npx", ["--no-install", "tsx", "src/index.ts", "convert", hcfaPdf, "-o", hcfa, "--json"], { cwd: path.join(repo, "tools/jdf-cli"), stdio: "pipe" });
    const rel = path.relative(repo, hcfa).split(path.sep).join("/");
    fs.writeFileSync(path.join(tmp, "hcfa.html"), `<!doctype html><html><head><link rel="stylesheet" href="/jdfjs/dist/jdfjs.css"><script type="module" src="/jdfjs/dist/jdfjs.js"></script></head><body style="margin:0"><jdf src="/${rel}" toolbar="false" sidebar="false" height="1200"></jdf></body></html>`);
    const hp = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    const herr = []; hp.on("pageerror", (e) => herr.push(e.message));
    await hp.goto(`http://127.0.0.1:${PORT}/verify-out/.forms-tmp/hcfa.html`); await hp.waitForSelector(".jdfjs-page", { timeout: 30000 }); await hp.waitForTimeout(600);
    const h = await hp.evaluate(() => {
      const c = [...document.querySelectorAll(".jdfjs-form-compact")];
      const all = [...document.querySelectorAll(".jdfjs-form-field")].map((f) => ({ f: f.getBoundingClientRect(), i: f.querySelector("input, textarea, select")?.getBoundingClientRect() })).filter((x) => x.i);
      const inputs = all.map((x) => x.i);
      const page = document.querySelector(".jdfjs-page").getBoundingClientRect();
      // every control stays within its own element box (no fixed min-heights ballooning over the printed cell)
      const overflowing = all.filter((x) => x.i.height > x.f.height + 2 || x.i.width > x.f.width + 2).length;
      return { compact: c.length, tallest: overflowing, inside: inputs.every((r) => r.left >= page.left - 1 && r.right <= page.right + 1 && r.top >= page.top - 1 && r.bottom <= page.bottom + 1), errors: 0 };
    });
    expect(herr.length === 0, "jdf.js: no errors");
    expect(h.compact >= 200, `jdf.js: ${h.compact} compact widgets`);
    expect(h.tallest === 0, `jdf.js: ${h.tallest} controls overflow their element box`);
    expect(h.inside, "jdf.js: every widget inside the page");
    await hp.locator(".jdfjs-page-wrapper").first().screenshot({ path: path.join(outDir, "hcfa-jdfjs.png") });
    await hp.close();
    const { p, errors: rerr } = await openInReader(hcfa);
    const r = await p.evaluate(() => { const c = document.querySelectorAll(".jdfjs-form-compact").length; const big = [...document.querySelectorAll(".jdfjs-form-field")].filter((f) => { const i = f.querySelector("input, textarea, select"); if (!i) return false; const a = f.getBoundingClientRect(), b = i.getBoundingClientRect(); return b.height > a.height + 2 || b.width > a.width + 2; }).length; return { c, big }; });
    expect(rerr.length === 0 && r.c >= 200 && r.big === 0, `reader: ${r.c} compact widgets, ${r.big} controls overflow their box (${rerr.slice(0, 1).join("")})`);
    await p.locator(".jdf-page").first().screenshot({ path: path.join(outDir, "hcfa-reader.png") });
    await p.close();
  } else console.log("  · ref_docs/ HCFA form not present — imported-form checks skipped");
} finally {
  await browser.close(); srvRepo.kill(); srvReader.kill();
}
console.log(`\nforms: ${pass} passed, ${fail} failed  (screenshots in ${path.relative(repo, outDir)}/)`);
process.exit(fail ? 1 : 0);
