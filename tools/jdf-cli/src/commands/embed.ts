import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chunkDocument, type Chunk, type ChunkStrategy } from "./chunk";
import JSZip from "jszip";
import type { JdfDocument } from "@jdf/core";
import { JDFX_DOCUMENT_PATH } from "@jdf/core";

/**
 * `jdf embed` — compute embeddings for a document's chunks and write an
 * embeddings sidecar (or inline block). Builds on `jdf chunk`: it calls the
 * exact same deterministic chunker, so chunk boundaries and hashes match what
 * `jdf chunk` produced. That shared determinism powers `--incremental`, which
 * skips chunks whose content hash hasn't changed since the last run — the core
 * RAG-ingestion speed win (edit one paragraph in a 500-page doc → 1 embedding
 * call, not 500).
 *
 * Unlike `jdf convert`, this is an OPTIONAL, cacheable step. The converter
 * stays pure and offline; embeddings live outside it and can be deleted and
 * regenerated at will — they are cache, never source of truth.
 *
 * Two providers, chosen with `--provider`:
 *   • ollama (DEFAULT) — fully LOCAL. Embeddings are computed on your machine;
 *     no data leaves it. If nothing is listening on the Ollama port the CLI
 *     offers to start it via Docker (`docker run … ollama/ollama`) and pulls
 *     the embedding model. OpenAI's models can't run locally, so local-first
 *     means Ollama.
 *   • openai — REMOTE API. Sends chunk text to OpenAI with your key; the CLI
 *     asks for the endpoint/key if they aren't set. Opt-in only.
 */

export type EmbeddingProvider = "ollama" | "openai";

export interface EmbeddedChunk extends Chunk {
  vector: number[];
}

export interface EmbeddingSidecar {
  model: string;
  provider: EmbeddingProvider;
  dims: number;
  chunker: string;
  /** Map of chunk id → { hash, vector } so re-runs can diff by hash. */
  vectors: Record<string, { hash: string; vector: number[] }>;
}

export interface EmbedOptions {
  provider?: EmbeddingProvider;
  model?: string;
  strategy?: ChunkStrategy;
  maxTokens?: number;
  /** Reuse cached vectors for chunks whose hash is unchanged. */
  incremental?: boolean;
  output?: string;
  /** Override where the previous sidecar is read from (defaults to output path). */
  cache?: string;
  /** ollama: auto-start via Docker if the port is dead (default true). */
  autoStart?: boolean;
}

/** Sensible default model per provider. */
const DEFAULT_MODEL: Record<EmbeddingProvider, string> = {
  ollama: "nomic-embed-text",
  openai: "text-embedding-3-small",
};

/** Provider registry — add Anthropic/Google here without touching callers. */
async function embedBatch(
  provider: EmbeddingProvider,
  model: string,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  switch (provider) {
    case "ollama":
      return embedOllama(model, inputs);
    case "openai":
      return embedOpenAI(model, inputs);
    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_CONTAINER = "jdf-ollama";

/** Is something answering on the Ollama port? */
async function ollamaUp(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** True only if the Docker daemon is actually running (not just the CLI installed). */
function dockerReady(): boolean {
  try { execFileSync("docker", ["info"], { stdio: "ignore" }); return true; }
  catch { return false; }
}

/**
 * Ensure a local Ollama is reachable. If not, and autoStart is on and Docker
 * exists, start `ollama/ollama` in a container and wait for it. Otherwise print
 * exactly what the user should run and throw.
 */
async function ensureOllama(model: string, autoStart: boolean): Promise<void> {
  if (await ollamaUp()) { await ollamaPull(model); return; }

  const manualHint =
    `  Option A — install Ollama natively (https://ollama.com), then:\n` +
    `      ollama serve   &&   ollama pull ${model}\n` +
    `  Option B — start Docker, then re-run this command (the CLI will launch Ollama for you), or run it yourself:\n` +
    `      docker run -d --name ${OLLAMA_CONTAINER} -p 11434:11434 -v jdf-ollama:/root/.ollama ollama/ollama\n` +
    `      docker exec ${OLLAMA_CONTAINER} ollama pull ${model}`;

  if (!autoStart) {
    throw new Error(`Ollama isn't running at ${OLLAMA_HOST} and --no-auto-start was given.\n${manualHint}`);
  }
  if (!dockerReady()) {
    throw new Error(
      `Ollama isn't running at ${OLLAMA_HOST}, and the Docker daemon isn't available to auto-start it.\n${manualHint}`,
    );
  }

  console.log(`Ollama not reachable — starting it via Docker (container "${OLLAMA_CONTAINER}")…`);
  // Reuse an existing container if present, else create one.
  try { execFileSync("docker", ["start", OLLAMA_CONTAINER], { stdio: "ignore" }); }
  catch {
    try {
      execFileSync("docker", [
        "run", "-d", "--name", OLLAMA_CONTAINER,
        "-p", "11434:11434", "-v", "jdf-ollama:/root/.ollama",
        "ollama/ollama",
      ], { stdio: "inherit" });
    } catch (e: any) {
      throw new Error(`Failed to start the Ollama container via Docker.\n${manualHint}`);
    }
  }
  // Wait for the daemon to answer.
  for (let i = 0; i < 30; i++) {
    if (await ollamaUp()) { console.log("  Ollama is up."); await ollamaPull(model); return; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Ollama container started but never became reachable on :11434.");
}

/** Pull the embedding model into Ollama if it isn't already present. */
async function ollamaPull(model: string): Promise<void> {
  // /api/show returns 200 if the model exists locally.
  try {
    const show = await fetch(`${OLLAMA_HOST}/api/show`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model }),
    });
    if (show.ok) return;
  } catch { /* fall through to pull */ }
  console.log(`Pulling embedding model "${model}" into Ollama (first run only)…`);
  const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama pull failed (${res.status}) for model "${model}".`);
  console.log("  Model ready.");
}

/** Ollama embeddings — one request per input (its /api/embeddings is single-input). */
async function embedOllama(model: string, inputs: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const text of inputs) {
    const res = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!res.ok) throw new Error(`Ollama embeddings ${res.status} for model "${model}".`);
    const json: any = await res.json();
    if (!Array.isArray(json.embedding)) throw new Error(`Ollama returned no embedding for model "${model}".`);
    out.push(json.embedding as number[]);
  }
  return out;
}

/** Prompt on an interactive TTY; return "" when not interactive (CI / pipe). */
async function prompt(question: string, hidden = false): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Best-effort masking for secrets: mute the output stream while typing.
  if (hidden) {
    const out = rl as any;
    out._writeToOutput = (s: string) => { if (s.trim().length) out.output.write("*"); else out.output.write(s); };
  }
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a.trim()); }));
}

// Resolved once per run so we don't prompt per batch.
let openaiCreds: { base: string; key: string } | null = null;

async function resolveOpenAICreds(): Promise<{ base: string; key: string }> {
  if (openaiCreds) return openaiCreds;
  // OPENAI_BASE_URL lets you point at Azure OpenAI, a proxy, or a local gateway.
  let base = process.env.OPENAI_BASE_URL || "";
  let key = process.env.OPENAI_API_KEY || "";
  if (!base) base = (await prompt("OpenAI API endpoint [https://api.openai.com/v1]: ")) || "https://api.openai.com/v1";
  if (!key) key = await prompt("OpenAI API key: ", true);
  if (!key) {
    throw new Error("No OpenAI API key. Set OPENAI_API_KEY (and optionally OPENAI_BASE_URL) or run interactively so the CLI can prompt.");
  }
  openaiCreds = { base: base.replace(/\/$/, ""), key };
  return openaiCreds;
}

async function embedOpenAI(model: string, inputs: string[]): Promise<number[][]> {
  const { base, key } = await resolveOpenAICreds();
  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: inputs }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI embeddings API ${res.status}: ${body.slice(0, 200)}`);
  }
  const json: any = await res.json();
  // Preserve request order (the API guarantees it, but sort by index to be safe).
  return (json.data as any[]).sort((a, b) => a.index - b.index).map((d) => d.embedding as number[]);
}

async function loadJdf(filePath: string): Promise<JdfDocument> {
  if (filePath.toLowerCase().endsWith(".jdfx")) {
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const docFile = zip.file(JDFX_DOCUMENT_PATH);
    if (!docFile) throw new Error(`Bundle missing ${JDFX_DOCUMENT_PATH}`);
    return JSON.parse(await docFile.async("string"));
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function loadCache(cachePath: string): EmbeddingSidecar | null {
  try {
    if (!fs.existsSync(cachePath)) return null;
    return JSON.parse(fs.readFileSync(cachePath, "utf-8"));
  } catch {
    return null;
  }
}

/** Batch chunk texts so we don't blow provider request-size limits. */
function batched<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function embedFile(inputPath: string, opts: EmbedOptions = {}): Promise<EmbeddingSidecar> {
  const input = path.resolve(inputPath);
  if (!fs.existsSync(input)) throw new Error(`File not found: ${input}`);

  const provider: EmbeddingProvider = opts.provider ?? "ollama"; // local-first default
  const model = opts.model ?? DEFAULT_MODEL[provider];
  const strategy = opts.strategy ?? "section";

  const doc = await loadJdf(input);
  const chunks = chunkDocument(doc, { strategy, maxTokens: opts.maxTokens });

  const output = opts.output ? path.resolve(opts.output) : input.replace(/\.(jdf|jdfx)$/i, ".embeddings.json");
  const cachePath = opts.cache ? path.resolve(opts.cache) : output;

  console.log(`Embedding: ${input}`);
  console.log(`Provider:  ${provider} / ${model}${provider === "ollama" ? " (local — no data leaves this machine)" : " (remote API)"}`);
  console.log(`Strategy:  ${strategy} → ${chunks.length} chunks`);

  // Local provider: make sure Ollama is reachable (auto-start via Docker if
  // allowed) and the model is pulled, before we start embedding.
  if (provider === "ollama") {
    await ensureOllama(model, opts.autoStart !== false);
  }

  // Incremental: reuse cached vectors whose hash still matches.
  const cache = opts.incremental ? loadCache(cachePath) : null;
  const cachedVectors = cache?.model === model ? cache.vectors : undefined;
  if (opts.incremental && cache && cache.model !== model) {
    console.log(`  (cache model ${cache.model} ≠ ${model} — re-embedding all)`);
  }

  const toEmbed: Chunk[] = [];
  const reused: Record<string, { hash: string; vector: number[] }> = {};
  for (const c of chunks) {
    const hit = cachedVectors?.[c.id];
    if (hit && hit.hash === c.hash) reused[c.id] = hit;
    else toEmbed.push(c);
  }

  if (opts.incremental) {
    console.log(`  Reused ${Object.keys(reused).length} cached, embedding ${toEmbed.length} changed/new.`);
  }

  const vectors: Record<string, { hash: string; vector: number[] }> = { ...reused };
  let dims = cache?.dims ?? 0;

  for (const batch of batched(toEmbed, 96)) {
    const embs = await embedBatch(provider, model, batch.map((c) => c.text));
    batch.forEach((c, i) => {
      vectors[c.id] = { hash: c.hash, vector: embs[i] };
      if (!dims) dims = embs[i].length;
    });
    console.log(`  Embedded ${Object.keys(vectors).length}/${chunks.length}…`);
  }

  const sidecar: EmbeddingSidecar = {
    model,
    provider,
    dims,
    chunker: `jdf-${strategy}-v1`,
    vectors,
  };

  fs.writeFileSync(output, JSON.stringify(sidecar));
  console.log(`\nDone! ${Object.keys(vectors).length} vectors (${dims}-dim) → ${output}`);
  return sidecar;
}
