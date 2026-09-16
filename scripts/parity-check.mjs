#!/usr/bin/env node
// Three-surface parity gate. Fails (exit 1) when any JDF element type or any
// fixture is not handled identically by the CLI, jdf.js and the desktop reader.
//
//   node scripts/parity-check.mjs            # static checks + CLI validate + browser render
//   node scripts/parity-check.mjs --static   # static checks only (fast, no browser)
//
// What it proves, per element type in spec/jdf-schema.json:
//   1. types.ts, jdf.js renderer, reader renderer, Rust valid_types / extract_text /
//      draw_element, reader makeBlankElement + Insert bar, and `jdf chunk` all know it.
//   2. At least one fixture in spec/examples uses it.
// Per fixture in spec/examples + docs/examples (.jdf / .jdfx):
//   3. `jdf validate` passes.
//   4. jdf.js renders it in Chrome: no page error, no "[unknown:" marker, every top-level
//      element present with the right type.
//   5. The reader frontend (apps/reader/dist, Tauri IPC mocked) renders it the same way.
// release.sh runs this before building anything; a red line here means "do not ship".
import fs from "node:fs";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const staticOnly = process.argv.includes("--static");
const read = (p) => fs.readFileSync(path.join(repo, p), "utf8");
const failures = [];
const ok = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures.push(msg); return cond; };

// ── 1. element types from the schema (source of truth) ───────────────────────
const schema = JSON.parse(read("spec/jdf-schema.json"));
const types = new Set();
(function walk(o) {
  if (Array.isArray(o)) return o.forEach(walk);
  if (!o || typeof o !== "object") return;
  if (o.properties?.type?.const) types.add(o.properties.type.const);
  Object.values(o).forEach(walk);
})(schema);
console.log(`element types in schema: ${[...types].sort().join(", ")}`);

const surfaces = [
  ["types.ts",            "packages/jdf-core/src/types.ts",                        (t) => new RegExp(`type:\\s*"${t}"`)],
  ["jdf.js renderer",     "jdfjs/src/renderers/element.ts",                        (t) => new RegExp(`case "${t}"`)],
  ["reader renderer",     "apps/reader/src/components/viewer/ElementRenderer.tsx", (t) => new RegExp(`"${t}"`)],
  ["Rust valid_types",    "apps/reader/src-tauri/src/commands/mod.rs",             (t, src) => { const m = src.match(/let valid_types = \[([\s\S]*?)\];/); return m && m[1].includes(`"${t}"`) ? /./ : /(?!)/; }],
  ["Rust draw_element",   "apps/reader/src-tauri/src/commands/mod.rs",             (t, src) => { const m = src.match(/fn draw_element[\s\S]*?\n}\n/); return m && m[0].includes(`"${t}"`) ? /./ : /(?!)/; }],
  // extract_text (search) is field-based, not type-based: every text-carrying field of every type must be read.
  ["Rust extract_text",   "apps/reader/src-tauri/src/commands/mod.rs",             (t, src) => { const m = src.match(/fn extract_text[\s\S]*?\n}\n/); const need = { text: ["content"], richtext: ["runs"], list: ["items"], table: ["rows"], collapsible: ["title"], video: ["transcript", "chapters", "title"], image: ["caption", "ocr"], input: ["label", "value"], textarea: ["label", "value"], select: ["label", "value"], checkbox: ["label"], signature: ["label"], shape: [], toc: [] }[t] || []; return m && need.every((k) => m[0].includes(`"${k}"`)) ? /./ : /(?!)/; }],
  ["reader makeBlankElement", "apps/reader/src/edit/mutations.ts",                 (t) => new RegExp(`case "${t}"`)],
  ["reader Insert bar",   "apps/reader/src/components/shared/InsertBar.tsx",       (t) => new RegExp(`type: "${t}"`)],
  ["jdf chunk",           "tools/jdf-cli/src/commands/chunk.ts",                   (t) => new RegExp(`"${t}"`)],
];
const fixturesDir = ["spec/examples", "docs/examples"];
const fixtures = fixturesDir.flatMap((d) => fs.readdirSync(path.join(repo, d)).filter((f) => /\.jdfx?$/.test(f)).map((f) => path.join(d, f)));
const specTypes = new Set();
for (const f of fixtures.filter((f) => f.startsWith("spec/") && f.endsWith(".jdf"))) {
  (function walk(o) { if (Array.isArray(o)) return o.forEach(walk); if (!o || typeof o !== "object") return; if (typeof o.type === "string" && types.has(o.type)) specTypes.add(o.type); Object.values(o).forEach(walk); })(JSON.parse(read(f)));
}
for (const t of [...types].sort()) {
  const missing = surfaces.filter(([, file, re]) => { const src = read(file); const r = re(t, src); return !r.test(src); }).map(([name]) => name);
  ok(missing.length === 0, `type "${t}" handled everywhere${missing.length ? ` — MISSING in: ${missing.join(", ")}` : ""}`);
  ok(specTypes.has(t), `type "${t}" exercised by a fixture in spec/examples`);
}

// ── 3. CLI validate every fixture ────────────────────────────────────────────
for (const f of fixtures) {
  const r = spawnSync("npx", ["tsx", "src/index.ts", "validate", path.join(repo, f)], { cwd: path.join(repo, "tools/jdf-cli"), encoding: "utf8" });
  ok(r.status === 0, `jdf validate ${f}${r.status === 0 ? "" : `\n${(r.stdout + r.stderr).trim().split("\n").slice(-6).join("\n")}`}`);
}

if (staticOnly) finish();

// ── 4/5. browser render in jdf.js and the reader ─────────────────────────────
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(path.join(repo, "node_modules/.pnpm/node_modules/playwright"))); } catch { ({ chromium } = await import("playwright")); }
for (const [what, p] of [["jdf.js bundle", "jdfjs/dist/jdfjs.js"], ["reader build", "apps/reader/dist/index.html"]]) {
  if (!fs.existsSync(path.join(repo, p))) { failures.push(`${what} missing (${p}) — run the build first`); console.log(`✗ ${what} missing: ${p}`); finish(); }
}
const PORT = 4173;
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: repo, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const readerServer = spawn("python3", ["-m", "http.server", String(PORT + 1), "--bind", "127.0.0.1"], { cwd: path.join(repo, "apps/reader/dist"), stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

// Expected top-level elements per fixture (header/footer elements excluded — both renderers put them in their own containers).
async function expectedTopLevel(f) {
  let doc;
  if (f.endsWith(".jdfx")) {
    const JSZip = require(path.join(repo, "node_modules/.pnpm/node_modules/jszip"));
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(repo, f)));
    doc = JSON.parse(await zip.file("document.json").async("string"));
  } else doc = JSON.parse(read(f));
  return doc.pages.flatMap((p) => (p.elements || []).map((e) => e.type));
}
const tally = (arr) => arr.slice().sort().join(",");

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const f of fixtures) {
    const expected = await expectedTopLevel(f);

    // jdf.js
    {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(m.text()); });
      const html = `<!doctype html><html><head><link rel="stylesheet" href="/jdfjs/dist/jdfjs.css"><script type="module" src="/jdfjs/dist/jdfjs.js"></script></head><body><jdf src="/${f}" height="800"></jdf></body></html>`;
      fs.writeFileSync(path.join(repo, ".parity-page.html"), html);
      await page.goto(`http://127.0.0.1:${PORT}/.parity-page.html`);
      try { await page.waitForSelector(".jdfjs-page", { timeout: 15000 }); await page.waitForTimeout(400); } catch { errors.push("no .jdfjs-page rendered"); }
      const got = await page.evaluate(() => [...document.querySelectorAll(".jdfjs-page-content [data-jdf-type]")].filter((n) => !n.parentElement.closest("[data-jdf-type]")).map((n) => n.dataset.jdfType));
      const unknown = await page.evaluate(() => document.body.innerText.match(/\[unknown:[^\]]*\]/g) || []);
      ok(errors.length === 0 && unknown.length === 0 && tally(got) === tally(expected), `jdf.js renders ${f} (${expected.length} elements)${errors.length ? ` — errors: ${errors.slice(0, 2).join(" | ")}` : ""}${unknown.length ? ` — ${unknown.join(" ")}` : ""}${tally(got) !== tally(expected) ? ` — got [${tally(got)}] expected [${tally(expected)}]` : ""}`);
      await page.close();
    }

    // reader (Tauri IPC mocked: read_text_file / read_binary_file serve the fixture)
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(m.text()); });
      const abs = path.join(repo, f);
      const bytes = fs.readFileSync(abs);
      await page.addInitScript(({ abs, b64, isBinary }) => {
        const bin = () => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        window.__TAURI_INTERNALS__ = {
          metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" }, windows: [{ label: "main" }] },
          transformCallback: (cb) => cb, convertFileSrc: (p) => p,
          async invoke(cmd, args) {
            if (cmd === "read_text_file" && args?.path === abs && !isBinary) return new TextDecoder().decode(bin());
            if (cmd === "read_binary_file" && args?.path === abs) return bin().buffer;
            if (cmd === "save_document" || cmd === "write_binary_file" || cmd === "consume_pending_file") return null;
            throw new Error(`mock: unhandled ${cmd}`);
          },
        };
        localStorage.setItem("jdf-recent", JSON.stringify([abs]));
      }, { abs, b64: bytes.toString("base64"), isBinary: f.endsWith(".jdfx") });
      await page.goto(`http://127.0.0.1:${PORT + 1}/`);
      try {
        await page.getByText(path.basename(f), { exact: true }).click();
        await page.waitForSelector(".jdf-page", { timeout: 15000 });
        await page.waitForTimeout(500);
      } catch (e) { errors.push(`open failed: ${String(e.message).split("\n")[0]}`); }
      const got = await page.evaluate(() => [...document.querySelectorAll(".jdf-page [data-jdf-type]")].filter((n) => !n.parentElement.closest("[data-jdf-type]") && (() => { try { const p = JSON.parse(n.dataset.elementPath || "[]"); return p.length === 4 && p[0] === "pages" && p[2] === "elements"; } catch { return false; } })()).map((n) => n.dataset.jdfType));
      const unknown = await page.evaluate(() => document.body.innerText.match(/\[unknown:[^\]]*\]/g) || []);
      const toast = await page.evaluate(() => document.body.innerText.match(/Open failed[^\n]*/)?.[0] || "");
      ok(errors.length === 0 && unknown.length === 0 && !toast && tally(got) === tally(expected), `reader renders ${f} (${expected.length} elements)${errors.length ? ` — errors: ${errors.slice(0, 2).join(" | ")}` : ""}${unknown.length ? ` — ${unknown.join(" ")}` : ""}${toast ? ` — ${toast}` : ""}${tally(got) !== tally(expected) ? ` — got [${tally(got)}] expected [${tally(expected)}]` : ""}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.kill(); readerServer.kill();
  fs.rmSync(path.join(repo, ".parity-page.html"), { force: true });
}
finish();

function finish() {
  if (failures.length) { console.error(`\n${failures.length} parity check(s) FAILED — do not release.`); process.exit(1); }
  console.log("\nAll parity checks passed: CLI, jdf.js and the desktop reader agree on every element type and fixture.");
  process.exit(0);
}
