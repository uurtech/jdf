import fs from "node:fs";
import path from "node:path";
import {
  evaluateRun,
  type EvalReport,
  type Qrel,
  type RunRanking,
} from "../lib/retrieval-metrics.js";

/**
 * `jdf eval` — score a retrieval run for RAG evaluation (issue #3).
 *
 * Inputs are two small JSON files you keep next to your eval set:
 *   qrels.json — relevance judgments:
 *     [{ "queryId": "q1", "docId": "chunk-3", "grade": 2 }, ...]
 *     (`grade` is optional and defaults to 1; grade 0 means not relevant.)
 *   run.json — one ranked chunk-id list per query, best first:
 *     [{ "queryId": "q1", "ranking": ["chunk-3", "chunk-7"] }, ...]
 *     (Produce it however you retrieve: `jdf chunk` ids + your vector store.)
 *
 * The command prints a one-line human summary and writes the full
 * per-query report as JSON, so CI can diff it over time and fail on
 * retrieval-quality regressions.
 */

export interface EvalOptions {
  k?: number;
  output?: string;
}

const DEFAULT_K = 10;

function readJson<T>(file: string, what: string): T {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`eval: cannot read ${what} file ${file}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`eval: ${what} file ${file} is not valid JSON`);
  }
}

function isQrelArray(value: unknown): value is Qrel[] {
  return (
    Array.isArray(value) &&
    value.every(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as Qrel).queryId === "string" &&
        typeof (e as Qrel).docId === "string"
    )
  );
}

function isRunArray(value: unknown): value is RunRanking[] {
  return (
    Array.isArray(value) &&
    value.every(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as RunRanking).queryId === "string" &&
        Array.isArray((e as RunRanking).ranking)
    )
  );
}

export async function evalRun(
  qrelsFile: string,
  runFile: string,
  options: EvalOptions = {}
): Promise<EvalReport> {
  const k = options.k ?? DEFAULT_K;
  if (!Number.isInteger(k) || k <= 0) {
    throw new Error(`eval: --k must be a positive integer, got ${options.k}`);
  }
  const qrels = readJson<unknown>(qrelsFile, "qrels");
  const runs = readJson<unknown>(runFile, "run");
  if (!isQrelArray(qrels)) {
    throw new Error(
      `eval: qrels file must be an array of { queryId, docId, grade? } objects`
    );
  }
  if (!isRunArray(runs)) {
    throw new Error(
      `eval: run file must be an array of { queryId, ranking: string[] } objects`
    );
  }

  const report = evaluateRun(qrels, runs, k);
  const { summary } = report;
  console.log(
    `eval: ${summary.numQueries} queries @${summary.k} — ` +
      `recall ${summary.meanRecall.toFixed(3)}, ` +
      `MRR ${summary.meanReciprocalRank.toFixed(3)}, ` +
      `nDCG ${summary.meanNdcg.toFixed(3)}` +
      (summary.numSkipped > 0 ? ` (${summary.numSkipped} skipped, no judgments)` : "")
  );

  const outPath =
    options.output ??
    path.join(
      path.dirname(path.resolve(runFile)),
      `eval-report-k${summary.k}.json`
    );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`eval: report written to ${outPath}`);
  return report;
}
