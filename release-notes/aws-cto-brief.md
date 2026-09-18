# JDF — a drop-in stage for PDF ingestion pipelines

*Brief for an engineering leader who runs RAG at scale. Two pages, one command to verify.*

## The problem in one sentence

Every retrieval pipeline that ingests PDFs pays twice: once in tokens, because fixed-size text chunks carry no structure, and once in accuracy, because a number that lost its table header or a paragraph that was split mid-sentence is hard to retrieve. Bedrock Knowledge Bases, OpenSearch pipelines and the internal scripts teams write around them all inherit this from the input format, not from the retriever.

## What JDF is

JDF is an MIT-licensed JSON document format plus a CLI (`@uurtech/jdf-cli`), a web renderer (`@uurtech/jdf`, `<jdf src>` tag) and a desktop reader. For an ingestion pipeline only the CLI matters. It does three things a PDF parser does not:

1. **Rebuilds structure from geometry.** Tables become real tables (rows keep their headers), headings become a hierarchy, two-column pages come out in reading order, scanned pages and figures get OCR and captions, videos get transcripts. All local, no model calls unless you opt in.
2. **Chunks on structure, not on character counts.** A chunk is a section; a table row is serialised as `Header: value | Header: value`; the heading breadcrumb is prefixed to what gets embedded. Every chunk carries a stable content hash, so a changed paragraph re-embeds one chunk, not the document.
3. **Fails loudly when content would be lost.** `jdf rag <dir> --strict` exits non-zero if any image or video in the corpus has no text. Silent blind spots in a knowledge base are the expensive kind.

## Measured, not claimed

Two benchmarks ship in the repo, both Python, both re-runnable with `--verify`:

- **Labelled corpus** (`bench/rag_bench.py`): 24 generated reports, 192 questions with exact ground truth, 4 PDF parsers × 2 chunk sizes vs `jdf chunk`, BM25 + 5 embedding models. Headline (nomic-embed-text, chunk-size-neutral "answer inside the first 1,000 tokens"): JDF 99.0% vs best PDF parser 83.3%, with 38% fewer LLM context tokens per question and 16× cheaper re-indexing after an edit.
- **Real corpus** (`bench/byoc.py`): public PDFs — arXiv papers incl. a two-column one, two AWS whitepapers — with questions derived from the documents. Same pipelines, same hit rule. Honest result: on prose-heavy real PDFs converted JDF is at parity with the best parsers (BM25: 96.9% vs 97.7–98.4% answer-in-first-1,000-tokens, equal top-1) while handing the LLM the fewest tokens; the large gap in the labelled benchmark comes from tables and structure, which reports have and papers mostly do not. Point it at your own folder: `python bench/byoc.py --pdf ./s3-mirror`. Nothing leaves the machine.

Full tables, method and caveats: `bench/README.md` and https://jdf.dev/docs/benchmark.html.

## How an existing ingestion script adopts it

Keep the script. Add one stage in front of the embedder:

```bash
aws s3 sync s3://corp-docs/policies ./policies
npx @uurtech/jdf-cli rag ./policies --no-embed --ocr tesseract --strict
#  → ./policies/.jdf-rag/index.jsonl   one JSON line per chunk
#  → ./policies/.jdf-rag/manifest.json coverage report (images/videos with and without text)
```

`index.jsonl` is the contract. Each line:

```json
{ "file": "policies/travel.pdf.jdf", "id": "s3-2", "text": "Per-diem: Europe: $120 | Americas: $95 | …",
  "path": ["Travel policy", "Per-diem rates"], "page": 4, "types": ["text","table"], "tokens": 84, "hash": "3f9a…" }
```

Your existing code reads `text` (what the LLM should see), uses `path` and `page` as metadata filters, and uses `hash` to skip unchanged chunks on the next run. Embedding stays wherever it is today: Bedrock Titan, OpenSearch's ingest pipeline, a SageMaker endpoint. JDF does not need to know which.

If the pipeline also needs to *show* a hit, the same `.jdf` renders in a browser with one tag and the reader can jump to the exact page, table row or video timestamp the chunk came from.

## What it is not

- Not a vector store, not a retriever, not a hosted service. It produces files.
- Not a replacement for Textract on hard scans. It runs OCR locally (Tesseract) and can hand off to any vision model; Textract output can be wrapped into the same format.
- Not finished. Multi-column reading order and table detection are geometry heuristics with published accuracy on a corpus, not a guarantee on every PDF. The repo tells you the numbers rather than the adjectives.

## Ask

Fifteen minutes with one real folder of PDFs your team ingests today:

```bash
git clone https://github.com/uurtech/jdf && cd jdf/bench
pip install -r requirements.txt
python byoc.py --pdf /path/to/that/folder
```

If the numbers hold on your corpus, the integration above is a one-line change to an existing script. If they don't, the repo has the tooling to show exactly where and why.

— Uğur Kazdal · https://jdf.dev · https://github.com/uurtech/jdf
