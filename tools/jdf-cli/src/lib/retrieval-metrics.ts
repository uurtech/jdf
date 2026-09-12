/**
 * Retrieval quality metrics for RAG evaluation (`jdf eval`).
 *
 * Pure functions over (query, ranking, judgments) triples — no I/O, no
 * model calls — so they double as the regression-test oracle for retrieval
 * quality (issue #3): pin an eval set, record the means, fail CI on drift.
 *
 * Conventions (TREC-style):
 * - A "relevant set" is binary (grade >= 1 counts as relevant for
 *   Recall@K and MRR); nDCG@K uses the grades as gains.
 * - Queries with zero judged-relevant documents are excluded from the
 *   means and reported separately, since Recall/nDCG are undefined there.
 */

export interface Qrel {
  queryId: string;
  docId: string;
  /** Relevance grade, 0 = not relevant. Defaults to 1 when omitted. */
  grade?: number;
}

export interface RunRanking {
  queryId: string;
  /** Ranked doc ids, best first. */
  ranking: string[];
}

export interface QueryScores {
  queryId: string;
  recall: number;
  reciprocalRank: number;
  ndcg: number;
  numRelevant: number;
  numRetrievedRelevant: number;
}

export interface EvalSummary {
  k: number;
  numQueries: number;
  numSkipped: number;
  meanRecall: number;
  meanReciprocalRank: number;
  meanNdcg: number;
}

export interface EvalReport {
  summary: EvalSummary;
  queries: QueryScores[];
  skippedQueryIds: string[];
}

const DEFAULT_GRADE = 1;

function gradeOf(grades: Map<string, number>, docId: string): number {
  return grades.get(docId) ?? 0;
}

/** Recall@K: fraction of the relevant docs present in the top K. */
export function recallAtK(relevant: Set<string>, ranking: string[], k: number): number {
  if (relevant.size === 0) return NaN;
  const top = ranking.slice(0, Math.max(0, k));
  let hits = 0;
  for (const docId of top) {
    if (relevant.has(docId)) hits++;
  }
  return hits / relevant.size;
}

/**
 * Reciprocal rank: 1 / rank of the first relevant doc in the full ranking
 * (1-based), or 0 when no relevant doc is retrieved. Mean over queries = MRR.
 */
export function reciprocalRank(relevant: Set<string>, ranking: string[]): number {
  for (let i = 0; i < ranking.length; i++) {
    if (relevant.has(ranking[i])) return 1 / (i + 1);
  }
  return 0;
}

function dcg(gains: number[]): number {
  let total = 0;
  for (let i = 0; i < gains.length; i++) {
    total += (Math.pow(2, gains[i]) - 1) / Math.log2(i + 2);
  }
  return total;
}

/**
 * nDCG@K with exponential gains (2^grade - 1) and log2 discount.
 * Returns 1 when there is nothing relevant (vacuous); callers normally
 * exclude such queries via evaluateRun instead.
 */
export function ndcgAtK(grades: Map<string, number>, ranking: string[], k: number): number {
  const top = ranking.slice(0, Math.max(0, k));
  const gains = top.map((docId) => gradeOf(grades, docId));
  const ideal = [...grades.values()].filter((g) => g > 0).sort((a, b) => b - a).slice(0, top.length);
  const idealDcg = dcg(ideal);
  if (idealDcg === 0) return 1;
  return dcg(gains) / idealDcg;
}

export function groupQrels(qrels: Qrel[]): Map<string, Map<string, number>> {
  const byQuery = new Map<string, Map<string, number>>();
  for (const qrel of qrels) {
    let grades = byQuery.get(qrel.queryId);
    if (!grades) {
      grades = new Map();
      byQuery.set(qrel.queryId, grades);
    }
    grades.set(qrel.docId, qrel.grade ?? DEFAULT_GRADE);
  }
  return byQuery;
}

/**
 * Score every query present in either the qrels or the run.
 * Queries with no judged-relevant docs are skipped (reported in
 * skippedQueryIds) so they can't dilute the means.
 */
export function evaluateRun(qrels: Qrel[], runs: RunRanking[], k: number): EvalReport {
  const judgments = groupQrels(qrels);
  const rankings = new Map(runs.map((r) => [r.queryId, r.ranking]));
  const queryIds = new Set([...judgments.keys(), ...rankings.keys()]);

  const queries: QueryScores[] = [];
  const skippedQueryIds: string[] = [];
  for (const queryId of [...queryIds].sort()) {
    const grades = judgments.get(queryId) ?? new Map<string, number>();
    const relevant = new Set([...grades.entries()].filter(([, g]) => g > 0).map(([d]) => d));
    if (relevant.size === 0) {
      skippedQueryIds.push(queryId);
      continue;
    }
    const ranking = rankings.get(queryId) ?? [];
    const topK = ranking.slice(0, Math.max(0, k));
    const numRetrievedRelevant = topK.filter((d) => relevant.has(d)).length;
    queries.push({
      queryId,
      recall: recallAtK(relevant, ranking, k),
      reciprocalRank: reciprocalRank(relevant, ranking),
      ndcg: ndcgAtK(grades, ranking, k),
      numRelevant: relevant.size,
      numRetrievedRelevant,
    });
  }

  const mean = (xs: number[]): number =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    summary: {
      k,
      numQueries: queries.length,
      numSkipped: skippedQueryIds.length,
      meanRecall: mean(queries.map((q) => q.recall)),
      meanReciprocalRank: mean(queries.map((q) => q.reciprocalRank)),
      meanNdcg: mean(queries.map((q) => q.ndcg)),
    },
    queries,
    skippedQueryIds,
  };
}
