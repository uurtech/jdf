#!/usr/bin/env python3
"""
Bring-your-own-corpus RAG benchmark: JDF vs PDF on REAL documents.

The main benchmark (rag_bench.py) uses a generated corpus so every answer is
exact ground truth. This one answers the obvious follow-up — "and on real
PDFs?" — with the same pipelines, retrievers and hit rule, on public documents
(bench/byoc/corpus.json: arXiv papers, AWS whitepapers) or on any folder of
PDFs you point it at. Real documents have no labelled questions, so questions
are derived from the documents themselves, deterministically:

  numeric-fact lookup — take a sentence that states a number ("… improves
  MultiNLI accuracy to 86.7% …"), blank the number, and ask for it. A retrieved
  chunk is a hit when it comes from the right document and contains both the
  number and the sentence's key word (whitespace-insensitive), exactly like the
  main benchmark's hit rule. Sentences come from a neutral extraction
  (pdftotext without -layout, or PyMuPDF) so no pipeline sees its own output.

Unsupervised questions are noisier than labelled ones (a number can appear in
several places; a hyphenated line break can hide a key word from every
pipeline). Both sides get the same questions, so the comparison is fair; the
absolute numbers are lower than in the labelled benchmark and should be read
as such.

  pip install -r requirements.txt            # PyMuPDF, pdfplumber, pypdf (+ sentence-transformers for dense retrieval)
  python byoc.py                             # BM25 only, downloads the public corpus, writes results/byoc-latest.json
  python byoc.py --embedder ollama:nomic-embed-text
  python byoc.py --pdf ~/my-pdfs             # your own folder (nothing leaves the machine)
  python byoc.py --render                    # publish results/byoc-latest.json into README.md + bench/README.md

Needs Node (`npx tsx`) for the JDF side: the PDF is converted with the shipped
importer and chunked with the shipped chunker (bench/src/byoc-chunks.ts).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import urllib.request
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import rag_bench as rb  # noqa: E402  (same pipelines, retrievers, hit rule)

BYOC = HERE / "byoc"
CACHE = BYOC / "cache"
RESULTS = HERE / "results"
REPO = HERE.parent
QUESTIONS_PER_DOC = 40


# ── corpus ──────────────────────────────────────────────────────────────────
def fetch(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    print(f"  ↓ {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "jdf-bench/1.0 (+https://github.com/uurtech/jdf)"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def load_corpus(pdf_dir: str | None) -> list[dict]:
    CACHE.mkdir(parents=True, exist_ok=True)
    docs: list[dict] = []
    if pdf_dir:
        for p in sorted(Path(pdf_dir).expanduser().glob("*.pdf")):
            docs.append({"id": re.sub(r"[^a-zA-Z0-9_-]+", "-", p.stem).strip("-").lower()[:40], "title": p.stem, "path": p, "url": None, "layout": ""})
    else:
        for d in json.loads((BYOC / "corpus.json").read_text())["documents"]:
            dest = CACHE / f"{d['id']}.pdf"
            fetch(d["url"], dest)
            docs.append({**d, "path": dest})
    for d in docs:
        d["sha256"] = rb.sha256(Path(d["path"]).read_bytes())
    return docs


# ── neutral text + questions ────────────────────────────────────────────────
def neutral_text(pdf: Path) -> str:
    """Reading-order text nobody is benchmarked on: pdftotext (no -layout) or PyMuPDF, with running
    headers/footers and bare page numbers removed (a question about a page number is not a question)."""
    if shutil.which("pdftotext"):
        raw = subprocess.run(["pdftotext", "-enc", "UTF-8", str(pdf), "-"], capture_output=True, text=True, check=False).stdout
        pages = raw.split("\f")
    else:
        pages = rb.extract_pymupdf(pdf)
    freq: dict[str, int] = {}
    for pg in pages:
        for line in {l.strip() for l in pg.splitlines() if l.strip()}:
            freq[line] = freq.get(line, 0) + 1
    repeated = {l for l, n in freq.items() if n >= 3}          # running header / footer text
    out: list[str] = []
    for pg in pages:
        keep = [l for l in pg.splitlines() if l.strip() and l.strip() not in repeated and not re.fullmatch(r"\s*\d{1,4}\s*", l)]
        out.append("\n".join(keep))
    return "\n\n".join(out)


NUM = re.compile(r"(?<![\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d{2,})\s?%?")
WORD = re.compile(r"(?<![A-Za-z-])[A-Za-z]{5,9}(?![A-Za-z-])")   # whole words only, never a hyphenated fragment
STOP = {"which", "there", "these", "those", "their", "about", "would", "could", "should", "where", "while", "between", "during", "through", "under", "after", "before", "table", "figure", "section", "using", "based", "model", "models", "results", "result", "other", "first", "second", "shows", "shown", "however", "because", "within"}


def make_questions(doc_id: str, text: str, per_doc: int) -> list[dict]:
    text = re.sub(r"\s+", " ", text)                   # keep the PDF's own hyphenation: every pipeline sees the same glyphs
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z(]|\d+(?:\.\d+)*\s+[A-Z])", text)   # also split before numbered headings
    cands: list[dict] = []
    for s in sentences:
        words = s.split()
        if not (8 <= len(words) <= 45) or "...." in s:                       # skip table-of-contents lines
            continue
        # A number that labels something (Figure 12, Section 5.2, Table 3, page refs, arXiv ids) is a reference, not a fact.
        nums = [m for m in NUM.finditer(s)
                if not re.fullmatch(r"(19|20)\d\d", m.group(1))
                and not re.search(r"(?:Figure|Fig\.|Table|Section|Sec\.|Chapter|Appendix|Eq\.|Equation|pages?|pp\.|arXiv:|vol\.|no\.)\s*$", s[: m.start()], re.I)
                and not re.match(r"^\s*(?:th|st|nd|rd)\b", s[m.end():])
                and m.start() > 0 and s[: m.start()].strip() != ""                 # a leading number is a section label
                and not (s[: m.start()].rstrip().endswith("[") and s[m.end():].lstrip().startswith("]"))]  # [39] = citation index
        if not nums:
            continue
        m = nums[0]
        answer = m.group(0).strip()
        keys = [w for w in WORD.findall(s) if w.lower() not in STOP and w.lower() not in answer.lower()]
        if not keys:
            continue
        key = max(keys, key=len)
        question = (s[: m.start()] + "____" + s[m.end():]).strip()
        cands.append({"id": f"{doc_id}-q{len(cands) + 1:03d}", "doc": doc_id, "type": "prose", "question": f"Fill in the blank: {question}", "answer": answer, "key": key})
    if len(cands) <= per_doc:
        return cands
    step = len(cands) / per_doc
    return [cands[int(i * step)] for i in range(per_doc)]  # deterministic, spread over the document


# ── pipelines ───────────────────────────────────────────────────────────────
def jdf_pipeline(docs: list[dict], max_tokens: int = 512) -> tuple[rb.Pipeline, dict]:
    chunks: list[rb.Chunk] = []
    info: dict = {}
    ver = "?"
    for d in docs:
        out = CACHE / f"{d['id']}.jdf-chunks-{max_tokens}.jsonl"
        stamp = CACHE / f"{d['id']}.jdf-chunks-{max_tokens}.json"
        if not out.exists() or not stamp.exists() or json.loads(stamp.read_text()).get("sha256") != d["sha256"] or json.loads(stamp.read_text()).get("importerHash") != IMPORTER_HASH:
            r = subprocess.run(["npx", "tsx", str(HERE / "src/byoc-chunks.ts"), str(d["path"]), str(out), d["id"], str(max_tokens)], cwd=REPO, capture_output=True, text=True)
            line = [l for l in r.stdout.splitlines() if l.startswith("{")]
            if r.returncode != 0 or not line:
                raise SystemExit(f"jdf convert/chunk failed for {d['id']}:\n{r.stderr[-2000:]}")
            stamp.write_text(json.dumps({**json.loads(line[-1]), "sha256": d["sha256"], "importerHash": IMPORTER_HASH}))
        meta = json.loads(stamp.read_text())
        ver = meta["cliVersion"]
        info[d["id"]] = {k: meta[k] for k in ("pages", "tables", "chunks", "convertMs")}
        for l in out.read_text().splitlines():
            if l.strip():
                r_ = json.loads(l)
                chunks.append(rb.Chunk(r_["id"], r_["doc"], r_["text"], r_["embed_text"], r_["tokens"]))
        print(f"  · jdf convert + chunk ({max_tokens} tok) · {d['id']}: {meta['pages']} pages, {meta['tables']} tables, {meta['chunks']} chunks ({meta['convertMs']} ms)")
    return rb.Pipeline(f"jdf-converted-{max_tokens}", f"PDF → jdf convert → jdf chunk (section, {max_tokens} tok)", "jdf-converted", "jdf convert + chunk", ver, chunks), info


def _importer_hash() -> str:
    """Source hash of the importer + chunker, so cached JDF chunks are rebuilt after a code change."""
    h = hashlib.sha256()
    for f in sorted((REPO / "packages/jdf-pdf-import/src").glob("*.ts")) + [REPO / "tools/jdf-cli/src/commands/chunk.ts"]:
        h.update(f.read_bytes())
    return h.hexdigest()[:12]


IMPORTER_HASH = _importer_hash()


def pdf_pipelines(docs: list[dict], configs: list[tuple[int, int]]) -> list[rb.Pipeline]:
    out: list[rb.Pipeline] = []
    for ex_id, label, ver, fn in rb.EXTRACTORS:
        v = ver()
        if not v:
            print(f"  · {label}: not installed — skipped")
            continue
        texts = {d["id"]: "\n\n".join(fn(Path(d["path"]))) for d in docs}
        for size, overlap in configs:
            chunks = [rb.Chunk(f"{d}-{ex_id}-{size}-{i}", d, t, t, rb.est_tokens(t))
                      for d in texts for i, t in enumerate(rb.split_text(texts[d], size, overlap))]
            out.append(rb.Pipeline(f"pdf-{ex_id}-{size}", f"PDF · {label} · fixed {size}/{overlap}", "pdf", label, v, chunks))
            print(f"  · {label} {v} · {size}/{overlap}: {len(chunks)} chunks")
    return out


# ── render ──────────────────────────────────────────────────────────────────
def render(res: dict) -> None:
    pc = lambda x: f"{x * 100:.1f}%"
    rets = list(res["pipelines"][0]["retrievers"].keys())
    short = lambda r: "BM25" if r == "bm25" else r.split(":", 1)[1].split("/")[-1]
    head = "| Pipeline | Chunks | " + " | ".join(f"{short(r)} R@1k tok" for r in rets) + f" | {short(rets[-1])} top-1 | Ctx tokens @5 |"
    sep = "|---|---:|" + "|".join("---:" for _ in rets) + "|---:|---:|"
    rows = []
    for p in res["pipelines"]:
        b = (lambda s: f"**{s}**") if p["format"] == "jdf-converted" else (lambda s: s)
        rows.append(f"| {b(p['label'])} | {p['chunks']} | " + " | ".join(b(pc(p["retrievers"][r]["all"]["recallAt1000Tok"])) for r in rets) + f" | {b(pc(p['retrievers'][rets[-1]]['all']['recall1']))} | {round(p['retrievers'][rets[-1]]['all']['ctxTokensTop5'])} |")
    docs = ", ".join(f"[{d['title'].split(' (')[0].split(' —')[0]}]({d['url']})" if d.get("url") else d["title"] for d in res["documents"])
    note = (f"Real public PDFs — {docs} ({res['pages']} pages) — with {res['questions']} numeric-fact questions derived from the documents themselves "
            f"(see `bench/byoc.py`; unsupervised, so absolute numbers are lower than the labelled benchmark and both sides share the noise). "
            f"JDF side = `jdf convert` + `jdf chunk` {res['cliVersion']}, the same code the CLI and reader ship. {res['machine']['cpu']}, {res['date']}. "
            f"Re-run: `python bench/byoc.py --embedder {res['embedders'] or 'none'}`; your own folder: `--pdf DIR`.")
    block = "\n".join([head, sep, *rows, "", note])
    for f in (REPO / "README.md", HERE / "README.md"):
        text = f.read_text()
        a, b = "<!-- bench:byoc:start -->", "<!-- bench:byoc:end -->"
        i, j = text.find(a), text.find(b)
        if i < 0 or j < 0:
            print(f"  ! markers missing in {f.relative_to(REPO)} — skipped")
            continue
        f.write_text(text[: i + len(a)] + "\n" + block + "\n" + text[j:])
        print(f"  ✓ {f.relative_to(REPO)} updated")


# ── main ────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf", help="folder of your own PDFs (default: the public corpus in byoc/corpus.json)")
    ap.add_argument("--embedder", default="none", help="comma-separated: st:<hf-model> | ollama:<model> | none (default)")
    ap.add_argument("--pdf-chunks", default="1000/200,2000/200")
    ap.add_argument("--jdf-tokens", default="512,256", help="`jdf chunk --max-tokens` values to run (default: %(default)s)")
    ap.add_argument("--questions-per-doc", type=int, default=QUESTIONS_PER_DOC)
    ap.add_argument("--out", default=str(RESULTS / "byoc-latest.json"))
    ap.add_argument("--render", action="store_true", help="only publish the existing results JSON into the READMEs")
    a = ap.parse_args()
    if a.render:
        render(json.loads(Path(a.out).read_text()))
        return 0

    print("Corpus")
    docs = load_corpus(a.pdf)
    print("Questions (numeric-fact lookups from a neutral extraction)")
    questions: list[dict] = []
    for d in docs:
        qs = make_questions(d["id"], neutral_text(Path(d["path"])), a.questions_per_doc)
        questions += qs
        print(f"  · {d['id']}: {len(qs)} questions")
    print("Pipelines")
    jdfs: list[rb.Pipeline] = []
    info: dict = {}
    for mt in (int(x) for x in a.jdf_tokens.split(",")):
        jp, info = jdf_pipeline(docs, mt)
        jdfs.append(jp)
    jdf = jdfs[0]
    configs = [tuple(int(x) for x in c.split("/")) for c in a.pdf_chunks.split(",")]
    pipelines = jdfs + pdf_pipelines(docs, configs)  # type: ignore[arg-type]
    embedders = [rb.Embedder(s) for s in a.embedder.split(",") if s and s != "none"]
    print("Retrieval")
    results = []
    for p in pipelines:
        r = rb.evaluate(p, questions, embedders)
        r.pop("perQuestion", None)
        results.append(r)
        m = r["retrievers"]["bm25"]["all"]
        print(f"  · {p.label}: BM25 R@1k {m['recallAt1000Tok'] * 100:.1f}%  top-1 {m['recall1'] * 100:.1f}%  ctx@5 {round(m['ctxTokensTop5'])} tok")
    res = {
        "date": date.today().isoformat(), "machine": rb.machine(), "cliVersion": jdf.version,
        "documents": [{"id": d["id"], "title": d["title"], "url": d.get("url"), "sha256": d["sha256"], "layout": d.get("layout", ""), **info[d["id"]]} for d in docs],
        "pages": sum(info[d["id"]]["pages"] for d in docs), "questions": len(questions), "questionsSample": questions[:5],
        "embedders": ",".join(e.__dict__["provider"] + ":" + e.model for e in embedders), "pipelines": results,
    }
    RESULTS.mkdir(exist_ok=True)
    Path(a.out).write_text(json.dumps(res, indent=2) + "\n")
    print(f"\nWrote {a.out}")
    if not a.pdf:
        render(res)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
