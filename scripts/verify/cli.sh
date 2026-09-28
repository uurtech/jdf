#!/usr/bin/env bash
# CLI end-to-end smoke: every `jdf` verb on real inputs, checked for the things a
# pipeline relies on — schema-valid output, deterministic conversion and chunking,
# form values surviving PDF → JDF, .jdfx bundles round-tripping, `jdf rag` writing
# an index, and (when a local Ollama is reachable) `jdf embed` producing vectors.
#
#   bash scripts/verify/cli.sh            # all of it
#   JDF_VERIFY_NO_EMBED=1 …               # skip the Ollama step
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/tools/jdf-cli"
OUT="${JDF_VERIFY_OUT:-$ROOT/verify-out}/cli"; rm -rf "$OUT"; mkdir -p "$OUT"
jdf() { npx --no-install tsx src/index.ts "$@"; }
pass=0; fail=0
ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
bad()  { echo "  ✗ $1"; fail=$((fail+1)); }
check() { local name="$1"; shift; if "$@" >"$OUT/.last.log" 2>&1; then ok "$name"; else bad "$name"; sed 's/^/      /' "$OUT/.last.log" | tail -8; fi; }
sha() { shasum -a 256 "$1" | awk '{print $1}'; }

echo "→ validate every shipped fixture"
for f in "$ROOT"/spec/examples/*.jdf "$ROOT"/spec/examples/*.jdfx "$ROOT"/docs/examples/*.jdf "$ROOT"/docs/examples/*.jdfx; do
  [[ -f "$f" ]] || continue
  check "validate $(basename "$f")" jdf validate "$f"
done

echo "→ convert PDF → JDF (sample.pdf) — valid, deterministic, tables present"
check "convert sample.pdf" jdf convert "$ROOT/spec/examples/sample.pdf" -o "$OUT/sample.jdf" --json
check "validate converted sample.jdf" jdf validate "$OUT/sample.jdf"
jdf convert "$ROOT/spec/examples/sample.pdf" -o "$OUT/sample-2.jdf" --json >/dev/null 2>&1
if [[ "$(sha "$OUT/sample.jdf")" == "$(sha "$OUT/sample-2.jdf")" ]]; then ok "convert is deterministic (identical bytes on a second run)"; else bad "convert produced different output on a second run"; fi
node -e '
const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const types = {}; let ids = 0, total = 0;
for (const p of d.pages) for (const e of p.elements) { types[e.type] = (types[e.type] || 0) + 1; total++; if (e.id) ids++; }
if (d.pages.length !== 30) throw new Error(`expected 30 pages, got ${d.pages.length}`);
if (!types.table || types.table < 4) throw new Error(`expected tables, got ${JSON.stringify(types)}`);
if (ids !== total) throw new Error(`every element needs an id (${ids}/${total})`);
if (!d.pages[0].elements.some((e) => e.type === "text" && e.height)) throw new Error("text elements need a height");
console.log(`30 pages, ${total} elements, ${types.table} tables, ids on all`);
' "$OUT/sample.jdf" >"$OUT/.last.log" 2>&1 && ok "sample.jdf structure ($(cat "$OUT/.last.log"))" || { bad "sample.jdf structure"; cat "$OUT/.last.log"; }

echo "→ convert PDF with AcroForm → form elements keep their values"
if [[ -f "$ROOT/ref_docs/432938035-HCFA1500-10-Arial-Blue-1155-1.pdf" ]]; then
  check "convert HCFA-1500" jdf convert "$ROOT/ref_docs/432938035-HCFA1500-10-Arial-Blue-1155-1.pdf" -o "$OUT/hcfa.jdf" --json
  node -e '
const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const inputs = d.pages[0].elements.filter((e) => ["input","textarea","checkbox","select"].includes(e.type));
if (inputs.length < 200) throw new Error(`expected ≥200 form fields, got ${inputs.length}`);
if (inputs.some((e) => e.label)) throw new Error("imported widgets must not carry labels (they render compact)");
const tables = d.pages[0].elements.filter((e) => e.type === "table").length;
if (tables) throw new Error(`a form page must not be turned into tables (${tables})`);
console.log(`${inputs.length} fields, 0 tables`);
' "$OUT/hcfa.jdf" >"$OUT/.last.log" 2>&1 && ok "HCFA form fields ($(cat "$OUT/.last.log"))" || { bad "HCFA form fields"; cat "$OUT/.last.log"; }
else echo "  · ref_docs/ HCFA form not present — skipped"; fi

echo "→ convert JSON → JDF (agent output) and Markdown → JDF"
cat >"$OUT/agent.json" <<'EOF'
[
  { "type": "text", "content": "Quarterly summary", "heading": 1 },
  { "type": "text", "content": "Revenue grew 12% quarter over quarter." },
  { "type": "table", "headers": ["Region", "Revenue"], "rows": [["EMEA", "$4.2M"], ["APAC", "$3.1M"]] },
  { "type": "list", "items": ["Hire two SREs", "Ship v2"] }
]
EOF
check "convert agent.json" jdf convert "$OUT/agent.json" -o "$OUT/agent.jdf"
check "validate agent.jdf" jdf validate "$OUT/agent.jdf"
printf '# Title\n\nA paragraph with **bold** and *italic*.\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n---\n' >"$OUT/doc.md"
check "convert doc.md" jdf convert "$OUT/doc.md" -o "$OUT/doc.jdf"
check "validate doc.jdf" jdf validate "$OUT/doc.jdf"
node -e '
const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const t = new Set(d.pages.flatMap((p) => p.elements.map((e) => e.type)));
for (const need of ["richtext", "list", "table"]) if (!t.has(need) && !(need === "richtext" && t.has("text"))) throw new Error(`markdown lost ${need}: ${[...t]}`);
' "$OUT/doc.jdf" >"$OUT/.last.log" 2>&1 && ok "markdown keeps headings/lists/tables" || { bad "markdown element set"; cat "$OUT/.last.log"; }

echo "→ invalid JSON must be rejected (CI gate for model output)"
printf '{"$jdf":"1.0.0","meta":{},"pages":[{"elements":[{"type":"text"}]}]}' >"$OUT/bad.json"
if jdf convert "$OUT/bad.json" -o "$OUT/bad.jdf" >"$OUT/.last.log" 2>&1; then bad "convert accepted an invalid document"; else ok "convert rejects an invalid document (non-zero exit)"; fi

echo "→ .jdfx bundle round-trip (PDF with images → jdfx → validate)"
check "convert sample.pdf → jdfx" jdf convert "$ROOT/spec/examples/sample.pdf" -o "$OUT/sample.jdfx"
check "validate sample.jdfx" jdf validate "$OUT/sample.jdfx"
check "validate spec video.jdfx" jdf validate "$ROOT/spec/examples/video.jdfx"

echo "→ chunk: deterministic, section strategy, inline index"
check "chunk sample.jdf (jsonl)" jdf chunk "$OUT/sample.jdf" -o "$OUT/chunks.jsonl"
jdf chunk "$OUT/sample.jdf" -o "$OUT/chunks-2.jsonl" >/dev/null 2>&1
if [[ "$(sha "$OUT/chunks.jsonl")" == "$(sha "$OUT/chunks-2.jsonl")" ]]; then ok "chunk is deterministic (same hashes twice)"; else bad "chunk hashes differ between runs — embed --incremental would break"; fi
node -e '
const lines = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
if (lines.length < 20) throw new Error(`too few chunks: ${lines.length}`);
for (const c of lines) { if (!c.id || !c.text || !c.hash) throw new Error("chunk missing id/text/hash"); }
if (lines.some((c) => /^[A-Z][^.]{0,40}$/.test(c.text.trim()))) throw new Error("a title-only chunk slipped through (retrieval magnet)");
console.log(`${lines.length} chunks`);
' "$OUT/chunks.jsonl" >"$OUT/.last.log" 2>&1 && ok "chunk content ($(cat "$OUT/.last.log"))" || { bad "chunk content"; cat "$OUT/.last.log"; }
check "chunk --format inline" jdf chunk "$OUT/sample.jdf" --format inline -o "$OUT/sample.indexed.jdf"
check "validate inline-indexed document" jdf validate "$OUT/sample.indexed.jdf"

echo "→ rag over a folder (no embedding) writes .jdf-rag/index.jsonl"
mkdir -p "$OUT/corpus"; cp "$OUT/sample.jdf" "$OUT/agent.jdf" "$OUT/doc.jdf" "$OUT/corpus/"
check "jdf rag --no-embed" jdf rag "$OUT/corpus" --no-embed
if [[ -s "$OUT/corpus/.jdf-rag/index.jsonl" && -s "$OUT/corpus/.jdf-rag/manifest.json" ]]; then ok "rag index + manifest written ($(wc -l <"$OUT/corpus/.jdf-rag/index.jsonl" | tr -d ' ') chunks)"; else bad "rag did not write .jdf-rag/index.jsonl + manifest.json"; fi

echo "→ embed (local Ollama)"
if [[ "${JDF_VERIFY_NO_EMBED:-}" == "1" ]]; then echo "  · skipped (JDF_VERIFY_NO_EMBED=1)";
elif curl -s -m 2 "${OLLAMA_HOST:-http://localhost:11434}/api/tags" >/dev/null 2>&1; then
  if ! curl -s "${OLLAMA_HOST:-http://localhost:11434}/api/tags" | grep -q '"nomic-embed-text'; then echo "  · pulling nomic-embed-text (one-time)"; ollama pull nomic-embed-text >/dev/null 2>&1 || true; fi
  check "jdf embed --provider ollama" jdf embed "$OUT/agent.jdf" --provider ollama --no-auto-start -o "$OUT/agent.embeddings.json"
  node -e '
const e = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const vecs = e.chunks || e.embeddings || e.vectors || e;
const list = Array.isArray(vecs) ? vecs : Object.values(vecs);
const first = list.find((v) => Array.isArray(v.embedding || v.vector || v));
const dim = (first.embedding || first.vector || first).length;
if (!(dim >= 256)) throw new Error(`unexpected embedding size ${dim}`);
console.log(`${list.length} vectors × ${dim}`);
' "$OUT/agent.embeddings.json" >"$OUT/.last.log" 2>&1 && ok "embeddings ($(cat "$OUT/.last.log"))" || { bad "embeddings file shape"; cat "$OUT/.last.log"; }
  check "jdf embed --incremental (second run, unchanged → no re-embed)" jdf embed "$OUT/agent.jdf" --provider ollama --no-auto-start --incremental -o "$OUT/agent.embeddings.json"
else echo "  · Ollama not reachable at ${OLLAMA_HOST:-http://localhost:11434} — embed step skipped (start Ollama or set JDF_VERIFY_NO_EMBED=1 to silence)"; fi

echo ""
echo "cli: $pass passed, $fail failed  (artifacts in $OUT)"
[[ $fail -eq 0 ]]
