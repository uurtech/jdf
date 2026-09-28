#!/usr/bin/env bash
# One-shot JDF-vs-PDF RAG benchmark run on a fresh (GPU) machine.
#
#   git clone git@github.com:uurtech/jdf.git && cd jdf/bench
#   ./run_gpu.sh                 # venv + CUDA torch + deps, then rag_bench + cost_bench
#   ./run_gpu.sh --fresh         # also wipe cached embeddings so every vector is computed on the GPU
#   EMBEDDERS=st:BAAI/bge-large-en-v1.5 FILES=10000 ./run_gpu.sh
#
# What it does, in order:
#   1. picks Python 3.12/3.13 (PyTorch has no 3.14 wheels), creates ./.venv
#   2. installs the CUDA build of torch that matches `nvidia-smi` (cu124 / cu121 / cu118)
#   3. installs requirements.txt (pinned: sentence-transformers<6, transformers<5 for nomic, einops)
#   4. refuses to continue if torch does not see the GPU
#   5. python rag_bench.py  → results/latest.json      (prints "embedder …: cuda:0 (<GPU>)" per model)
#   6. python cost_bench.py → results/cost-latest.json
# Afterwards: git add results/*.json && git commit && git push; on the Mac `pnpm --filter @jdf/bench render`.
set -euo pipefail
cd "$(dirname "$0")"

FRESH=0
for a in "$@"; do [[ "$a" == "--fresh" ]] && FRESH=1; done
EMBEDDERS="${EMBEDDERS:-st:BAAI/bge-small-en-v1.5,st:sentence-transformers/all-MiniLM-L6-v2,st:BAAI/bge-base-en-v1.5,st:nomic-ai/nomic-embed-text-v1.5}"
FILES="${FILES:-1000}"

# ── 1. Python ───────────────────────────────────────────────────────────────
PY=""
for c in python3.13 python3.12 python3; do
  if command -v "$c" >/dev/null 2>&1; then PY="$(command -v "$c")"; break; fi
done
[[ -n "$PY" ]] || { echo "✗ no python3 found"; exit 1; }
PYVER="$("$PY" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
echo "→ python: $PY ($PYVER)"
if [[ "$PYVER" == "3.14" ]]; then
  echo "⚠  Python 3.14 has no PyTorch CUDA wheels yet — install python3.12 (apt install python3.12 python3.12-venv) and re-run"
fi
if [[ ! -d .venv ]]; then "$PY" -m venv .venv; fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install -q --upgrade pip

# ── 2. CUDA torch ───────────────────────────────────────────────────────────
if command -v nvidia-smi >/dev/null 2>&1; then
  CUDA_VER="$(nvidia-smi 2>/dev/null | grep -o 'CUDA Version: [0-9.]*' | grep -o '[0-9.]*' || true)"
  echo "→ nvidia-smi: CUDA $CUDA_VER"
  IDX="cu124"
  case "$CUDA_VER" in
    11.*) IDX="cu118" ;;
    12.0*|12.1*|12.2*|12.3*) IDX="cu121" ;;
  esac
  HAS_CUDA="$(python -c 'import torch; print(int(torch.cuda.is_available()))' 2>/dev/null || echo 0)"
  if [[ "$HAS_CUDA" != "1" ]]; then
    echo "→ installing torch from https://download.pytorch.org/whl/$IDX"
    python -m pip install -q torch --index-url "https://download.pytorch.org/whl/$IDX"
  fi
else
  echo "⚠  nvidia-smi not found — no NVIDIA GPU here; the benchmark will run on CPU/MPS"
fi

# ── 3. deps ─────────────────────────────────────────────────────────────────
python -m pip install -q -r requirements.txt
command -v pdftotext >/dev/null 2>&1 || echo "⚠  pdftotext not on PATH (apt install poppler-utils) — that PDF pipeline will be skipped"

# ── 4. GPU check ────────────────────────────────────────────────────────────
python - <<'EOF'
import sys, torch
print(f"→ torch {torch.__version__} · cuda available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"→ GPU: {torch.cuda.get_device_name(0)}")
elif __import__("shutil").which("nvidia-smi"):
    print("✗ nvidia-smi exists but torch cannot see the GPU — CPU-only torch or driver/CUDA mismatch (see requirements.txt)")
    sys.exit(1)
EOF

# ── 5. accuracy benchmark ───────────────────────────────────────────────────
if [[ "$FRESH" == "1" ]]; then rm -f .cache/emb-st_*.json; echo "→ embedding cache cleared (--fresh)"; fi
echo "→ rag_bench.py --embedder $EMBEDDERS"
python rag_bench.py --embedder "$EMBEDDERS"

# ── 6. cost benchmark ───────────────────────────────────────────────────────
echo "→ cost_bench.py --files $FILES"
python cost_bench.py --files "$FILES"

echo ""
echo "✓ done"
python - <<'EOF'
import json
d = json.load(open("results/latest.json"))
print("  machine:", d["machine"])
for e in d["embeddings"]:
    print(f"  {e['provider']}:{e['model']} — {e['version']}")
EOF
echo "  results/latest.json · results/cost-latest.json"
echo "  next: git add results/latest.json results/cost-latest.json && git commit -m 'bench: GPU run' && git push"
echo "        then on the Mac: pnpm --filter @jdf/bench render"
