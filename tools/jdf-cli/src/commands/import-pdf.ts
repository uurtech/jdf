export async function importPdfPlaceholder(_inputPath: string, _outputPath?: string): Promise<void> {
  console.error("PDF import via CLI is not yet wired up — run the JDF Reader app and use Open / drag-drop, which uses the Rust pdf-extract pipeline.");
  console.error("Track progress at: https://github.com/uurtech/jdf");
  process.exit(2);
}
