import { validate } from "./commands/validate";
import { importMarkdown } from "./commands/import-md";
import { importPdf } from "./commands/import-pdf";
import { importJson } from "./commands/import-json";

const HELP = `jdf — JSON Document Format CLI

The CLI exists for two workflows:
  • PDF → JDF        legacy documents become a structured JSON tree your
                     RAG / agent / pipeline can read natively.
  • JSON → JDF       LLMs and code emit JSON; this command wraps that JSON
                     into a validated .jdf (or .jdfx) you can ship.

Usage:
  jdf validate <file.jdf>
  jdf import <file.{pdf,json,md}> [-o output.{jdf,jdfx}] [--json]
  jdf --help

Commands:
  validate   Validate a .jdf / .jdfx file against the JDF schema
  import     Convert a PDF, JSON, or Markdown file into JDF

Flags:
  -o, --output <path>   Explicit output path (extension picks .jdf vs .jdfx)
      --json            Force pure JSON .jdf output (documents with embedded
                        images stay as a single base64-inlined .jdf instead
                        of a .jdfx bundle). Useful for RAG / CI consumers
                        that prefer one text file over a zip.

Examples:
  jdf validate spec/examples/hello-world.jdf
  jdf import paper.pdf                        # PDF → JDF (or .jdfx for images)
  jdf import contract.pdf --json | jq .       # PDF → pure JSON, pipe-friendly
  jdf import response.json -o response.jdf    # LLM JSON output → validated JDF
  jdf import README.md
`;

// Flags that NEVER take a value, so the parser knows not to swallow the next
// token (otherwise `--json -o foo.jdf` would attach `-o` as the json value
// and mean the wrong thing).
const BOOLEAN_FLAGS = new Set(["help", "h", "json", "verbose", "skip-validate"]);

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
      case "import": {
        const input = positional[0];
        if (!input) { console.error("Usage: jdf import <file.{pdf,json,md}> [-o output.jdf] [--json]"); process.exit(1); }
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
