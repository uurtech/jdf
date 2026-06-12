import { validate } from "./commands/validate";
import { importMarkdown } from "./commands/import-md";
import { importPdfPlaceholder } from "./commands/import-pdf";

const HELP = `jdf — JSON Document Format CLI

Usage:
  jdf validate <file.jdf>
  jdf import <file.{md,pdf}> [-o output.jdf]
  jdf --help

Commands:
  validate   Validate a .jdf file against the JDF schema
  import     Convert a markdown or PDF file to JDF

Examples:
  jdf validate spec/examples/hello-world.jdf
  jdf import README.md
  jdf import paper.pdf -o paper.jdf
`;

function parseArgs(argv: string[]): { command?: string; positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (i === 0 && !a.startsWith("-")) { command = a; continue; }
    if (a === "--help" || a === "-h") { flags["help"] = true; continue; }
    if (a.startsWith("--")) { const k = a.slice(2); const next = argv[i + 1]; if (next && !next.startsWith("-")) { flags[k] = next; i++; } else flags[k] = true; continue; }
    if (a === "-o" || a === "--output") { const next = argv[i + 1]; if (next) { flags["output"] = next; i++; } continue; }
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
        if (!input) { console.error("Usage: jdf import <file.{md,pdf}> [-o output.jdf]"); process.exit(1); }
        const output = typeof flags.output === "string" ? flags.output : undefined;
        const lower = input.toLowerCase();
        if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
          await importMarkdown(input, output);
        } else if (lower.endsWith(".pdf")) {
          await importPdfPlaceholder(input, output);
        } else {
          console.error(`Unsupported file type: ${input}`);
          process.exit(1);
        }
        break;
      }
      default:
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (e: any) {
    console.error(`Error: ${e.message || e}`);
    process.exit(1);
  }
}

main();
