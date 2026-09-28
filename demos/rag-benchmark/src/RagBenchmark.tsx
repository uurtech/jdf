import React from "react";
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, Easing } from "remotion";
import { DURATION_SEC } from "./timeline";
import bench from "../../../docs/bench.json";
import { FPS, DURATION_FRAMES, T, s, BEAT } from "./timeline";

// Hard cuts, slams, one bar race — no slides. Timeline in ./timeline.ts; soundtrack fetched by scripts/fetch-music.ts.
export { FPS, DURATION_FRAMES };

const font = "Inter, -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const mono = "'JetBrains Mono', ui-monospace, Menlo, monospace";
const C = { bg: "#05080f", text: "#f8fafc", soft: "#94a3b8", jdf: "#60a5fa", jdf2: "#2563eb", conv: "#a5b4fc", pdf: "#64748b", pdf2: "#94a3b8", good: "#34d399", bad: "#f87171" };

// ── data (docs/bench.json) ───────────────────────────────────────────────────
type Pipe = (typeof bench.accuracy.pipelines)[number];
const acc = bench.accuracy;
const cost = bench.cost!;
const pipes = acc.pipelines as Pipe[];
const jdf = pipes.find((p) => p.id === "jdf")!;
const conv = pipes.find((p) => p.format === "jdf-converted");
const R = (p: Pipe, r: string) => (p.retrievers as any)[r].all as Record<string, number>;
const bestPdf = (r: string, m: string) => pipes.filter((p) => p.format === "pdf").sort((a, b) => R(b, r)[m] - R(a, r)[m])[0];
const label = (r: string) => (r === "bm25" ? "BM25" : r.replace(/^dense:/, "").split("/").pop()!.replace("-en-v1.5", "").replace("all-", ""));
const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
const pc0 = (x: number) => `${Math.round(x * 100)}%`;
const int = (x: number) => Math.round(x).toLocaleString("en-US");
const money = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
const cj = cost.sides.find((x) => x.id === "jdf")!, cp = cost.sides.find((x) => x.id !== "jdf")!;
const lk = Object.keys(cost.prices.llm_input)[0], ek = Object.keys(cost.prices.embedding)[0];
const jq = (cj.query!.usd as any)[lk] as number, pq = (cp.query!.usd as any)[lk] as number;
const cut = 1 - jq / pq, saved = pq - jq;
const reindexX = ((cp.reindex.usd as any)[ek] as number) / ((cj.reindex.usd as any)[ek] as number);
const accPts = (cj.accuracy!.recallAt1000Tok - cp.accuracy!.recallAt1000Tok) * 100;
// Two retrievers for the race: the headline model, then the one where the JDF-vs-best-PDF gap is widest (a near-tie is a wasted scene).
const gap = (r: string) => R(jdf, r).recallAt1000Tok - R(bestPdf(r, "recallAt1000Tok"), r).recallAt1000Tok;
const retrievers = [acc.headline, ...Object.keys(jdf.retrievers).filter((r) => r !== acc.headline).sort((a, b) => gap(b) - gap(a)).slice(0, 1)];

// ── fx ───────────────────────────────────────────────────────────────────────
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
/** Ease-out that really reaches 1: Remotion's Easing.exp tops out at 1 − 2⁻¹⁰, which left counters at $9,396 instead of $9,405. */
const easeOut = (f: number, from: number, to: number) => (f >= to ? 1 : interpolate(f, [from, to], [0, 1], { ...clamp, easing: Easing.out(Easing.exp) }));
const slam = (frame: number, at: number) => {
  const f = frame - s(at);
  const p = spring({ frame: f, fps: FPS, config: { damping: 16, stiffness: 180, mass: 0.9 } });
  const shake = f >= 0 && f < 12 ? Math.sin(f * 2.2) * (12 - f) * 1.2 : 0;
  return { scale: 1.6 - 0.6 * p, opacity: f < 0 ? 0 : Math.min(1, f / 3), shake, glitch: f >= 0 && f < 6 };
};
const flash = (frame: number, at: number) => interpolate(frame - s(at), [0, 1, 4], [0, 0.55, 0], clamp);
const Cut: React.FC<{ from: number; to: number; children: React.ReactNode }> = ({ from, to, children }) => {
  const frame = useCurrentFrame();
  if (frame < s(from) || frame >= s(to)) return null;
  return <AbsoluteFill>{children}</AbsoluteFill>;
};
const Bg: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 40%, #0f1a33 0%, ${C.bg} 70%)` }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(96,165,250,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(96,165,250,0.06) 1px, transparent 1px)", backgroundSize: "64px 64px", transform: `translateY(${(frame * 0.6) % 64}px)` }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0 2px, transparent 2px 4px)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: ((frame * 9) % 800) - 60, height: 60, background: "linear-gradient(180deg, transparent, rgba(96,165,250,0.08), transparent)" }} />
      <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 220px rgba(0,0,0,0.85)" }} />
    </AbsoluteFill>
  );
};
const Glitch: React.FC<{ on: boolean; children: React.ReactNode; style?: React.CSSProperties }> = ({ on, children, style }) => (
  <div style={{ position: "relative", ...style }}>
    {on && <div style={{ position: "absolute", inset: 0, color: "#f87171", transform: "translate(-4px, 0)", opacity: 0.7, mixBlendMode: "screen" }} aria-hidden>{children}</div>}
    {on && <div style={{ position: "absolute", inset: 0, color: "#22d3ee", transform: "translate(4px, 0)", opacity: 0.7, mixBlendMode: "screen" }} aria-hidden>{children}</div>}
    <div>{children}</div>
  </div>
);
const Slam: React.FC<{ at: number; size?: number; color?: string; children: React.ReactNode; sub?: string }> = ({ at, size = 150, color = C.text, children, sub }) => {
  const frame = useCurrentFrame();
  const a = slam(frame, at);
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", opacity: a.opacity, transform: `translate(${a.shake}px, ${-a.shake * 0.6}px) scale(${a.scale})`, fontFamily: font, textAlign: "center" }}>
      <Glitch on={a.glitch}><div style={{ fontSize: size, fontWeight: 900, letterSpacing: -4, lineHeight: 0.95, color }}>{children}</div></Glitch>
      {sub && <div style={{ fontSize: 26, color: C.soft, marginTop: 18, letterSpacing: 4, textTransform: "uppercase" }}>{sub}</div>}
    </div>
  );
};
const Flash: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const o = flash(frame, at);
  return o > 0 ? <AbsoluteFill style={{ background: "#fff", opacity: o }} /> : null;
};
const Tag: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: "absolute", left: 48, top: 36, fontFamily: mono, fontSize: 15, letterSpacing: 3, color: C.soft, textTransform: "uppercase" }}>{children}</div>
);

// ── 0.0–1.0 cold open ────────────────────────────────────────────────────────
const Open: React.FC = () => {
  const frame = useCurrentFrame();
  const words = [`${acc.corpus.documents} REPORTS`, `${acc.corpus.questions} QUESTIONS`, "SAME PIPELINE"];
  const per = s(BEAT) / words.length;
  const i = Math.min(words.length - 1, Math.floor(frame / per));
  const local = frame - i * per;
  const show = frame < s(BEAT);
  const a = slam(frame, BEAT);
  return (
    <>
      {show && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font }}>
          <Glitch on={local < 2}><div style={{ fontSize: 96, fontWeight: 900, letterSpacing: 6, color: C.text }}>{words[i]}</div></Glitch>
        </div>
      )}
      {!show && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font, opacity: a.opacity, transform: `translate(${a.shake}px,0) scale(${a.scale})` }}>
          <Glitch on={a.glitch}><div style={{ fontSize: 170, fontWeight: 900, letterSpacing: -6 }}><span style={{ color: C.pdf }}>PDF</span> <span style={{ color: C.soft, fontWeight: 300 }}>vs</span> <span style={{ color: C.jdf }}>JDF</span></div></Glitch>
        </div>
      )}
      <Flash at={BEAT} />
    </>
  );
};

// ── 1.0–3.4 bar race across three retrievers ─────────────────────────────────
const Race: React.FC = () => {
  const frame = useCurrentFrame();
  const per = (T.tokens - T.race) / retrievers.length;
  const idx = Math.min(retrievers.length - 1, Math.floor((frame - s(T.race)) / s(per)));
  const r = retrievers[idx];
  const start = s(T.race) + idx * s(per);
  const best = bestPdf(r, "recallAt1000Tok");
  const rows = [
    { name: "JDF", v: R(jdf, r).recallAt1000Tok, c: [C.jdf2, C.jdf] },
    ...(conv ? [{ name: "PDF → JDF", v: R(conv, r).recallAt1000Tok, c: ["#6366f1", C.conv] }] : []),
    { name: `PDF · ${best.tool.split(" ")[0]}`, v: R(best, r).recallAt1000Tok, c: [C.pdf, C.pdf2] },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: font, color: C.text }}>
      <Tag>answer inside the first 1,000 tokens · higher is better</Tag>
      <div style={{ position: "absolute", right: 48, top: 30, fontFamily: mono, fontSize: 30, fontWeight: 700, color: C.jdf, border: `2px solid ${C.jdf}`, borderRadius: 10, padding: "6px 18px", transform: `scale(${1 + 0.25 * Math.max(0, 1 - (frame - start) / 12)})` }}>{label(r)}</div>
      <div style={{ position: "absolute", left: 48, right: 48, top: 150, display: "grid", gap: 26 }}>
        {rows.map((row, i) => {
          const p = easeOut(frame - start - i * 4, 0, 30);
          return (
            <div key={row.name} style={{ display: "grid", gridTemplateColumns: "380px 1fr 190px", alignItems: "center", gap: 24 }}>
              <div style={{ fontSize: 40, fontWeight: 800, color: i === 0 ? C.jdf : i === 1 && conv ? C.conv : C.text }}>{row.name}</div>
              <div style={{ height: 64, background: "rgba(148,163,184,0.1)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${row.v * 100 * p}%`, background: `linear-gradient(90deg, ${row.c[0]}, ${row.c[1]})`, boxShadow: i === 0 ? `0 0 40px ${C.jdf}88` : "none" }} />
              </div>
              <div style={{ fontFamily: mono, fontSize: 54, fontWeight: 700, textAlign: "right", color: i === 0 ? C.jdf : C.text }}>{pc(row.v * p)}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 48, bottom: 40, fontSize: 20, color: C.soft }}>same questions · same embeddings · JDF leads with every retriever tested</div>
      <Flash at={T.race} />
    </div>
  );
};

// ── 3.4–4.6 tokens → −38% ────────────────────────────────────────────────────
const Tokens: React.FC = () => {
  const frame = useCurrentFrame();
  const f = frame - s(T.tokens);
  const p = interpolate(f, [0, s(1.5)], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const t1 = cj.query!.ctxTokensPerQuery, t2 = cp.query!.ctxTokensPerQuery;
  const punch = f >= s(BEAT);
  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: font, color: C.text }}>
      <Tag>tokens handed to the LLM per question</Tag>
      {!punch && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 90 }}>
          <div style={{ textAlign: "center" }}><div style={{ fontFamily: mono, fontSize: 150, fontWeight: 700, color: C.jdf }}>{int(t1 * p)}</div><div style={{ fontSize: 30, color: C.jdf }}>JDF</div></div>
          <div style={{ fontSize: 60, color: C.soft }}>vs</div>
          <div style={{ textAlign: "center" }}><div style={{ fontFamily: mono, fontSize: 150, fontWeight: 700, color: C.pdf2 }}>{int(t2 * p)}</div><div style={{ fontSize: 30, color: C.soft }}>PDF</div></div>
        </div>
      )}
      {punch && <Slam at={T.tokens + BEAT} color={C.good} sub={`LLM spend per query · ${(cost.prices.llm_input as any)[lk].label.replace(" input", "")}`}>−{pc0(cut)}</Slam>}
      <Flash at={T.tokens + BEAT} />
    </div>
  );
};

// ── 4.6–5.8 re-index → 16× ───────────────────────────────────────────────────
const Reindex: React.FC = () => {
  const frame = useCurrentFrame();
  const n = acc.jdfOnly.corpusChunks, cols = 32, size = 30, gap = 7;
  const f = frame - s(T.reindex);
  const flood = interpolate(f, [s(0.4), s(1.6)], [0, 1], clamp);
  const punch = f >= s(BEAT);
  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: font, color: C.text }}>
      <Tag>edit one paragraph · what gets re-embedded?</Tag>
      {!punch && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${size}px)`, gap }}>
            {Array.from({ length: n }).map((_, i) => {
              const isChanged = i === 7;
              const pdfRed = flood > i / n;
              const bg = isChanged ? C.good : pdfRed ? C.bad : "rgba(96,165,250,0.25)";
              return <div key={i} style={{ width: size, height: size, borderRadius: 6, background: bg, boxShadow: isChanged ? `0 0 26px ${C.good}` : pdfRed ? `0 0 10px ${C.bad}66` : "none" }} />;
            })}
          </div>
          <div style={{ position: "absolute", left: 48, bottom: 40, fontSize: 26, display: "flex", gap: 40 }}>
            <span style={{ color: C.good, fontWeight: 800 }}>JDF: {acc.jdfOnly.chunksReembedded} of {n}</span>
            <span style={{ color: C.bad, fontWeight: 800, opacity: flood }}>PDF: every chunk of every file</span>
          </div>
        </div>
      )}
      {punch && <Slam at={T.reindex + BEAT} sub="cheaper re-indexing">{reindexX >= 10 ? Math.round(reindexX) : reindexX.toFixed(1)}×</Slam>}
      <Flash at={T.reindex + BEAT} />
    </div>
  );
};

// ── money: 10× scale, clearly marked as an estimate ──────────────────────────
const Money: React.FC = () => {
  const frame = useCurrentFrame();
  const f = frame - s(T.money);
  const p = easeOut(f, 2, s(1.5));
  const a = slam(frame, T.money);
  const sub = interpolate(f, [s(1.2), s(1.8)], [0, 1], clamp);
  const SCALE = 10;
  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: font, color: C.text }}>
      <Tag>per {int(cost.queries * SCALE)} questions · scales with questions asked</Tag>
      <div style={{ position: "absolute", right: 48, top: 30, fontFamily: mono, fontSize: 22, fontWeight: 700, color: C.bad, border: `2px solid ${C.bad}`, borderRadius: 10, padding: "6px 16px", letterSpacing: 2 }}>ESTIMATED</div>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", opacity: a.opacity, transform: `translate(${a.shake}px, 0) scale(${a.scale})` }}>
        <Glitch on={a.glitch}><div style={{ fontFamily: mono, fontSize: 210, fontWeight: 700, color: C.good, letterSpacing: -8, lineHeight: 1 }}>{money(saved * SCALE * p)}</div></Glitch>
        <div style={{ fontSize: 34, letterSpacing: 6, textTransform: "uppercase", color: C.text, marginTop: 10 }}>saved</div>
        <div style={{ marginTop: 34, display: "flex", gap: 60, opacity: sub, transform: `translateY(${(1 - sub) * 20}px)` }}>
          <div style={{ textAlign: "center" }}><div style={{ fontFamily: mono, fontSize: 56, fontWeight: 700, color: C.jdf }}>{money(saved)}</div><div style={{ fontSize: 19, color: C.soft }}>measured · per 1M questions</div></div>
          <div style={{ textAlign: "center" }}><div style={{ fontFamily: mono, fontSize: 56, fontWeight: 700, color: C.text }}>×{SCALE} questions</div><div style={{ fontSize: 19, color: C.soft }}>linear estimate · not measured</div></div>
          <div style={{ textAlign: "center" }}><div style={{ fontFamily: mono, fontSize: 56, fontWeight: 700, color: C.jdf }}>+{accPts.toFixed(0)} pts</div><div style={{ fontSize: 19, color: C.soft }}>accuracy · {(cost.prices.llm_input as any)[lk].label.replace(" input", "")} prices</div></div>
        </div>
      </div>
      <Flash at={T.money} />
    </div>
  );
};

// ── 7.6–8.8 only PDFs? convert ───────────────────────────────────────────────
const Convert: React.FC = () => {
  const frame = useCurrentFrame();
  const f = frame - s(T.convert);
  const typed = "$ jdf convert report.pdf".slice(0, Math.min(24, Math.floor((f / s(1.5)) * 24)));
  const punch = f >= s(BEAT);
  const r = acc.headline;
  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: font, color: C.text }}>
      <Tag>only have PDFs?</Tag>
      {!punch && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontFamily: mono, fontSize: 70, fontWeight: 700, color: C.text }}>{typed}<span style={{ opacity: Math.floor(f / 3) % 2 ? 0 : 1 }}>▌</span></div>
        </div>
      )}
      {punch && conv && (
        <Slam at={T.convert + BEAT} size={130} color={C.conv} sub={`top-1 after jdf convert · native JDF ${pc(R(jdf, r).recall1)} · best raw PDF ${pc(R(bestPdf(r, "recall1"), r).recall1)}`}>{pc(R(conv, r).recall1)}</Slam>
      )}
      <Flash at={T.convert + BEAT} />
    </div>
  );
};

// ── 8.8–10 outro ─────────────────────────────────────────────────────────────
const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const f = frame - s(T.outro);
  const a = slam(frame, T.outro);
  const cmd = "python rag_bench.py --verify".slice(0, Math.max(0, Math.floor((f - s(0.6)) * 0.7)));
  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: font, color: C.text }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", opacity: a.opacity, transform: `translate(${a.shake}px,0) scale(${a.scale})` }}>
        <Glitch on={a.glitch}><div style={{ fontSize: 84, fontWeight: 900, letterSpacing: -2 }}>MEASURED. <span style={{ color: C.jdf }}>NOT CLAIMED.</span></div></Glitch>
        <div style={{ marginTop: 28, fontFamily: mono, fontSize: 30, color: C.good }}><span style={{ color: C.soft }}>$ </span>{cmd}<span style={{ opacity: Math.floor(f / 3) % 2 ? 0 : 1 }}>▌</span></div>
        <div style={{ marginTop: 26, fontSize: 20, color: C.soft }}>jdf.dev · bench/ · {acc.date}</div>
      </div>
      <Flash at={T.outro} />
    </div>
  );
};

export const RagBenchmark: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    {/* "Epical Drums 02" — Grigoriy Nuzhny, Mixkit Stock Music Free License (fetched by scripts/fetch-music.ts). Fade in, duck slightly under the money slam, fade out. */}
    <Audio src={staticFile("music.mp3")} volume={(f) => interpolate(f, [0, 20, s(DURATION_SEC) - 40, s(DURATION_SEC)], [0, 0.85, 0.85, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    <Bg />
    <Cut from={T.open} to={T.race}><Open /></Cut>
    <Cut from={T.race} to={T.tokens}><Race /></Cut>
    <Cut from={T.tokens} to={T.reindex}><Tokens /></Cut>
    <Cut from={T.reindex} to={T.money}><Reindex /></Cut>
    <Cut from={T.money} to={T.convert}><Money /></Cut>
    <Cut from={T.convert} to={T.outro}><Convert /></Cut>
    <Cut from={T.outro} to={T.end}><Outro /></Cut>
  </AbsoluteFill>
);
