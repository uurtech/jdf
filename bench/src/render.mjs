// Publishes bench/results/latest.json (accuracy, from rag_bench.py) and
// bench/results/cost-latest.json (cost at scale, from cost_bench.py) into
// docs/index.html, docs/docs/benchmark.html, docs/bench.json and README.md,
// between <!-- bench:NAME:start --> / <!-- bench:NAME:end --> markers.
// Never edit the generated blocks by hand — re-run the benchmarks, then this.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const acc = JSON.parse(fs.readFileSync(path.join(repo, "bench/results/latest.json"), "utf8"));
const costFile = path.join(repo, "bench/results/cost-latest.json");
const cost = fs.existsSync(costFile) ? JSON.parse(fs.readFileSync(costFile, "utf8")) : null;

const pc = (x) => `${(x * 100).toFixed(1)}%`;
// "x86_64" says nothing about a GPU box: append the accelerator recorded in the
// embedder version strings ("… · cuda:0 (NVIDIA L40S)") when there is one.
const machineLabel = (run) => {
  const embs = run.embeddings ?? (run.embedding ? [run.embedding] : []);
  const gpu = embs.map((e) => /\((NVIDIA[^)]*|AMD[^)]*|Apple[^)]*)\)/.exec(e.version || "")?.[1]).find(Boolean);
  return gpu ? `${run.machine.cpu} + ${gpu}` : run.machine.cpu;
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const int = (x) => Math.round(x).toLocaleString("en-US");
const usd = (x) => (x >= 1 ? `$${x.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : `$${x.toFixed(4)}`);
const secs = (s) => (s < 120 ? `${s.toFixed(1)} s` : s < 7200 ? `${(s / 60).toFixed(1)} min` : `${(s / 3600).toFixed(2)} h`);

// ── accuracy: retrievers & rows ─────────────────────────────────────────────
const retrievers = Object.keys(acc.pipelines[0].retrievers); // ["bm25", "dense:<model>", …]
const shortModel = (m) => m.replace(/^dense:/, "").split("/").pop().replace("-en-v1.5", "").replace("all-", "").replace("sentence-transformers/", "");
const retrieverLabel = (r) => (r === "bm25" ? "BM25 (lexical)" : shortModel(r));
const jdf = acc.pipelines.find((p) => p.id === "jdf");
const pdfs = acc.pipelines.filter((p) => p.format === "pdf");
const HEADLINE_METRIC = "recallAt1000Tok";
// Default tab = the strongest retriever (highest mean R@1k-tok across *all*
// pipelines — a statement about the embedding model, not about JDF), so the
// card opens on the model people would actually deploy. rag_bench.py records
// the first embedder as headline, which depends on the order of the --embedder
// list; every retriever stays one click away in the tabs.
const headline = retrievers.filter((r) => r !== "bm25").sort((a, b) => {
  const mean = (r) => acc.pipelines.reduce((n, p) => n + p.retrievers[r].all[HEADLINE_METRIC], 0) / acc.pipelines.length;
  return mean(b) - mean(a);
})[0] ?? acc.headline; // eslint-disable-line

// Hero rows: JDF + each PDF parser at its best config for the headline metric under the headline retriever.
function heroRows(retriever, metric) {
  const byTool = new Map();
  for (const p of pdfs) {
    const cur = byTool.get(p.tool);
    if (!cur || p.retrievers[retriever].all[metric] > cur.retrievers[retriever].all[metric]) byTool.set(p.tool, p);
  }
  const converted = acc.pipelines.find((p) => p.format === "jdf-converted");
  // Hero shows the three strongest PDF parsers so the card stays above the fold; the full tables list every pipeline.
  return [jdf, ...(converted ? [converted] : []), ...[...byTool.values()].sort((a, b) => b.retrievers[retriever].all[metric] - a.retrievers[retriever].all[metric]).slice(0, 3)];
}
const toolShort = (p) => (p.format === "jdf" ? "JDF" : p.format === "jdf-converted" ? "PDF → JDF" : `PDF · ${p.tool.split(" ")[0]}`);
const chunkDesc = (p) => (p.format === "jdf" ? "jdf chunk · section" : p.format === "jdf-converted" ? "jdf convert · jdf chunk" : p.label.replace(/^.*fixed /, "fixed ") + " chars");

const METRICS = {
  recallAt1000Tok: { label: "answer inside the first 1,000 tokens of retrieved context · higher is better", fmt: pc, higher: true },
  recall1: { label: "top-1 hit rate · higher is better", fmt: pc, higher: true },
  recall5: { label: "top-5 hit rate · higher is better", fmt: pc, higher: true },
  ctxTokensTop5: { label: "tokens handed to the LLM for the top-5 chunks · lower is better", fmt: int, higher: false },
};
const heroData = {
  date: acc.date, machine: acc.machine, corpus: acc.corpus, jdfOnly: acc.jdfOnly, headline,
  retrievers: retrievers.map((r) => ({ id: r, label: retrieverLabel(r) })),
  metrics: Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, { label: m.label, higher: m.higher }])),
  // rows[retriever] = [{name, version, jdf, values{metric}, display{metric}}]
  rows: Object.fromEntries(retrievers.map((r) => [r, heroRows(r, HEADLINE_METRIC).map((p) => ({
    id: p.id, name: toolShort(p), version: `${p.format.startsWith("jdf") ? "jdf-cli " : ""}v${p.version} · ${chunkDesc(p)}`, jdf: p.format === "jdf", converted: p.format === "jdf-converted",
    values: Object.fromEntries(Object.keys(METRICS).map((m) => [m, p.retrievers[r].all[m]])),
    display: Object.fromEntries(Object.entries(METRICS).map(([m, d]) => [m, d.fmt(p.retrievers[r].all[m])])),
  }))])),
};
const firstRows = heroData.rows[headline];
const STATIC_METRIC = "ctxTokensTop5"; // what the card shows before JS runs (and by default): fewer tokens to the LLM
const heroStatic = firstRows.map((r) => {
  const max = Math.max(...firstRows.map((x) => x.values[STATIC_METRIC]));
  return `          <li class="bench-row${r.jdf ? " is-jdf" : ""}" style="--w:${((r.values[STATIC_METRIC] / max) * 100).toFixed(1)}%"><div class="bench-name">${esc(r.name)}<span class="bench-ver">${esc(r.version)}</span></div><div class="bench-track"><div class="bench-bar"></div></div><div class="bench-time">${esc(r.display[STATIC_METRIC])}</div></li>`;
}).join("\n");
const heroTabs = retrievers.map((r) => `          <button class="bench-tab${r === headline ? " is-active" : ""}" role="tab" data-bench-retriever="${esc(r)}">${esc(retrieverLabel(r))}</button>`).join("\n");

// Full accuracy table (HTML) — one block per retriever.
function accTableHtml() {
  const best = (r, m) => Math.max(...acc.pipelines.map((p) => p.retrievers[r].all[m]));
  const cell = (p, r, m, fmt = pc) => { const v = p.retrievers[r].all[m]; return `<td${v === best(r, m) ? ' class="bench-best"' : ""}>${fmt(v)}</td>`; };
  return retrievers.map((r) => `        <h4 class="bench-table-title">${esc(r === "bm25" ? "BM25 — lexical, offline, deterministic" : `Embeddings — ${r.slice(6)}`)}</h4>
        <div class="bench-table-wrap"><table class="bench-table">
          <thead><tr><th>Pipeline</th><th>Chunks</th><th>R@1k tokens</th><th>R@2k tokens</th><th>Top-1</th><th>Top-5</th><th>MRR@10</th><th>Table cells R@1k</th><th>Ctx tokens @5</th></tr></thead>
          <tbody>
${acc.pipelines.map((p) => `            <tr${p.format === "jdf" ? ' class="is-jdf"' : p.format === "jdf-converted" ? ' class="is-conv"' : ""}><td>${esc(p.label)}</td><td>${p.chunks}</td>${cell(p, r, "recallAt1000Tok")}${cell(p, r, "recallAt2000Tok")}${cell(p, r, "recall1")}${cell(p, r, "recall5")}${cell(p, r, "mrr10", (x) => x.toFixed(3))}<td>${pc(p.retrievers[r].table.recallAt1000Tok)}</td><td>${int(p.retrievers[r].all.ctxTokensTop5)}</td></tr>`).join("\n")}
          </tbody>
        </table></div>`).join("\n");
}
const accNote = `        <p class="rag-bench-note">R@1k tokens = the answer was inside the first 1,000 tokens of retrieved context (chunk-size neutral: a 2,000-character PDF chunk “hits” more often at top-1 simply because it is a quarter of the document, and then costs 3× the tokens). Hit = right document and the chunk contains both the answer and its row/subject key. ${acc.corpus.documents} documents, ${acc.corpus.pages} pages, ${acc.corpus.questions} questions (${acc.corpus.byType.table} table cells, ${acc.corpus.byType.prose} prose, ${acc.corpus.byType.list} list). Embeddings run locally (${acc.embeddings.map((e) => `${e.model} via ${e.version}`).join("; ")}). JDF chunk hashes verified; editing one paragraph re-embeds <strong>${acc.jdfOnly.chunksReembedded} of ${acc.jdfOnly.corpusChunks}</strong> chunks. ${esc(machineLabel(acc))}, ${acc.date}.</p>`;

// ── cost table ──────────────────────────────────────────────────────────────
function costRows() {
  if (!cost) return [];
  const ek = Object.keys(cost.prices.embedding)[0], lk = Object.keys(cost.prices.llm_input)[0];
  const ret = cost.sides[0].accuracy?.retriever?.replace(/^dense:/, "") ?? "";
  const rows = [
    [`Accuracy · answer in first 1,000 tokens (${ret})`, (s) => (s.accuracy ? pc(s.accuracy.recallAt1000Tok) : "—")],
    ["Accuracy · top-1 hit", (s) => (s.accuracy ? pc(s.accuracy.recall1) : "—")],
    ["Chunks", (s) => int(s.chunks)],
    ["Embedding tokens, initial index", (s) => int(s.embedTokens)],
    [`Embedding cost · ${cost.prices.embedding[ek].label}`, (s) => usd(s.embedUsd[ek])],
    ...(cost.embedding ? [[`Local embedding time · ${cost.embedding.model.split("/").pop()} (measured throughput)`, (s) => secs(s.localEmbedSeconds)]] : []),
    ["Vector-store payload", (s) => `${(s.chunkStoreBytes / 1e6).toFixed(1)} MB`],
    ["Re-embed tokens when one paragraph changes in every document", (s) => int(s.reindex.tokensAllDocsEdited)],
    [`Re-index cost · ${cost.prices.embedding[ek].label}`, (s) => usd(s.reindex.usd[ek])],
    [`LLM input tokens per ${int(cost.queries)} queries (top-5 context)`, (s) => (s.query ? int(s.query.inputTokens) : "—")],
    [`LLM input cost · ${cost.prices.llm_input[lk].label}`, (s) => (s.query ? usd(s.query.usd[lk]) : "—")],
  ];
  return rows;
}
const costSides = cost ? cost.sides : [];
const costTableHtml = cost ? `        <div class="bench-table-wrap"><table class="bench-table bench-cost">
          <thead><tr><th>Per ${int(cost.files)} documents</th>${costSides.map((s) => `<th${s.id === "jdf" ? ' class="is-jdf"' : ""}>${esc(s.label)}</th>`).join("")}</tr></thead>
          <tbody>
${costRows().map(([name, f]) => `            <tr><td>${esc(name)}</td>${costSides.map((s) => `<td${s.id === "jdf" ? ' class="is-jdf"' : ""}>${f(s)}</td>`).join("")}</tr>`).join("\n")}
          </tbody>
        </table></div>
        <p class="rag-bench-note">${int(cost.files)} files per format = the ${cost.corpusDocuments}-document corpus cycled. Tokens are counted from the chunks each pipeline produces (ceil(chars/4), both sides); embedding time is measured throughput on ${esc(machineLabel(cost))} (${cost.date}) applied to the totals. Prices from <code>bench/prices.json</code> (as of ${esc(Object.values(cost.prices.embedding)[0].as_of)}); edit it for your provider — the benchmark never calls a paid API. The PDF column is the PDF pipeline that scored best in the accuracy run. <strong>Scaling:</strong> figures are measured at ${int(cost.files)} documents and ${int(cost.queries)} queries; anything at other volumes (10,000 documents, 10M queries) is a linear estimate, not a measurement — index and re-index costs scale with documents, query cost scales with questions asked. Re-index: JDF re-embeds only chunks whose content hash changed (<code>jdf embed --incremental</code>); a PDF has no chunk identity, so an edit means re-chunking and re-embedding the whole document.</p>` : "";

// Cost summary for the hero card (JDF vs best-accuracy PDF parser = first PDF side).
const pdfCost = costSides.find((s) => s.id !== "jdf");
const jdfCost = costSides.find((s) => s.id === "jdf");
const costData = cost && pdfCost ? {
  files: cost.files, ek: Object.keys(cost.prices.embedding)[0], lk: Object.keys(cost.prices.llm_input)[0],
  embedLabel: cost.prices.embedding[Object.keys(cost.prices.embedding)[0]].label, llmLabel: cost.prices.llm_input[Object.keys(cost.prices.llm_input)[0]].label,
  jdf: { acc: jdfCost.accuracy?.recallAt1000Tok, tokens: jdfCost.embedTokens, usd: jdfCost.embedUsd[Object.keys(cost.prices.embedding)[0]], reindexUsd: jdfCost.reindex.usd[Object.keys(cost.prices.embedding)[0]], queryUsd: jdfCost.query?.usd[Object.keys(cost.prices.llm_input)[0]] },
  pdf: { label: pdfCost.label, acc: pdfCost.accuracy?.recallAt1000Tok, tokens: pdfCost.embedTokens, usd: pdfCost.embedUsd[Object.keys(cost.prices.embedding)[0]], reindexUsd: pdfCost.reindex.usd[Object.keys(cost.prices.embedding)[0]], queryUsd: pdfCost.query?.usd[Object.keys(cost.prices.llm_input)[0]] },
} : null;

function replaceBlock(text, name, body) {
  const a = `<!-- bench:${name}:start -->`, b = `<!-- bench:${name}:end -->`;
  const i = text.indexOf(a), j = text.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`markers for ${name} not found`);
  return text.slice(0, i + a.length) + "\n" + body + "\n" + text.slice(j);
}

// docs/index.html
const indexPath = path.join(repo, "docs/index.html");
let html = fs.readFileSync(indexPath, "utf8");
html = replaceBlock(html, "hero", heroStatic);
html = replaceBlock(html, "tabs", heroTabs);
html = replaceBlock(html, "data", JSON.stringify({ ...heroData, cost: costData }));
html = replaceBlock(html, "table", accTableHtml() + "\n" + accNote);
html = replaceBlock(html, "cost", costTableHtml);
fs.writeFileSync(indexPath, html);

// docs/docs/benchmark.html
const benchPage = path.join(repo, "docs/docs/benchmark.html");
let page = fs.readFileSync(benchPage, "utf8");
page = replaceBlock(page, "table", accTableHtml() + "\n" + accNote);
page = replaceBlock(page, "cost", costTableHtml);
fs.writeFileSync(benchPage, page);

// docs/bench.json
fs.writeFileSync(path.join(repo, "docs/bench.json"), JSON.stringify({ accuracy: { ...acc, headline }, cost }, null, 2) + "\n");

// README.md
const readmePath = path.join(repo, "README.md");
let md = fs.readFileSync(readmePath, "utf8");
const mdAcc = [
  `| Pipeline | Chunks | ${retrievers.map((r) => `${retrieverLabel(r)} R@1k tok`).join(" | ")} | ${retrieverLabel(headline)} top-1 | Ctx tokens @5 |`,
  `|---|---:|${retrievers.map(() => "---:").join("|")}|---:|---:|`,
  ...acc.pipelines.map((p) => { const b = (s) => (p.format === "jdf" ? `**${s}**` : p.format === "jdf-converted" ? `*${s}*` : s); return `| ${b(p.label)} | ${p.chunks} | ${retrievers.map((r) => b(pc(p.retrievers[r].all.recallAt1000Tok))).join(" | ")} | ${b(pc(p.retrievers[headline].all.recall1))} | ${int(p.retrievers[headline].all.ctxTokensTop5)} |`; }),
  "",
  `R@1k tok = answer found within the first 1,000 tokens of retrieved context (chunk-size neutral). ${acc.corpus.documents} documents / ${acc.corpus.pages} pages / ${acc.corpus.questions} questions. All embeddings local. Editing one paragraph re-embeds **${acc.jdfOnly.chunksReembedded} of ${acc.jdfOnly.corpusChunks}** JDF chunks; a PDF pipeline re-embeds the whole document. ${machineLabel(acc)}, ${acc.date}. Full tables incl. top-1/top-5/MRR per model: [\`bench/results/report.md\`](bench/results/report.md).`,
].join("\n");
md = replaceBlock(md, "results", mdAcc);
if (cost) {
  const mdCost = [
    `| Per ${int(cost.files)} documents | ${costSides.map((s) => s.label).join(" | ")} |`,
    `|---|${costSides.map(() => "---:").join("|")}|`,
    ...costRows().map(([name, f]) => `| ${name} | ${costSides.map((s) => (s.id === "jdf" ? `**${f(s)}**` : f(s))).join(" | ")} |`),
    "",
    `${int(cost.files)} files per format (${cost.corpusDocuments}-document corpus cycled); tokens counted from each pipeline's chunks, embedding time measured on ${machineLabel(cost)}, ${cost.date}. Other volumes (10,000 documents, 10M queries) are linear estimates, not measurements. Prices: [\`bench/prices.json\`](bench/prices.json). Method: [\`bench/README.md\`](bench/README.md).`,
  ].join("\n");
  md = replaceBlock(md, "cost", mdCost);
}
fs.writeFileSync(readmePath, md);

console.log(`rendered: ${retrievers.length} retrievers × ${firstRows.length} hero rows, ${acc.pipelines.length}-row accuracy tables${cost ? `, cost table (${costSides.length} sides)` : ""} → docs/index.html, docs/docs/benchmark.html, docs/bench.json, README.md`);
