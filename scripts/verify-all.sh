#!/usr/bin/env bash
# `pnpm verify` — the whole system, locally, one command. Every surface that the
# README claims to work is exercised here; a red line means the claim is false.
#
#   pnpm verify                 everything below (≈5 min on an M-series Mac; first run longer: builds, model pulls)
#   pnpm verify -- --quick      skip the Python benchmark verification
#   JDF_VERIFY_NO_EMBED=1       skip the local-Ollama embedding step
#
# Steps (each is also runnable on its own):
#   1 typecheck            pnpm typecheck                                     TS across all packages
#   2 build                jdf.js + desktop reader dist (what the checks below render)
#   3 rust                 cargo test                                         PDF export, validate, extract_text
#   4 parity               scripts/parity-check.mjs                           every element type on every surface, forms look like forms
#   5 tables               verify:tables                                      120 tables / 100 % cells on the browser-printed corpus
#   6 order                verify:order                                       reading order on 1/2/3-column fixtures
#   7 regress              verify:regress                                     every corpus PDF converts as the committed fingerprint says
#   8 visual               scripts/verify/visual.mjs                          PDF page vs jdf.js page vs reader page, side by side, scored against baseline
#   9 cli                  scripts/verify/cli.sh                              validate / convert (pdf, json, md, jdfx) / chunk / rag / embed
#  10 forms                scripts/verify/forms.mjs                           fill the demo, download, validate, reopen in the reader; imported PDF form
#  11 bench                python rag_bench.py --verify + cost_bench.py --verify   the published numbers reproduce
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
QUICK=0; for a in "$@"; do [[ "$a" == "--quick" ]] && QUICK=1; done
export JDF_VERIFY_OUT="${JDF_VERIFY_OUT:-$ROOT/verify-out}"
mkdir -p "$JDF_VERIFY_OUT"
LOG="$JDF_VERIFY_OUT/verify.log"; : >"$LOG"

declare -a NAMES=() STATUS=() SECS=()
run() {
  local name="$1"; shift
  local t0=$(date +%s)
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "▶ $name"
  echo "════════════════════════════════════════════════════════════"
  if "$@" 2>&1 | tee -a "$LOG" | tail -n 40; then st="ok"; else st="FAIL"; fi
  # tee masks the exit status; re-read it from PIPESTATUS
  st="${PIPESTATUS[0]}"; [[ "$st" == "0" ]] && st="ok" || st="FAIL"
  NAMES+=("$name"); STATUS+=("$st"); SECS+=("$(( $(date +%s) - t0 ))")
}

for bin in node pnpm python3 pdftoppm cargo; do
  command -v "$bin" >/dev/null 2>&1 || { echo "✗ $bin not found on PATH"; exit 2; }
done
# Chrome is what Playwright drives (channel: "chrome") — the same engine the reader (WebKit aside) and the site use.
[[ -d "/Applications/Google Chrome.app" ]] || command -v google-chrome >/dev/null 2>&1 || echo "⚠  Google Chrome not found — the browser-driven steps will fail"

run "1 typecheck"  pnpm typecheck
run "2 build"      bash -c "pnpm --filter @uurtech/jdf build && pnpm --filter @jdf/reader build"
run "3 rust"       bash -c "cd apps/reader/src-tauri && cargo test"
run "4 parity"     node scripts/parity-check.mjs
run "5 tables"     pnpm --filter @jdf/pdf-import verify:tables
run "6 order"      pnpm --filter @jdf/pdf-import verify:order
run "7 regress"    pnpm --filter @jdf/pdf-import verify:regress
run "8 visual"     node scripts/verify/visual.mjs
run "9 cli"        bash scripts/verify/cli.sh
run "10 forms"     node scripts/verify/forms.mjs
if [[ "$QUICK" == "1" ]]; then
  echo ""; echo "· 11 bench skipped (--quick)"
else
  bench() {
    cd "$ROOT/bench"
    if [[ ! -d .venv ]]; then
      echo "→ creating bench/.venv (first run; a few minutes)"
      python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt
    fi
    .venv/bin/python rag_bench.py --verify --embedder none && .venv/bin/python cost_bench.py --verify
  }
  run "11 bench" bench
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "SUMMARY"
echo "════════════════════════════════════════════════════════════"
failed=0
for i in "${!NAMES[@]}"; do
  printf "  %-14s %-5s %4ss\n" "${NAMES[$i]}" "${STATUS[$i]}" "${SECS[$i]}"
  [[ "${STATUS[$i]}" == "ok" ]] || failed=$((failed+1))
done
echo ""
echo "  artifacts: $JDF_VERIFY_OUT  (visual/*.png side-by-side sheets, forms/*.png, cli/, verify.log)"
if [[ $failed -gt 0 ]]; then echo "  ✗ $failed step(s) failed"; exit 1; fi
echo "  ✓ all steps passed"
