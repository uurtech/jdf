# JDF vs PDF — RAG retrieval benchmark

Generated 2026-09-18 on Apple M5 (macOS-26.6.2-arm64-arm-64bit-Mach-O, Python 3.14.6). Corpus: 24 documents / 120 pages / 192 questions (120 table-cell, 48 prose, 24 list). Reproduce: `pip install -r requirements.txt && python rag_bench.py` — see bench/README.md.

Hit rule: same document AND chunk contains answer string AND row/subject key (whitespace-insensitive). R@1k tokens = answer found within the first 1,000 tokens of retrieved context (chunk-size neutral). PDF chunking: RecursiveCharacterTextSplitter semantics at 1000/200 and 2000/200 chars. JDF: `jdf chunk --strategy section --max-tokens 512` (committed output, jdf-cli 0.2.2).

## Dense retrieval — nomic-embed-text

| Pipeline | Chunks | Avg tokens/chunk | R@1 | R@5 | MRR@10 | R@1k tokens | R@2k tokens | Table R@1k | Prose R@1k | List R@1k | Ctx tokens @5 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| JDF · jdf chunk (section, 512 tok) | 192 | 163 | 76.6% | 99.0% | 0.864 | 99.0% | 100.0% | 98.3% | 100.0% | 100.0% | 753 |
| PDF → jdf convert → jdf chunk (section, 512 tok) | 216 | 158 | 80.2% | 98.4% | 0.884 | 99.0% | 99.5% | 98.3% | 100.0% | 100.0% | 718 |
| PDF · PyMuPDF get_text() · fixed 1000/200 | 153 | 221 | 41.7% | 91.1% | 0.606 | 81.8% | 98.4% | 80.0% | 85.4% | 83.3% | 1226 |
| PDF · PyMuPDF get_text() · fixed 2000/200 | 90 | 334 | 63.0% | 99.0% | 0.760 | 77.1% | 99.5% | 82.5% | 77.1% | 50.0% | 1781 |
| PDF · pdfplumber extract_text() · fixed 1000/200 | 150 | 222 | 42.2% | 91.1% | 0.608 | 80.7% | 99.0% | 79.2% | 85.4% | 79.2% | 1219 |
| PDF · pdfplumber extract_text() · fixed 2000/200 | 90 | 333 | 63.5% | 97.9% | 0.763 | 77.1% | 99.0% | 82.5% | 77.1% | 50.0% | 1773 |
| PDF · pypdf extract_text() · fixed 1000/200 | 151 | 221 | 41.1% | 92.2% | 0.605 | 83.3% | 97.9% | 81.7% | 87.5% | 83.3% | 1224 |
| PDF · pypdf extract_text() · fixed 2000/200 | 90 | 333 | 63.0% | 97.4% | 0.759 | 77.1% | 99.0% | 82.5% | 77.1% | 50.0% | 1774 |
| PDF · pdftotext -layout (poppler) · fixed 1000/200 | 268 | 191 | 35.9% | 73.4% | 0.508 | 71.9% | 86.5% | 70.8% | 83.3% | 54.2% | 1040 |
| PDF · pdftotext -layout (poppler) · fixed 2000/200 | 96 | 448 | 46.4% | 93.8% | 0.642 | 62.0% | 89.1% | 60.0% | 70.8% | 54.2% | 2269 |

## Dense retrieval — BAAI/bge-small-en-v1.5

| Pipeline | Chunks | Avg tokens/chunk | R@1 | R@5 | MRR@10 | R@1k tokens | R@2k tokens | Table R@1k | Prose R@1k | List R@1k | Ctx tokens @5 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| JDF · jdf chunk (section, 512 tok) | 192 | 163 | 46.9% | 91.7% | 0.646 | 96.9% | 100.0% | 95.0% | 100.0% | 100.0% | 716 |
| PDF → jdf convert → jdf chunk (section, 512 tok) | 216 | 158 | 40.1% | 91.7% | 0.601 | 95.8% | 98.4% | 94.2% | 100.0% | 95.8% | 521 |
| PDF · PyMuPDF get_text() · fixed 1000/200 | 153 | 221 | 34.4% | 83.3% | 0.530 | 74.5% | 94.3% | 71.7% | 91.7% | 54.2% | 1214 |
| PDF · PyMuPDF get_text() · fixed 2000/200 | 90 | 334 | 50.0% | 90.6% | 0.649 | 64.1% | 92.2% | 67.5% | 72.9% | 29.2% | 1783 |
| PDF · pdfplumber extract_text() · fixed 1000/200 | 150 | 222 | 34.9% | 84.4% | 0.534 | 75.0% | 93.8% | 72.5% | 93.8% | 50.0% | 1210 |
| PDF · pdfplumber extract_text() · fixed 2000/200 | 90 | 333 | 50.5% | 91.7% | 0.659 | 66.1% | 92.2% | 69.2% | 75.0% | 33.3% | 1771 |
| PDF · pypdf extract_text() · fixed 1000/200 | 151 | 221 | 31.8% | 84.4% | 0.515 | 75.0% | 94.8% | 72.5% | 93.8% | 50.0% | 1210 |
| PDF · pypdf extract_text() · fixed 2000/200 | 90 | 333 | 52.1% | 88.5% | 0.665 | 66.1% | 90.1% | 69.2% | 77.1% | 29.2% | 1777 |
| PDF · pdftotext -layout (poppler) · fixed 1000/200 | 268 | 191 | 34.9% | 71.4% | 0.487 | 66.7% | 82.8% | 61.7% | 93.8% | 37.5% | 1044 |
| PDF · pdftotext -layout (poppler) · fixed 2000/200 | 96 | 448 | 38.0% | 95.3% | 0.572 | 48.4% | 87.0% | 49.2% | 68.8% | 4.2% | 2211 |

## Dense retrieval — sentence-transformers/all-MiniLM-L6-v2

| Pipeline | Chunks | Avg tokens/chunk | R@1 | R@5 | MRR@10 | R@1k tokens | R@2k tokens | Table R@1k | Prose R@1k | List R@1k | Ctx tokens @5 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| JDF · jdf chunk (section, 512 tok) | 192 | 163 | 40.1% | 91.1% | 0.599 | 97.4% | 100.0% | 95.8% | 100.0% | 100.0% | 693 |
| PDF → jdf convert → jdf chunk (section, 512 tok) | 216 | 158 | 34.4% | 78.1% | 0.537 | 96.4% | 100.0% | 94.2% | 100.0% | 100.0% | 526 |
| PDF · PyMuPDF get_text() · fixed 1000/200 | 153 | 221 | 30.2% | 80.2% | 0.492 | 70.3% | 90.1% | 63.3% | 95.8% | 54.2% | 1204 |
| PDF · PyMuPDF get_text() · fixed 2000/200 | 90 | 334 | 45.8% | 81.8% | 0.606 | 60.9% | 82.8% | 63.3% | 77.1% | 16.7% | 1695 |
| PDF · pdfplumber extract_text() · fixed 1000/200 | 150 | 222 | 28.1% | 78.1% | 0.474 | 65.6% | 89.1% | 58.3% | 93.8% | 45.8% | 1193 |
| PDF · pdfplumber extract_text() · fixed 2000/200 | 90 | 333 | 45.8% | 82.8% | 0.605 | 61.5% | 83.9% | 62.5% | 81.2% | 16.7% | 1684 |
| PDF · pypdf extract_text() · fixed 1000/200 | 151 | 221 | 28.1% | 78.6% | 0.477 | 66.7% | 88.0% | 59.2% | 95.8% | 45.8% | 1197 |
| PDF · pypdf extract_text() · fixed 2000/200 | 90 | 333 | 42.7% | 81.8% | 0.590 | 62.5% | 84.9% | 63.3% | 79.2% | 25.0% | 1693 |
| PDF · pdftotext -layout (poppler) · fixed 1000/200 | 268 | 191 | 29.2% | 68.8% | 0.441 | 66.1% | 82.8% | 60.8% | 87.5% | 50.0% | 1021 |
| PDF · pdftotext -layout (poppler) · fixed 2000/200 | 96 | 448 | 37.0% | 91.7% | 0.571 | 54.2% | 83.9% | 50.8% | 72.9% | 33.3% | 2214 |

## Dense retrieval — BAAI/bge-base-en-v1.5

| Pipeline | Chunks | Avg tokens/chunk | R@1 | R@5 | MRR@10 | R@1k tokens | R@2k tokens | Table R@1k | Prose R@1k | List R@1k | Ctx tokens @5 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| JDF · jdf chunk (section, 512 tok) | 192 | 163 | 63.0% | 94.8% | 0.758 | 96.9% | 100.0% | 95.0% | 100.0% | 100.0% | 728 |
| PDF → jdf convert → jdf chunk (section, 512 tok) | 216 | 158 | 54.2% | 94.8% | 0.694 | 99.5% | 99.5% | 99.2% | 100.0% | 100.0% | 550 |
| PDF · PyMuPDF get_text() · fixed 1000/200 | 153 | 221 | 31.8% | 90.1% | 0.528 | 78.6% | 97.4% | 81.7% | 81.2% | 58.3% | 1220 |
| PDF · PyMuPDF get_text() · fixed 2000/200 | 90 | 334 | 46.9% | 92.7% | 0.630 | 56.8% | 94.3% | 69.2% | 54.2% | 0.0% | 1793 |
| PDF · pdfplumber extract_text() · fixed 1000/200 | 150 | 222 | 32.3% | 90.6% | 0.534 | 80.2% | 97.4% | 83.3% | 81.2% | 62.5% | 1215 |
| PDF · pdfplumber extract_text() · fixed 2000/200 | 90 | 333 | 47.4% | 93.2% | 0.634 | 57.8% | 95.3% | 70.0% | 54.2% | 4.2% | 1778 |
| PDF · pypdf extract_text() · fixed 1000/200 | 151 | 221 | 30.2% | 91.7% | 0.519 | 77.6% | 98.4% | 78.3% | 81.2% | 66.7% | 1215 |
| PDF · pypdf extract_text() · fixed 2000/200 | 90 | 333 | 46.9% | 91.1% | 0.631 | 57.3% | 94.8% | 69.2% | 54.2% | 4.2% | 1790 |
| PDF · pdftotext -layout (poppler) · fixed 1000/200 | 268 | 191 | 34.4% | 76.6% | 0.504 | 74.0% | 87.5% | 73.3% | 93.8% | 37.5% | 1037 |
| PDF · pdftotext -layout (poppler) · fixed 2000/200 | 96 | 448 | 34.4% | 95.3% | 0.547 | 44.8% | 89.6% | 48.3% | 56.2% | 4.2% | 2296 |

## BM25 (lexical, offline)

| Pipeline | Chunks | Avg tokens/chunk | R@1 | R@5 | MRR@10 | R@1k tokens | R@2k tokens | Table R@1k | Prose R@1k | List R@1k | Ctx tokens @5 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| JDF · jdf chunk (section, 512 tok) | 192 | 163 | 89.6% | 100.0% | 0.945 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 798 |
| PDF → jdf convert → jdf chunk (section, 512 tok) | 216 | 158 | 85.4% | 99.5% | 0.925 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 845 |
| PDF · PyMuPDF get_text() · fixed 1000/200 | 153 | 221 | 75.0% | 99.0% | 0.858 | 98.4% | 100.0% | 100.0% | 100.0% | 87.5% | 1194 |
| PDF · PyMuPDF get_text() · fixed 2000/200 | 90 | 334 | 84.4% | 100.0% | 0.918 | 97.9% | 100.0% | 99.2% | 97.9% | 91.7% | 1759 |
| PDF · pdfplumber extract_text() · fixed 1000/200 | 150 | 222 | 75.5% | 100.0% | 0.865 | 99.5% | 100.0% | 100.0% | 100.0% | 95.8% | 1190 |
| PDF · pdfplumber extract_text() · fixed 2000/200 | 90 | 333 | 84.4% | 100.0% | 0.918 | 97.9% | 100.0% | 99.2% | 97.9% | 91.7% | 1744 |
| PDF · pypdf extract_text() · fixed 1000/200 | 151 | 221 | 75.0% | 100.0% | 0.863 | 99.5% | 100.0% | 100.0% | 100.0% | 95.8% | 1193 |
| PDF · pypdf extract_text() · fixed 2000/200 | 90 | 333 | 84.4% | 100.0% | 0.918 | 97.9% | 100.0% | 99.2% | 97.9% | 91.7% | 1755 |
| PDF · pdftotext -layout (poppler) · fixed 1000/200 | 268 | 191 | 68.2% | 87.0% | 0.766 | 85.9% | 91.1% | 89.2% | 93.8% | 54.2% | 1016 |
| PDF · pdftotext -layout (poppler) · fixed 2000/200 | 96 | 448 | 73.4% | 99.5% | 0.852 | 92.7% | 98.4% | 92.5% | 95.8% | 87.5% | 2193 |

## JDF-only properties

- Chunk hashes verified: **yes** (every committed chunk's `hash` is sha256(text)[:12]).
- Edit one paragraph in d01 → `jdf embed --incremental` re-embeds **1 of 192** chunks in the corpus (8 chunks in that document). A PDF pipeline has no stable chunk identity: re-extract, re-chunk, re-embed everything.

## Misses (dense:nomic-embed-text, JDF pipeline)

- q136 (rank 8)
- q152 (rank 8)

Per-question ranks for every pipeline are in `results/latest.json` → `pipelines[].perQuestion`.
