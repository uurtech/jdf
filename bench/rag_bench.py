#!/usr/bin/env python3
"""
JDF vs PDF — RAG retrieval benchmark (standalone, Python).

    pip install -r requirements.txt
    python rag_bench.py                    # BM25 + dense (sentence-transformers, default model)
    python rag_bench.py --embedder ollama:nomic-embed-text
    python rag_bench.py --embedder none    # BM25 only, no model download
    python rag_bench.py --verify           # re-run and compare with results/latest.json

The question this answers: if the *same document* enters a RAG pipeline as a PDF
or as a JDF, which one lets the retriever find the right passage?

  PDF side   pdf -> text (PyMuPDF | pdfplumber | pypdf | pdftotext) -> fixed-size
             chunks (LangChain RecursiveCharacterTextSplitter semantics, two
             common sizes) -> retriever
  JDF side   the committed output of `jdf chunk --strategy section` in
             corpus/jdf-chunks.jsonl (section-aware chunks, tables serialised as
             "Header: value" rows, heading breadcrumb prefixed to the text that
             gets embedded) -> the same retriever

Same 24 documents (the PDFs were printed from the JDF originals by a real
browser), same 192 questions with known answers, same retrievers, same hit rule:
a retrieved chunk counts when it comes from the right document AND contains both
the answer string and its row/subject key. Higher Recall@k / MRR is better.

No network access except downloading the embedding model (Hugging Face) or
talking to a local Ollama. Nothing from the corpus leaves the machine.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
CORPUS = HERE / "corpus"
DOCS = CORPUS / "docs"
RESULTS = HERE / "results"
CACHE = HERE / ".cache"
K = 10
DEFAULT_EMBEDDER = "st:BAAI/bge-small-en-v1.5"


# ── data ────────────────────────────────────────────────────────────────────
@dataclass
class Chunk:
    id: str
    doc: str
    text: str            # what the LLM would receive
    embed_text: str      # what the retriever indexes (JDF: breadcrumb + text)
    tokens: int


@dataclass
class Pipeline:
    id: str
    label: str
    fmt: str             # "pdf" | "jdf"
    tool: str
    version: str
    chunks: list[Chunk]


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def est_tokens(s: str) -> int:
    return math.ceil(len(s) / 4)


# ── PDF text extraction (the "PDF-based RAG" side) ───────────────────────────
def extract_pymupdf(pdf: Path) -> list[str]:
    import fitz  # PyMuPDF
    with fitz.open(pdf) as d:
        return [p.get_text("text") for p in d]


def extract_pdfplumber(pdf: Path) -> list[str]:
    import pdfplumber
    with pdfplumber.open(pdf) as d:
        return [(p.extract_text() or "") for p in d.pages]


def extract_pypdf(pdf: Path) -> list[str]:
    from pypdf import PdfReader
    return [(p.extract_text() or "") for p in PdfReader(str(pdf)).pages]


def extract_pdftotext(pdf: Path) -> list[str]:
    out = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
    return [p for p in out.split("\f") if p.strip()]


def _ver(mod: str) -> str | None:
    try:
        m = __import__(mod)
        v = getattr(m, "__version__", None) or getattr(m, "VersionBind", None) or "installed"
        return str(v).split()[0]
    except Exception:
        return None


def _pdftotext_ver() -> str | None:
    if not shutil.which("pdftotext"):
        return None
    r = subprocess.run(["pdftotext", "-v"], capture_output=True, text=True)
    m = re.search(r"version\s+([\d.]+)", r.stderr + r.stdout)
    return m.group(1) if m else "installed"


EXTRACTORS = [
    # (id, label, version-getter, extractor)
    ("pymupdf", "PyMuPDF get_text()", lambda: _ver("fitz"), extract_pymupdf),
    ("pdfplumber", "pdfplumber extract_text()", lambda: _ver("pdfplumber"), extract_pdfplumber),
    ("pypdf", "pypdf extract_text()", lambda: _ver("pypdf"), extract_pypdf),
    ("pdftotext", "pdftotext -layout (poppler)", _pdftotext_ver, extract_pdftotext),
]


# ── fixed-size chunker: LangChain RecursiveCharacterTextSplitter semantics ──
SEPARATORS = ["\n\n", "\n", " ", ""]


def _split_on(text: str, seps: list[str], size: int) -> list[str]:
    sep, rest = seps[0], seps[1:]
    parts = list(text) if sep == "" else text.split(sep)
    out: list[str] = []
    for p in parts:
        if not p:
            continue
        if len(p) <= size or not rest:
            out.append(p)
        else:
            out.extend(_split_on(p, rest, size))
    if sep:
        out = [p + sep if i < len(out) - 1 else p for i, p in enumerate(out)]
    return out


def split_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    chunks: list[str] = []
    buf = ""
    for piece in _split_on(text, SEPARATORS, chunk_size):
        if len(buf) + len(piece) > chunk_size and buf:
            chunks.append(buf.strip())
            buf = buf[-overlap:] if overlap > 0 else ""
        buf += piece
    if buf.strip():
        chunks.append(buf.strip())
    return chunks


# ── retrievers ──────────────────────────────────────────────────────────────
_TOKEN_RE = re.compile(r"[^a-z0-9]+")


def tokenize(s: str) -> list[str]:
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return [t for t in _TOKEN_RE.split(s) if t]


class BM25:
    """Okapi BM25, k1=1.5, b=0.75 — deterministic, no dependencies."""

    def __init__(self, chunks: list[Chunk], k1: float = 1.5, b: float = 0.75):
        self.chunks, self.k1, self.b = chunks, k1, b
        self.tf: list[Counter] = []
        self.df: Counter = Counter()
        self.len: list[int] = []
        for c in chunks:
            toks = tokenize(c.embed_text)  # index what the embedder sees
            tf = Counter(toks)
            self.tf.append(tf)
            self.df.update(tf.keys())
            self.len.append(len(toks))
        self.avg = sum(self.len) / max(1, len(chunks))

    def search(self, query: str, k: int) -> list[Chunk]:
        n = len(self.chunks)
        q = set(tokenize(query))
        scored = []
        for i, c in enumerate(self.chunks):
            s = 0.0
            for t in q:
                f = self.tf[i].get(t)
                if not f:
                    continue
                df = self.df[t]
                idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
                s += idf * (f * (self.k1 + 1)) / (f + self.k1 * (1 - self.b + self.b * self.len[i] / self.avg))
            scored.append((-s, c.id, c))
        scored.sort(key=lambda x: (x[0], x[1]))
        return [c for _, _, c in scored[:k]]


class Embedder:
    """`st:<hf-model>` via sentence-transformers or `ollama:<model>` via a local Ollama. Vectors cached by content hash."""

    def __init__(self, spec: str):
        self.provider, _, self.model = spec.partition(":")
        if self.provider not in ("st", "ollama") or not self.model:
            raise SystemExit(f"--embedder must be st:<model>, ollama:<model> or none (got {spec!r})")
        CACHE.mkdir(exist_ok=True)
        self.cache_file = CACHE / f"emb-{re.sub(r'[^a-zA-Z0-9._-]', '_', spec)}.json"
        self.cache: dict[str, list[float]] = json.loads(self.cache_file.read_text()) if self.cache_file.exists() else {}
        self.calls = 0
        self._st = None
        if self.provider == "st":
            from sentence_transformers import SentenceTransformer
            import sentence_transformers, torch
            # Device: RAG_BENCH_DEVICE (cuda / cuda:1 / mps / cpu) or whatever torch
            # picks. Printed so a GPU box can see at a glance that it is used —
            # note that cached embeddings (.cache/emb-*.json) never touch the GPU.
            device = os.environ.get("RAG_BENCH_DEVICE") or ("cuda" if torch.cuda.is_available() else "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu")
            self._st = SentenceTransformer(self.model, trust_remote_code="nomic" in self.model, device=device)
            dev = str(self._st.device)
            name = torch.cuda.get_device_name(self._st.device) if dev.startswith("cuda") else dev
            self.version = f"sentence-transformers {sentence_transformers.__version__} · torch {torch.__version__} · {dev} ({name})"
            print(f"  · embedder {spec}: {dev} ({name}); cache {self.cache_file.name}: {len(self.cache)} vectors already computed", file=sys.stderr)
        else:
            import urllib.request
            self.host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
            with urllib.request.urlopen(f"{self.host}/api/version", timeout=3) as r:
                self.version = f"Ollama {json.load(r)['version']}"

    def _prefix(self, text: str, kind: str) -> str:
        m = self.model.lower()
        if "nomic" in m:
            return ("search_document: " if kind == "document" else "search_query: ") + text
        if "bge" in m and kind == "query":
            return "Represent this sentence for searching relevant passages: " + text
        if "e5" in m:
            return ("passage: " if kind == "document" else "query: ") + text
        return text

    def _embed_raw(self, texts: list[str]) -> list[list[float]]:
        if self._st is not None:
            return self._st.encode(texts, batch_size=32, normalize_embeddings=True, show_progress_bar=False).tolist()
        import urllib.request
        req = urllib.request.Request(f"{self.host}/api/embed", data=json.dumps({"model": self.model, "input": texts}).encode(), headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.load(r)["embeddings"]

    def embed(self, texts: list[str], kind: str) -> list[list[float]]:
        inputs = [self._prefix(t, kind) for t in texts]
        missing = sorted({t for t in inputs if sha256(t.encode()) not in self.cache})
        for i in range(0, len(missing), 64):
            batch = missing[i:i + 64]
            for t, v in zip(batch, self._embed_raw(batch)):
                self.cache[sha256(t.encode())] = v
            self.calls += len(batch)
        if missing:
            self.cache_file.write_text(json.dumps(self.cache))
        return [self.cache[sha256(t.encode())] for t in inputs]


def cosine_topk(qv: list[float], vecs, chunks: list[Chunk], k: int) -> list[Chunk]:
    import numpy as np
    q = np.asarray(qv, dtype=np.float32)
    q /= (np.linalg.norm(q) or 1.0)
    sims = vecs @ q
    order = sorted(range(len(chunks)), key=lambda i: (-float(sims[i]), chunks[i].id))
    return [chunks[i] for i in order[:k]]


# ── evaluation ──────────────────────────────────────────────────────────────
_WS = re.compile(r"\s+")


def norm(s: str) -> str:
    return _WS.sub("", unicodedata.normalize("NFKC", s.lower()))


def is_hit(chunk: Chunk, q: dict) -> bool:
    if chunk.doc != q["doc"]:
        return False
    t = norm(chunk.text)
    return norm(q["answer"]) in t and norm(q["key"]) in t


BUDGETS = (1000, 2000)  # tokens of retrieved context an LLM call may spend


def rank_of(results: list[Chunk], q: dict) -> tuple[int, int]:
    """(1-based rank of the first hit or 0, cumulative tokens up to and including that hit or 0)."""
    acc = 0
    for i, c in enumerate(results):
        acc += c.tokens
        if is_hit(c, q):
            return i + 1, acc
    return 0, 0


def metrics(ranks: list[int], hit_tokens: list[int], ctx: list[int]) -> dict:
    n = max(1, len(ranks))
    r = lambda k: sum(1 for x in ranks if 0 < x <= k) / n
    out = {"n": len(ranks), "recall1": r(1), "recall3": r(3), "recall5": r(5),
           "mrr10": sum(1 / x for x in ranks if x) / n, "ctxTokensTop5": sum(ctx) / max(1, len(ctx))}
    for b in BUDGETS:
        # Chunk-size-neutral: was the answer inside the first `b` tokens of retrieved context?
        out[f"recallAt{b}Tok"] = sum(1 for t in hit_tokens if 0 < t <= b) / n
    return out


def by_type(questions: list[dict], ranks: dict[str, int], hit_tokens: dict[str, int], ctx: dict[str, int]) -> dict:
    out = {}
    for t in ("all", "table", "prose", "list"):
        qs = [q for q in questions if t == "all" or q["type"] == t]
        out[t] = metrics([ranks[q["id"]] for q in qs], [hit_tokens[q["id"]] for q in qs], [ctx[q["id"]] for q in qs])
    return out


def evaluate(p: Pipeline, questions: list[dict], embedders: list[Embedder]) -> dict:
    bm25 = BM25(p.chunks)
    retrievers: dict[str, dict] = {}
    per_q: dict[str, dict] = {q["id"]: {} for q in questions}

    def run(name: str, search):
        ranks, hit_tok, ctx = {}, {}, {}
        for q in questions:
            res = search(q)
            ranks[q["id"]], hit_tok[q["id"]] = rank_of(res, q)
            ctx[q["id"]] = sum(c.tokens for c in res[:5])
            per_q[q["id"]][name] = ranks[q["id"]]
            per_q[q["id"]][f"top1:{name}"] = res[0].id if res else ""
        retrievers[name] = by_type(questions, ranks, hit_tok, ctx)

    run("bm25", lambda q: bm25.search(q["question"], K))
    for emb in embedders:
        import numpy as np
        vecs = np.asarray(emb.embed([c.embed_text for c in p.chunks], "document"), dtype=np.float32)
        vecs /= np.maximum(np.linalg.norm(vecs, axis=1, keepdims=True), 1e-9)
        qvecs = dict(zip((q["id"] for q in questions), emb.embed([q["question"] for q in questions], "query")))
        run(f"dense:{emb.model}", lambda q, vecs=vecs, qvecs=qvecs: cosine_topk(qvecs[q["id"]], vecs, p.chunks, K))
    return {"id": p.id, "label": p.label, "format": p.fmt, "tool": p.tool, "version": p.version,
            "chunks": len(p.chunks), "avgChunkTokens": round(sum(c.tokens for c in p.chunks) / max(1, len(p.chunks))),
            "retrievers": retrievers, "perQuestion": per_q}


# ── pipelines ───────────────────────────────────────────────────────────────
def load_jdf_pipeline(manifest: dict) -> Pipeline:
    meta = json.loads((CORPUS / "jdf-chunks.meta.json").read_text())
    chunks = [Chunk(r["id"], r["doc"], r["text"], r["embed_text"], r["tokens"])
              for r in (json.loads(l) for l in (CORPUS / "jdf-chunks.jsonl").read_text().splitlines() if l.strip())]
    return Pipeline("jdf", f"JDF · jdf chunk (section, {meta['max_tokens']} tok)", "jdf", "jdf chunk", meta["cli_version"], chunks)


def load_converted_pipeline(manifest: dict) -> Pipeline | None:
    """PDF → `jdf convert` → `jdf chunk` (committed output). The realistic path for someone who only has PDFs."""
    f = CORPUS / "jdf-chunks.converted.jsonl"
    if not f.exists():
        return None
    meta = json.loads((CORPUS / "jdf-chunks.meta.json").read_text())
    chunks = [Chunk(r["id"], r["doc"], r["text"], r["embed_text"], r["tokens"])
              for r in (json.loads(l) for l in f.read_text().splitlines() if l.strip())]
    return Pipeline("jdf-converted", f"PDF → jdf convert → jdf chunk (section, {meta['max_tokens']} tok)", "jdf-converted", "jdf convert + chunk", meta["cli_version"], chunks)


def build_pdf_pipelines(doc_ids: list[str], configs: list[tuple[int, int]]) -> list[Pipeline]:
    out: list[Pipeline] = []
    for ex_id, label, ver, fn in EXTRACTORS:
        v = ver()
        if not v:
            print(f"  · {label}: not installed — skipped")
            continue
        texts = {d: "\n\n".join(fn(DOCS / f"{d}.pdf")) for d in doc_ids}
        for size, overlap in configs:
            chunks = [Chunk(f"{d}-{ex_id}-{size}-{i}", d, t, t, est_tokens(t))
                      for d in doc_ids for i, t in enumerate(split_text(texts[d], size, overlap))]
            out.append(Pipeline(f"pdf-{ex_id}-{size}", f"PDF · {label} · fixed {size}/{overlap}", "pdf", label, v, chunks))
            print(f"  · {label} {v} · {size}/{overlap}: {len(chunks)} chunks")
    return out


def jdf_only_properties(jdf: Pipeline) -> dict:
    """Hash integrity of the committed chunks + how many chunks change after a one-paragraph edit."""
    rows = [json.loads(l) for l in (CORPUS / "jdf-chunks.jsonl").read_text().splitlines() if l.strip()]
    hashes_ok = all(sha256(r["text"].encode())[:12] == r["hash"] for r in rows)
    before = {r["id"]: r["hash"] for r in rows if r["doc"] == "d01"}
    after = [json.loads(l) for l in (CORPUS / "jdf-chunks.d01-edited.jsonl").read_text().splitlines() if l.strip()]
    changed = sum(1 for r in after if before.get(r["id"]) != r["hash"])
    return {"deterministic": hashes_ok, "editedDocChunks": len(before), "chunksReembedded": changed, "corpusChunks": len(rows)}


def machine() -> dict:
    cpu = platform.processor() or platform.machine()
    if sys.platform == "darwin":
        try:
            cpu = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip() or cpu
        except Exception:
            pass
    return {"cpu": cpu, "platform": platform.platform(), "python": platform.python_version()}


# ── report ──────────────────────────────────────────────────────────────────
def report_md(o: dict) -> str:
    pc = lambda x: f"{x * 100:.1f}%"
    L = ["# JDF vs PDF — RAG retrieval benchmark", "",
         f"Generated {o['date']} on {o['machine']['cpu']} ({o['machine']['platform']}, Python {o['machine']['python']}). "
         f"Corpus: {o['corpus']['documents']} documents / {o['corpus']['pages']} pages / {o['corpus']['questions']} questions "
         f"({o['corpus']['byType']['table']} table-cell, {o['corpus']['byType']['prose']} prose, {o['corpus']['byType']['list']} list). "
         "Reproduce: `pip install -r requirements.txt && python rag_bench.py` — see bench/README.md.", "",
         f"Hit rule: {o['settings']['hitRule']}. R@1k tokens = answer found within the first 1,000 tokens of retrieved context (chunk-size neutral). PDF chunking: RecursiveCharacterTextSplitter semantics at "
         + " and ".join(f"{c['chars']}/{c['overlap']}" for c in o["settings"]["pdfChunking"]) + " chars. "
         f"JDF: `jdf chunk --strategy section --max-tokens {o['settings']['jdfMaxTokens']}` (committed output, jdf-cli {o['pipelines'][0]['version']}).", ""]
    names = [n for n in o["pipelines"][0]["retrievers"] if n != "bm25"] + ["bm25"]
    for ret in names:
        title = f"Dense retrieval — {ret[6:]}" if ret.startswith("dense:") else "BM25 (lexical, offline)"
        L += [f"## {title}", "", "| Pipeline | Chunks | Avg tokens/chunk | R@1 | R@5 | MRR@10 | R@1k tokens | R@2k tokens | Table R@1k | Prose R@1k | List R@1k | Ctx tokens @5 |",
              "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
        for p in o["pipelines"]:
            m = p["retrievers"].get(ret)
            if not m:
                continue
            a = m["all"]
            L.append(f"| {p['label']} | {p['chunks']} | {p['avgChunkTokens']} | {pc(a['recall1'])} | {pc(a['recall5'])} | {a['mrr10']:.3f} | {pc(a['recallAt1000Tok'])} | {pc(a['recallAt2000Tok'])} | "
                     f"{pc(m['table']['recallAt1000Tok'])} | {pc(m['prose']['recallAt1000Tok'])} | {pc(m['list']['recallAt1000Tok'])} | {round(a['ctxTokensTop5'])} |")
        L.append("")
    j = o["jdfOnly"]
    L += ["## JDF-only properties", "",
          f"- Chunk hashes verified: **{'yes' if j['deterministic'] else 'NO'}** (every committed chunk's `hash` is sha256(text)[:12]).",
          f"- Edit one paragraph in d01 → `jdf embed --incremental` re-embeds **{j['chunksReembedded']} of {j['corpusChunks']}** chunks in the corpus "
          f"({j['editedDocChunks']} chunks in that document). A PDF pipeline has no stable chunk identity: re-extract, re-chunk, re-embed everything.", ""]
    jdf = o["pipelines"][0]
    ret = o["headline"]
    misses = [(qid, r) for qid, r in jdf["perQuestion"].items() if not (0 < r[ret] <= 5)]
    L += [f"## Misses ({ret}, JDF pipeline)", "", "\n".join(f"- {qid} (rank {r[ret] or '—'})" for qid, r in misses) or "_none — every question found in the top 5_", "",
          "Per-question ranks for every pipeline are in `results/latest.json` → `pipelines[].perQuestion`."]
    return "\n".join(L) + "\n"


# ── verify ──────────────────────────────────────────────────────────────────
def verify(fresh: dict, manifest: dict) -> int:
    fails = 0

    def bad(m):
        nonlocal fails
        fails += 1
        print(f"  ✗ {m}")

    print("\nVerify — corpus integrity")
    for d in manifest["documents"]:
        if sha256((DOCS / f"{d['id']}.jdf").read_bytes()) != d["sha256_jdf"]:
            bad(f"{d['id']}.jdf differs from manifest hash (document edited after generation)")
        if not (DOCS / f"{d['id']}.pdf").exists():
            bad(f"{d['id']}.pdf missing")
    if sha256((CORPUS / "questions.json").read_bytes()) != manifest["questions"]["sha256"]:
        bad("questions.json differs from manifest hash")
    if not fresh["jdfOnly"]["deterministic"]:
        bad("a committed JDF chunk's hash does not match its text")
    if fails == 0:
        print(f"  ✓ {len(manifest['documents'])} documents, questions and {fresh['jdfOnly']['corpusChunks']} JDF chunks match their hashes")

    print("Verify — compare with results/latest.json")
    pub_file = RESULTS / "latest.json"
    if not pub_file.exists():
        bad("results/latest.json not found")
        return fails
    pub = json.loads(pub_file.read_text())
    names = list(pub["pipelines"][0]["retrievers"].keys())
    for ret in names:
        tol = 0.0005 if ret == "bm25" else 0.02
        before = fails
        checked = 0
        for p in pub["pipelines"]:
            f = next((x for x in fresh["pipelines"] if x["id"] == p["id"]), None)
            if not f:
                bad(f"{p['id']}: missing in this run (parser not installed?)")
                continue
            a, b = p["retrievers"].get(ret), f["retrievers"].get(ret)
            if not a or not b:
                continue
            checked += 1
            for m in ("recall1", "recall5", "mrr10", "recallAt1000Tok"):
                if abs(a["all"][m] - b["all"][m]) > tol:
                    bad(f"{p['id']} {ret} {m}: published {a['all'][m]:.3f} vs this run {b['all'][m]:.3f}")
        if checked and fails == before:
            print(f"  ✓ {ret}: {checked} pipelines {'match exactly' if tol < 0.001 else f'within ±{tol * 100:.0f} pts'}")
        elif not checked:
            print(f"  · {ret}: not run this time (pass the same --embedder list to compare)")
    if pub["jdfOnly"]["chunksReembedded"] != fresh["jdfOnly"]["chunksReembedded"]:
        bad("incremental re-embed count differs")
    print("\nVERIFIED — published results reproduce on this machine." if fails == 0 else f"\nFAILED — {fails} discrepancy(ies).")
    return fails


# ── main ────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--embedder", default=DEFAULT_EMBEDDER, help="comma-separated: st:<hf-model> | ollama:<model> | none (default: %(default)s)")
    ap.add_argument("--pdf-chunks", default="1000/200,2000/200", help="PDF chunk configs chars/overlap, comma-separated")
    ap.add_argument("--out", default=str(RESULTS / "latest.json"), help="results JSON path")
    ap.add_argument("--verify", action="store_true", help="compare this run with the published results instead of overwriting them")
    a = ap.parse_args()

    manifest = json.loads((CORPUS / "manifest.json").read_text())
    questions = json.loads((CORPUS / "questions.json").read_text())
    doc_ids = [d["id"] for d in manifest["documents"]]
    configs = [tuple(int(x) for x in c.split("/")) for c in a.pdf_chunks.split(",")]

    print(f"JDF vs PDF RAG benchmark — {len(doc_ids)} documents, {len(questions)} questions\n\nBuilding pipelines:")
    jdf = load_jdf_pipeline(manifest)
    print(f"  · {jdf.label} (jdf-cli {jdf.version}): {len(jdf.chunks)} chunks")
    conv = load_converted_pipeline(manifest)
    if conv:
        print(f"  · {conv.label} (jdf-cli {conv.version}): {len(conv.chunks)} chunks")
    pipelines = [jdf] + ([conv] if conv else []) + build_pdf_pipelines(doc_ids, configs)

    embedders: list[Embedder] = []
    for spec in [x.strip() for x in a.embedder.split(",") if x.strip() and x.strip() != "none"]:
        t0 = time.time()
        embedders.append(Embedder(spec))
        print(f"\nDense retriever: {embedders[-1].model} via {embedders[-1].version} (loaded in {time.time() - t0:.1f}s)")
    if not embedders:
        print("\nDense retriever: none — BM25 only")

    print("\nEvaluating:")
    results = []
    head = f"dense:{embedders[0].model}" if embedders else "bm25"
    for p in pipelines:
        r = evaluate(p, questions, embedders)
        results.append(r)
        m = r["retrievers"][head]["all"]
        print(f"  · {p.label:<58} R@1 {m['recall1'] * 100:5.1f}%  R@1k-tok {m['recallAt1000Tok'] * 100:5.1f}%  R@5 {m['recall5'] * 100:5.1f}%  MRR {m['mrr10']:.3f}")

    out = {
        "date": date.today().isoformat(),
        "machine": machine(),
        "embeddings": [{"provider": e.provider, "model": e.model, "version": e.version, "embedCalls": e.calls} for e in embedders],
        "headline": head,
        "settings": {"pdfChunking": [{"chars": c, "overlap": o} for c, o in configs], "jdfMaxTokens": json.loads((CORPUS / "jdf-chunks.meta.json").read_text())["max_tokens"], "k": K,
                     "hitRule": "same document AND chunk contains answer string AND row/subject key (whitespace-insensitive)", "tokenBudgets": list(BUDGETS)},
        "corpus": {"documents": len(doc_ids), "pages": sum(d["pages"] for d in manifest["documents"]), "questions": len(questions),
                   "byType": manifest["questions"]["byType"], "manifestHash": sha256((CORPUS / "manifest.json").read_bytes())[:16]},
        "jdfOnly": jdf_only_properties(jdf),
        "pipelines": results,
    }
    j = out["jdfOnly"]
    print(f"\nJDF-only: chunk hashes ok={j['deterministic']}; edit 1 paragraph → re-embed {j['chunksReembedded']} of {j['corpusChunks']} chunks")

    if a.verify:
        return 1 if verify(out, manifest) else 0

    RESULTS.mkdir(exist_ok=True)
    Path(a.out).write_text(json.dumps(out, indent=2) + "\n")
    (RESULTS / "report.md").write_text(report_md(out))
    print(f"\n→ {Path(a.out).relative_to(HERE) if Path(a.out).is_relative_to(HERE) else a.out}\n→ results/report.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
