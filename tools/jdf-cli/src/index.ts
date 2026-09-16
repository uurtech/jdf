import { validate } from "./commands/validate";
import { importMarkdown } from "./commands/import-md";
import { importPdf } from "./commands/import-pdf";
import { importJson } from "./commands/import-json";
import { chunkFile, type ChunkStrategy, type ChunkFormat } from "./commands/chunk";
import { embedFile, type EmbeddingProvider } from "./commands/embed";
import { transcribeFile } from "./commands/transcribe";
import { ragFolder } from "./commands/rag";
import { describeFile, type OcrProvider, type CaptionProvider } from "./commands/describe";

const HELP = `jdf — JSON Document Format CLI

The CLI exists for these workflows:
  • PDF → JDF        legacy documents become a structured JSON tree your
                     RAG / agent / pipeline can read natively.
  • JSON → JDF       LLMs and code emit JSON; this command wraps that JSON
                     into a validated .jdf (or .jdfx) you can ship.
  • JDF → chunks     turn a document into retrieval-ready chunks (RAG).
  • JDF → vectors    embed those chunks, incrementally, for a vector store.
  • video → text     attach a time-stamped transcript to a video element so
                     RAG retrieves "video at 02:13", not just "a video".
  • image → text     OCR + a vision caption for every image so charts and
                     scanned pages are retrievable, not skipped.
  • folder → index   one command over a directory of .jdf/.jdfx: transcribe,
                     describe, chunk, embed incrementally, write .jdf-rag/index.jsonl.
                     Reports media coverage; --strict fails when anything has no text.

Usage:
  jdf validate <file.jdf>
  jdf convert  <file.{pdf,json,md}> [-o output.{jdf,jdfx}] [--json] [--password PW] [--drop-invisible-text]
  jdf chunk    <file.{jdf,jdfx}> [--strategy section|element|fixed] [--format jsonl|json|inline] [--max-tokens N] [-o out]
  jdf embed    <file.{jdf,jdfx}> [--provider ollama|openai] [--model NAME] [--strategy …] [--incremental] [-o out]
  jdf transcribe <file.{jdf,jdfx}> [--from subs.srt|.vtt|.json] [--provider whisper-cli|openai] [--element ID] [--chapters FILE] [-o out]
  jdf describe <file.{jdf,jdfx}> [--ocr tesseract|openai|none] [--caption ollama|openai|none] [--caption-model M] [--ocr-language eng] [--element ID] [--force] [-o out]
  jdf rag      <dir> [--provider ollama|openai] [--model NAME] [--transcribe none|whisper-cli|openai] [--ocr none|tesseract|openai] [--caption none|ollama|openai] [--strict] [--no-embed] [--dry-run] [--out DIR]
  jdf --help

Commands:
  validate   Validate a .jdf / .jdfx file against the JDF schema
  convert    Convert a PDF, JSON, or Markdown file into JDF (alias: import)
  chunk      Split a JDF document into retrieval-ready chunks (offline, deterministic)
  embed      Compute embeddings for the chunks (local via Ollama by default)
  transcribe Store time-stamped text on a video element (import SRT/VTT/JSON, or run Whisper)
  describe   Give images text: OCR blocks (tesseract.js, local) + a caption (Ollama vision model, local)
  rag        Make a whole folder retrieval-ready (finds .jdf/.jdfx, transcribes, describes, chunks, embeds, indexes)

Flags:
  -o, --output <path>   Explicit output path
      --json            convert: force pure JSON .jdf output (inline base64
                        instead of a .jdfx zip bundle)
      --password <pw>   convert(pdf): password for an encrypted PDF
      --drop-invisible-text
                        convert(pdf): omit invisible (OCR-layer) text; by
                        default it is kept with opacity 0 so RAG / search
                        still see the words of a scanned PDF
      --strategy <s>    chunk/embed: section (default) | element | fixed
      --format <f>      chunk: jsonl (default) | json | inline
      --max-tokens <n>  chunk/embed: soft cap per chunk (default 512)
      --provider <p>    embed: ollama (default, local) | openai (remote API)
      --model <name>    embed: model id (default: nomic-embed-text / text-embedding-3-small)
      --incremental     embed: skip chunks whose content hash is unchanged
      --cache <path>    embed: sidecar to reuse vectors from (default: the
                        output path itself)
      --no-auto-start   embed(ollama): don't auto-launch Ollama via Docker
      --from <file>     transcribe: import subtitles (.srt / .vtt / JSON segments) — offline, no model
      --element <id|n>  transcribe: which video element (id, or 0-based index); default the only one
      --chapters <file> transcribe: JSON [{t,title}] or "mm:ss Title" lines → chapter breadcrumbs
      --language <tag>  transcribe: BCP-47 language hint for Whisper
      --prompt <text>   transcribe: Whisper vocabulary hint (names, acronyms) — not an instruction
      --window <sec>    chunk/embed/rag: transcript window per video chunk (default 45)
      --transcribe <p>  rag: none (default) | whisper-cli | openai — for videos that have no transcript yet
      --ocr <p>         describe/rag/convert: tesseract (local WASM) | openai | none
      --caption <p>     describe/rag: ollama (local vision model, default moondream) | openai | none
      --caption-model   describe/rag: vision model name (ollama: qwen2.5vl:3b, llava…; openai: gpt-4o-mini…)
      --ocr-language    describe: tesseract language(s), e.g. eng, tur, eng+tur (default eng)
      --force           describe: redo images that already have text
      --strict          rag: exit 1 if any image/video is still without text after the run
      --no-embed        rag: chunk + index only
      --dry-run         rag: list what would happen, write nothing
      --out <dir>       rag: index folder (default <dir>/.jdf-rag)
                        rag reads defaults from <dir>/jdf.rag.json (same keys as the flags; flags win)

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
  jdf transcribe talk.jdfx --from talk.srt --chapters chapters.txt   # then: jdf chunk talk.jdfx
  jdf transcribe talk.jdfx --provider openai --language en --prompt "JDF, jdfx, Ollama"
  jdf describe report.jdfx                                   # OCR (tesseract) + caption (Ollama qwen2.5vl), local
  jdf convert scan.pdf --ocr tesseract                       # scanned pages get OCR text instead of silence
  jdf rag ./knowledge-base --transcribe openai --ocr tesseract --caption ollama --strict
`;

// Flags that NEVER take a value, so the parser knows not to swallow the next
// token (otherwise `--json -o foo.jdf` would attach `-o` as the json value
// and mean the wrong thing).
const BOOLEAN_FLAGS = new Set(["help", "h", "json", "verbose", "skip-validate", "incremental", "no-auto-start", "drop-invisible-text", "no-embed", "dry-run", "force", "strict"]);

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
          await importPdf(input, output, {
            forceJson,
            password: typeof flags.password === "string" ? flags.password : undefined,
            dropInvisibleText: flags["drop-invisible-text"] === true,
            ocr: (typeof flags.ocr === "string" ? flags.ocr : undefined) as OcrProvider | undefined,
          });
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
          transcriptWindowSec: typeof flags.window === "string" ? parseInt(flags.window, 10) : undefined,
          output: typeof flags.output === "string" ? flags.output : undefined,
        });
        process.exit(0);
      }
      case "transcribe": {
        const input = positional[0];
        if (!input) { console.error("Usage: jdf transcribe <file.{jdf,jdfx}> [--from subs.srt|.vtt|.json] [--provider whisper-cli|openai] [--model M] [--language tag] [--element id|n] [--chapters file] [-o out]"); process.exit(1); }
        await transcribeFile(input, {
          from: typeof flags.from === "string" ? flags.from : undefined,
          provider: (typeof flags.provider === "string" ? flags.provider : undefined) as "whisper-cli" | "openai" | undefined,
          model: typeof flags.model === "string" ? flags.model : undefined,
          language: typeof flags.language === "string" ? flags.language : undefined,
          prompt: typeof flags.prompt === "string" ? flags.prompt : undefined,
          element: typeof flags.element === "string" ? flags.element : undefined,
          chapters: typeof flags.chapters === "string" ? flags.chapters : undefined,
          output: typeof flags.output === "string" ? flags.output : undefined,
        });
        process.exit(0);
      }
      case "describe": {
        const input = positional[0];
        if (!input) { console.error("Usage: jdf describe <file.{jdf,jdfx}> [--ocr tesseract|openai|none] [--caption ollama|openai|none] [--caption-model M] [--ocr-language eng] [--element id|n] [--force] [-o out]"); process.exit(1); }
        await describeFile(input, {
          ocr: (typeof flags.ocr === "string" ? flags.ocr : undefined) as OcrProvider | undefined,
          caption: (typeof flags.caption === "string" ? flags.caption : undefined) as CaptionProvider | undefined,
          captionModel: typeof flags["caption-model"] === "string" ? flags["caption-model"] : undefined,
          ocrLanguage: typeof flags["ocr-language"] === "string" ? flags["ocr-language"] : undefined,
          element: typeof flags.element === "string" ? flags.element : undefined,
          force: flags.force === true,
          output: typeof flags.output === "string" ? flags.output : undefined,
        });
        process.exit(process.exitCode ?? 0);
      }
      case "rag": {
        const input = positional[0];
        if (!input) { console.error("Usage: jdf rag <dir> [--provider ollama|openai] [--model NAME] [--strategy …] [--window sec] [--transcribe none|whisper-cli|openai] [--language tag] [--prompt text] [--no-embed] [--dry-run] [--out DIR]"); process.exit(1); }
        await ragFolder(input, {
          provider: (typeof flags.provider === "string" ? flags.provider : undefined) as EmbeddingProvider | undefined,
          model: typeof flags.model === "string" ? flags.model : undefined,
          strategy: (typeof flags.strategy === "string" ? flags.strategy : undefined) as ChunkStrategy | undefined,
          maxTokens: typeof flags["max-tokens"] === "string" ? parseInt(flags["max-tokens"], 10) : undefined,
          transcriptWindowSec: typeof flags.window === "string" ? parseInt(flags.window, 10) : undefined,
          transcribe: (typeof flags.transcribe === "string" ? flags.transcribe : undefined) as "none" | "whisper-cli" | "openai" | undefined,
          transcribeModel: typeof flags["transcribe-model"] === "string" ? flags["transcribe-model"] : undefined,
          language: typeof flags.language === "string" ? flags.language : undefined,
          prompt: typeof flags.prompt === "string" ? flags.prompt : undefined,
          ocr: (typeof flags.ocr === "string" ? flags.ocr : undefined) as OcrProvider | undefined,
          caption: (typeof flags.caption === "string" ? flags.caption : undefined) as CaptionProvider | undefined,
          captionModel: typeof flags["caption-model"] === "string" ? flags["caption-model"] : undefined,
          strict: flags.strict === true,
          noEmbed: flags["no-embed"] === true,
          dryRun: flags["dry-run"] === true,
          out: typeof flags.out === "string" ? flags.out : undefined,
        });
        process.exit(process.exitCode ?? 0);
      }
      case "embed": {
        const input = positional[0];
        if (!input) { console.error("Usage: jdf embed <file.{jdf,jdfx}> [--provider ollama|openai] [--model NAME] [--strategy …] [--incremental] [--cache prev.embeddings.json] [--no-auto-start] [-o out]"); process.exit(1); }
        await embedFile(input, {
          provider: (typeof flags.provider === "string" ? flags.provider : undefined) as EmbeddingProvider | undefined,
          model: typeof flags.model === "string" ? flags.model : undefined,
          strategy: (typeof flags.strategy === "string" ? flags.strategy : undefined) as ChunkStrategy | undefined,
          maxTokens: typeof flags["max-tokens"] === "string" ? parseInt(flags["max-tokens"], 10) : undefined,
          incremental: flags.incremental === true,
          transcriptWindowSec: typeof flags.window === "string" ? parseInt(flags.window, 10) : undefined,
          autoStart: flags["no-auto-start"] !== true,
          output: typeof flags.output === "string" ? flags.output : undefined,
          cache: typeof flags.cache === "string" ? flags.cache : undefined,
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
