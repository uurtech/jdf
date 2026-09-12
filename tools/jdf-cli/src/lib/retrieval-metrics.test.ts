import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateRun,
  groupQrels,
  ndcgAtK,
  reciprocalRank,
  recallAtK,
  type Qrel,
  type RunRanking,
} from "./retrieval-metrics.js";

describe("recallAtK", () => {
  it("scores a perfect ranking as 1", () => {
    assert.equal(recallAtK(new Set(["a", "b"]), ["a", "b", "c"], 2), 1);
  });

  it("scores a partial ranking proportionally", () => {
    assert.equal(recallAtK(new Set(["a", "b", "c", "d"]), ["a", "x"], 2), 0.25);
  });

  it("ignores hits below K", () => {
    assert.equal(recallAtK(new Set(["a"]), ["x", "a"], 1), 0);
  });

  it("returns NaN when nothing is judged relevant", () => {
    assert.ok(Number.isNaN(recallAtK(new Set(), ["a"], 10)));
  });
});

describe("reciprocalRank", () => {
  it("returns 1 for a relevant doc at rank 1", () => {
    assert.equal(reciprocalRank(new Set(["a"]), ["a", "b"]), 1);
  });

  it("returns 1/rank for the first relevant doc", () => {
    assert.equal(reciprocalRank(new Set(["b"]), ["a", "b", "c"]), 0.5);
  });

  it("returns 0 when nothing relevant is retrieved", () => {
    assert.equal(reciprocalRank(new Set(["z"]), ["a", "b"]), 0);
  });
});

describe("ndcgAtK", () => {
  it("scores a perfect graded ranking as 1", () => {
    const grades = new Map([
      ["a", 3],
      ["b", 1],
    ]);
    assert.equal(ndcgAtK(grades, ["a", "b"], 2), 1);
  });

  it("penalizes a swapped graded ranking", () => {
    const grades = new Map([
      ["a", 3],
      ["b", 1],
    ]);
    const score = ndcgAtK(grades, ["b", "a"], 2);
    assert.ok(score > 0.6 && score < 1, `expected (0.6, 1), got ${score}`);
  });

  it("scores 0 when no relevant doc is retrieved", () => {
    const grades = new Map([["a", 2]]);
    assert.equal(ndcgAtK(grades, ["x", "y"], 2), 0);
  });

  it("returns 1 when nothing is judged relevant", () => {
    assert.equal(ndcgAtK(new Map(), ["x"], 5), 1);
  });
});

describe("groupQrels", () => {
  it("defaults a missing grade to 1", () => {
    const grouped = groupQrels([{ queryId: "q1", docId: "a" }]);
    assert.equal(grouped.get("q1")?.get("a"), 1);
  });
});

describe("evaluateRun", () => {
  const qrels: Qrel[] = [
    { queryId: "q1", docId: "a", grade: 2 },
    { queryId: "q1", docId: "b", grade: 1 },
    { queryId: "q2", docId: "c" },
  ];
  const runs: RunRanking[] = [
    { queryId: "q1", ranking: ["a", "b", "x"] },
    { queryId: "q2", ranking: ["y", "c"] },
  ];

  it("aggregates per-query scores and means", () => {
    const report = evaluateRun(qrels, runs, 3);
    assert.equal(report.summary.numQueries, 2);
    assert.equal(report.summary.numSkipped, 0);
    const q1 = report.queries.find((q) => q.queryId === "q1")!;
    assert.equal(q1.recall, 1);
    assert.equal(q1.reciprocalRank, 1);
    assert.equal(q1.ndcg, 1);
    const q2 = report.queries.find((q) => q.queryId === "q2")!;
    assert.equal(q2.recall, 1);
    assert.equal(q2.reciprocalRank, 0.5);
    assert.equal(report.summary.meanReciprocalRank, 0.75);
  });

  it("skips queries with no judged-relevant docs", () => {
    const report = evaluateRun([...qrels, { queryId: "q9", docId: "z", grade: 0 }], runs, 10);
    assert.deepEqual(report.skippedQueryIds, ["q9"]);
    assert.equal(report.summary.numQueries, 2);
  });

  it("treats a missing ranking as empty", () => {
    const report = evaluateRun(qrels, [{ queryId: "q1", ranking: ["a", "b"] }], 10);
    const q2 = report.queries.find((q) => q.queryId === "q2")!;
    assert.equal(q2.recall, 0);
    assert.equal(q2.reciprocalRank, 0);
  });
});
