import { validate } from "./commands/validate";
import { importMarkdown } from "./commands/import-md";
import { importPdf } from "./commands/import-pdf";
import { importJson } from "./commands/import-json";
import { chunkFile, type ChunkStrategy, type ChunkFormat } from "./commands/chunk";
import { embedFile, type EmbeddingProvider } from "./commands/embed";

const HELP = `jdf — JSON Document Format CLI

The CLI exists for these workflows:
  • PDF → JDF        legacy documents become a structured JSON tree your
                     RAG / agent / pipeline can read natively.
  • JSON → JDF       LLMs and code emit JSON; this command wraps that JSON
                     into a validated .jdf (or .jdfx) you can ship.
  • JDF → chunks     turn a document into retrieval-ready chunks (RAG).
  • JDF → vectors    embed those chunks, incrementally, for a vector store.

Usage:
  jdf validate <file.jdf>
  jdf convert  <file.{pdf,json,md}> [-o output.{jdf,jdfx}] [--json]
  jdf chunk    <file.{jdf,jdfx}> [--strategy section|element|fixed] [--format jsonl|json|inline] [--max-tokens N] [-o out]
  jdf embed    <file.{jdf,jdfx}> [--provider ollama|openai] [--model NAME] [--strategy …] [--incremental] [-o out]
  jdf --help

Commands:
  validate   Validate a .jdf / .jdfx file against the JDF schema
  convert    Convert a PDF, JSON, or Markdown file into JDF (alias: import)
  chunk      Split a JDF document into retrieval-ready chunks (offline, deterministic)
  embed      Compute embeddings for the chunks (local via Ollama by default)

Flags:
  -o, --output <path>   Explicit output path
      --json            convert: force pure JSON .jdf output (inline base64
                        instead of a .jdfx zip bundle)
      --strategy <s>    chunk/embed: section (default) | element | fixed
      --format <f>      chunk: jsonl (default) | json | inline
      --max-tokens <n>  chunk/embed: soft cap per chunk (default 512)
      --provider <p>    embed: ollama (default, local) | openai (remote API)
      --model <name>    embed: model id (default: nomic-embed-text / text-embedding-3-small)
      --incremental     embed: skip chunks whose content hash is unchanged
      --no-auto-start   embed(ollama): don't auto-launch Ollama via Docker

Environment (embed):
  ollama:  OLLAMA_HOST (default http://localhost:11434)
  openai:  OPENAI_API_KEY (required), OPENAI_BASE_URL (default api.openai.com)

Examples:
  jdf validate spec/examples/hello-world.jdf
  jdf convert paper.pdf                        # PDF → JDF (or .jdfx for images)
  jdf convert response.json -o response.jdf    # LLM JSON output → validated JDF
  jdf chunk report.jdf                         # → report.chunks.jsonl (RAG-ready)
  jdf chunk report.jdf --format inline         # embed the chunk index into the .jdf
  jdf embed report.jdf                          # local embeddings via Ollama (auto-setup)
  jdf embed report.jdf --provider openai --incremental
`;

// Flags that NEVER take a value, so the parser knows not to swallow the next
// token (otherwise `--json -o foo.jdf` would attach `-o` as the json value
// and mean the wrong thing).
const BOOLEAN_FLAGS = new Set(["help", "h", "json", "verbose", "skip-validate", "incremental", "no-auto-start"]);

function parseArgs(argv: string[]): { command?: string; positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (i === 0 && !a.startsWith("-")) { command = a; continue; }
    if (a === "--help" || a === "-h") { flags["help"] = true; continue; }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
      const inlineVal = eq > 0 ? a.slice(eq + 1) : undefined;
      if (inlineVal !== undefined) {
        flags[k] = inlineVal;
        continue;
      }
      if (BOOLEAN_FLAGS.has(k)) { flags[k] = true; continue; }
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) { flags[k] = next; i++; }
      else flags[k] = true;
      continue;
    }
    if (a === "-o" || a === "--output") {
      const next = argv[i + 1];
      // Reject flag tokens after -o so `jdf import f.json -o --json` doesn't
      // produce a file literally named "--json" and silently drop --json.
      if (next === undefined || next.startsWith("-")) {
        console.error(`Error: ${a} requires a path argument`);
        process.exit(1);
      }
      flags["output"] = next;
      i++;
      continue;
    }
    positional.push(a);
  }
  return { command, positional, flags };
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  if (!command || flags.help) {
    console.log(HELP);
    process.exit(command ? 0 : 1);
  }

  try {
    switch (command) {
      case "validate": {
        if (!positional[0]) { console.error("Usage: jdf validate <file.jdf>"); process.exit(1); }
        const ok = await validate(positional[0]);
        process.exit(ok ? 0 : 1);
      }
      // `convert` is the headline verb; `import` stays as a back-compat alias
      // so existing scripts and docs keep working.
      case "convert":
      case "import": {
        const input = positional[0];
        if (!input) { console.error("Usage: jdf convert <file.{pdf,json,md}> [-o output.jdf] [--json]"); process.exit(1); }
        const output = typeof flags.output === "string" ? flags.output : undefined;
        const forceJson = flags.json === true;
        const lower = input.toLowerCase();
        if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
          await importMarkdown(input, output);
          process.exit(0);
        } else if (lower.endsWith(".pdf")) {
          await importPdf(input, output, { forceJson });
          // PDF.js leaves worker timers / fake-worker tasks on the loop after
          // import resolves. Force a clean exit so the CLI returns control
          // immediately instead of hanging on idle handles.
          process.exit(0);
        } else if (lower.endsWith(".json")) {
          await importJson(input, output, { forceJson });
          process.exit(0);
        } else {
          console.error(`Unsupported file type: ${input}`);
          process.exit(1);
        }
      }
      case "chunk": {
        const input = positional[0];
        if (!input) { console.error("Usage: jdf chunk <file.{jdf,jdfx}> [--strategy section|element|fixed] [--format jsonl|json|inline] [--max-tokens N] [-o out]"); process.exit(1); }
        await chunkFile(input, {
          strategy: (typeof flags.strategy === "string" ? flags.strategy : undefined) as ChunkStrategy | undefined,
          format: (typeof flags.format === "string" ? flags.format : undefined) as ChunkFormat | undefined,
          maxTokens: typeof flags["max-tokens"] === "string" ? parseInt(flags["max-tokens"], 10) : undefined,
          output: typeof flags.output === "string" ? flags.output : undefined,
        });
        process.exit(0);
      }
      case "embed": {
        const input = positional[0];
        if (!input) { console.error("Usage: jdf embed <file.{jdf,jdfx}> [--provider ollama|openai] [--model NAME] [--strategy …] [--incremental] [--no-auto-start] [-o out]"); process.exit(1); }
        await embedFile(input, {
          provider: (typeof flags.provider === "string" ? flags.provider : undefined) as EmbeddingProvider | undefined,
          model: typeof flags.model === "string" ? flags.model : undefined,
          strategy: (typeof flags.strategy === "string" ? flags.strategy : undefined) as ChunkStrategy | undefined,
          maxTokens: typeof flags["max-tokens"] === "string" ? parseInt(flags["max-tokens"], 10) : undefined,
          incremental: flags.incremental === true,
          autoStart: flags["no-auto-start"] !== true,
          output: typeof flags.output === "string" ? flags.output : undefined,
        });
        process.exit(0);
      }
      default:
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (e: any) {
    // ImportJsonError already prefixes a sensible "what went wrong" message;
    // don't double-prefix with "Error:" so CI logs stay clean.
    if (e?.name === "ImportJsonError") {
      console.error(`✗ ${e.message}`);
    } else {
      console.error(`Error: ${e?.message || e}`);
    }
    process.exit(1);
  }
}

main();
