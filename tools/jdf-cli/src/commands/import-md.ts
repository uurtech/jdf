import fs from "node:fs";
import path from "node:path";
import type { JdfDocument, Page, Element, RichTextRun } from "@jdf/core";
import { packJdfx, shouldUseJdfx } from "../jdfx";

/**
 * Inline markdown → JDF richtext runs. Handles **bold**, *italic* / _italic_,
 * `code`, and [text](url) links. Kept dependency-free (no `marked`) so the CLI
 * ships as a single bundle; mirrors what the reader's Rust importer
 * (pulldown_cmark) emits so `.md → .jdf` is consistent across CLI and reader.
 */
function parseInline(text: string): RichTextRun[] {
  const runs: RichTextRun[] = [];
  let i = 0;
  let buf = "";
  const flush = (extra?: Partial<RichTextRun>) => {
    if (buf) { runs.push({ text: buf, ...extra }); buf = ""; }
  };
  while (i < text.length) {
    const rest = text.slice(i);
    // Link [text](url)
    const link = rest.match(/^\[([^\]]+)\]\(([^)\s]+)[^)]*\)/);
    if (link) { flush(); runs.push({ text: link[1], link: link[2] }); i += link[0].length; continue; }
    // Inline code `code`
    const code = rest.match(/^`([^`]+)`/);
    if (code) { flush(); runs.push({ text: code[1], fontFamily: "JetBrains Mono", color: "#be185d" }); i += code[0].length; continue; }
    // Bold **x** or __x__
    const bold = rest.match(/^(\*\*|__)([^]+?)\1/);
    if (bold) { flush(); runs.push(...parseInline(bold[2]).map((r) => ({ ...r, bold: true }))); i += bold[0].length; continue; }
    // Italic *x* or _x_
    const ital = rest.match(/^(\*|_)([^]+?)\1/);
    if (ital) { flush(); runs.push(...parseInline(ital[2]).map((r) => ({ ...r, italic: true }))); i += ital[0].length; continue; }
    buf += text[i];
    i++;
  }
  flush();
  return runs.length ? runs : [{ text }];
}

/** True when any run carries formatting worth a richtext element. */
function hasFormatting(runs: RichTextRun[]): boolean {
  return runs.some((r) => r.bold || r.italic || r.link || r.fontFamily || r.color);
}

/** Strip inline markers to get plain text (for table cells / headings). */
function stripInline(text: string): string {
  return parseInline(text).map((r) => r.text).join("");
}

export async function importMarkdown(inputPath: string, outputPath?: string) {
  const input = path.resolve(inputPath);

  console.log(`Importing: ${input}`);
  const content = fs.readFileSync(input, "utf-8");
  const doc = convertMarkdownToJdf(content, path.basename(input, path.extname(input)), path.dirname(input));

  // Pick the right output extension. If the user gave an explicit name, honour it
  // (may force `.jdf` even when images are present — base64 stays inline). If we
  // pick the name, prefer `.jdfx` whenever the document has embedded assets.
  let output: string;
  if (outputPath) {
    output = path.resolve(outputPath);
  } else {
    const stem = input.replace(/\.(md|markdown)$/i, "");
    output = stem + (shouldUseJdfx(doc) ? ".jdfx" : ".jdf");
  }
  console.log(`Output:    ${output}`);

  if (output.toLowerCase().endsWith(".jdfx")) {
    const { bytes, manifest } = await packJdfx(doc);
    fs.writeFileSync(output, bytes);
    console.log(`\nDone! Created ${doc.pages.length} page(s), ${manifest.assets.length} asset(s) bundled`);
  } else {
    fs.writeFileSync(output, JSON.stringify(doc, null, 2));
    console.log(`\nDone! Created ${doc.pages.length} page(s)`);
  }
  console.log(`Open with: open -a "JDF Reader" "${output}"`);
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

function resolveImageSrc(src: string, baseDir: string): string {
  if (/^(https?:|data:|file:)/i.test(src)) return src;
  const abs = path.isAbsolute(src) ? src : path.resolve(baseDir, src);
  try {
    const bytes = fs.readFileSync(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const mime = MIME_BY_EXT[ext] || "application/octet-stream";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return src;
  }
}

function convertMarkdownToJdf(md: string, title: string, baseDir: string = process.cwd()): JdfDocument {
  const maxY = 247;
  const contentWidth = 166;
  const pages: Page[] = [];
  let elements: Element[] = [];
  let y = 5;
  let pageNum = 1;

  const lines = md.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const fontSize = level === 1 ? 22 : level === 2 ? 16 : level === 3 ? 13 : 11;
      const height = fontSize * 0.6;

      if (y + height > maxY) {
        pages.push({ id: `page-${pageNum}`, elements });
        elements = [];
        y = 5;
        pageNum++;
      }

      if (y > 10 && level <= 2) {
        elements.push({ type: "shape", shape: "rect", position: { x: 0, y }, width: contentWidth, height: 0.3, fill: "#e2e8f0" } as any);
        y += 4;
      }

      elements.push({
        type: "text",
        content: text,
        position: { x: 0, y },
        width: contentWidth,
        // Emit the actual H1..H6 level instead of `heading: true`. RAG
        // chunkers and the JDF TOC builder both key on the numeric level for
        // hierarchy; the boolean form collapsed every heading to one bucket.
        heading: level as 1 | 2 | 3 | 4 | 5 | 6,
        tocEntry: text,
        tocLevel: level,
        style: { fontFamily: "Inter", fontSize, fontWeight: "bold", color: level <= 2 ? "#0f172a" : "#1e293b" },
      });
      y += height + 4;
      i++;
      continue;
    }

    // Horizontal rule: ---, ***, ___ (3+)
    if (line.match(/^\s*([-*_])(\s*\1){2,}\s*$/)) {
      if (y + 6 > maxY) { pages.push({ id: `page-${pageNum}`, elements }); elements = []; y = 5; pageNum++; }
      elements.push({ type: "shape", shape: "rect", position: { x: 0, y: y + 2 }, width: contentWidth, height: 0.3, fill: "#cbd5e1" } as any);
      y += 6;
      i++;
      continue;
    }

    // GFM table: a header row of pipes followed by a |---|---| separator.
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1].match(/^\s*\|?[\s:|-]+\|?\s*$/) && lines[i + 1].includes("-")) {
      const splitRow = (r: string): string[] =>
        r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => stripInline(c.trim()));
      const headers = splitRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const height = (rows.length + 1) * 7 + 3;
      if (y + height > maxY) { pages.push({ id: `page-${pageNum}`, elements }); elements = []; y = 5; pageNum++; }
      elements.push({
        type: "table",
        headers,
        rows,
        position: { x: 0, y },
        width: contentWidth,
        borders: true,
        headerStyle: { backgroundColor: "#f1f5f9", fontWeight: "bold", fontSize: 10, color: "#0f172a" },
        rowStyle: { color: "#334155", fontSize: 10 },
        style: { fontFamily: "Inter", fontSize: 10 },
      } as any);
      y += height;
      continue;
    }

    // Blockquote: one or more leading-> lines.
    if (line.match(/^\s*>\s?/)) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].match(/^\s*>\s?/)) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const quote = quoteLines.join(" ").trim();
      const height = Math.ceil(quote.length / 70) * 4.5 + 6;
      if (y + height > maxY) { pages.push({ id: `page-${pageNum}`, elements }); elements = []; y = 5; pageNum++; }
      elements.push({
        type: "text",
        content: quote,
        position: { x: 0, y },
        width: contentWidth,
        style: { fontFamily: "Inter", fontSize: 10, lineHeight: 1.6, color: "#475569", fontStyle: "italic", backgroundColor: "#f8fafc", padding: 10, borderRadius: 6, marginTop: 4 },
      } as any);
      y += height;
      continue;
    }

    // Standalone image: ![alt](src)
    const imageMatch = line.match(/^\s*!\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)\s*$/);
    if (imageMatch) {
      const alt = imageMatch[1];
      const src = resolveImageSrc(imageMatch[2], baseDir);
      const height = 60;
      if (y + height > maxY) {
        pages.push({ id: `page-${pageNum}`, elements });
        elements = [];
        y = 5;
        pageNum++;
      }
      elements.push({
        type: "image",
        src,
        alt,
        position: { x: 0, y },
        width: contentWidth,
        height,
        fit: "contain",
      } as any);
      y += height + 4;
      i++;
      continue;
    }

    // List (ordered or unordered) — with nested children by indentation.
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s/);
    if (listMatch) {
      // Collect all consecutive list lines with their indent depth.
      const raw: { indent: number; ordered: boolean; content: string }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!m) break;
        raw.push({ indent: m[1].length, ordered: /\d/.test(m[2]), content: m[3].trim() });
        i++;
      }
      // Build a nested item tree keyed on indent. Each item's `content` is
      // inline-formatted only when it carries no children (JDF list items
      // hold a plain string); markers are stripped so the text stays clean.
      type LItem = { content: string; listType?: "ordered" | "unordered"; children?: LItem[] };
      const rootOrdered = raw[0].ordered;
      const root: LItem[] = [];
      const stack: { indent: number; items: LItem[] }[] = [{ indent: raw[0].indent, items: root }];
      for (const r of raw) {
        while (stack.length > 1 && r.indent < stack[stack.length - 1].indent) stack.pop();
        if (r.indent > stack[stack.length - 1].indent) {
          const parentItems = stack[stack.length - 1].items;
          const parent = parentItems[parentItems.length - 1];
          if (parent) {
            parent.children = parent.children || [];
            parent.listType = r.ordered ? "ordered" : "unordered";
            stack.push({ indent: r.indent, items: parent.children });
          }
        }
        stack[stack.length - 1].items.push({ content: stripInline(r.content) });
      }
      const count = raw.length;
      const height = count * 5 + 3;
      if (y + height > maxY) { pages.push({ id: `page-${pageNum}`, elements }); elements = []; y = 5; pageNum++; }
      elements.push({
        type: "list",
        listType: rootOrdered ? "ordered" : "unordered",
        position: { x: 0, y },
        width: contentWidth,
        style: { fontFamily: "Inter", fontSize: 10, lineHeight: 1.6, color: "#334155" },
        items: root,
      } as any);
      y += height;
      continue;
    }

    // Code block
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      const fenceLine = i;
      i++;
      let closed = false;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        closed = true;
        i++; // skip closing ```
      }
      if (!closed) {
        // Unterminated fence — emit a one-line warning so authors notice
        // (silent EOF-swallow used to lose any trailing markdown).
        console.warn(`[jdf-cli] warning: unterminated code fence at line ${fenceLine + 1} — content to EOF treated as code`);
      }
      const code = codeLines.join("\n");
      const height = codeLines.length * 4 + 8;
      if (y + height > maxY) {
        pages.push({ id: `page-${pageNum}`, elements });
        elements = [];
        y = 5;
        pageNum++;
      }
      elements.push({
        type: "text",
        content: code,
        position: { x: 0, y },
        width: contentWidth,
        style: { fontFamily: "JetBrains Mono", fontSize: 9, color: "#1e293b", backgroundColor: "#f1f5f9", padding: 8, borderRadius: 4, lineHeight: 1.5 },
      });
      y += height;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      y += 3;
      i++;
      continue;
    }

    // Normal paragraph — collect consecutive non-empty lines that aren't
    // the start of another block (heading, list, code fence, blockquote,
    // table, hr). Without these guards a "1. Step one" or "| a | b |" line
    // would be absorbed into the previous paragraph and the block would vanish.
    let para = "";
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^\s*([-*+]|\d+\.)\s/) &&
      !lines[i].startsWith("```") &&
      !lines[i].match(/^\s*>\s?/) &&
      !lines[i].match(/^\s*([-*_])(\s*\1){2,}\s*$/) &&
      !lines[i].includes("|")
    ) {
      para += (para ? " " : "") + lines[i].trim();
      i++;
    }
    // A line that matched none of the block rules but was excluded from the
    // paragraph collector (e.g. a stray "|" line that isn't a real table)
    // must still be consumed as plain text, or `i` never advances → hang.
    if (!para) {
      para = lines[i].trim();
      i++;
      if (!para) continue;
    }
    const paraLines = Math.ceil(para.length / 80);
    const height = paraLines * 4.5 + 3;
    if (y + height > maxY) {
      pages.push({ id: `page-${pageNum}`, elements });
      elements = [];
      y = 5;
      pageNum++;
    }
    // Emit richtext when the paragraph carries inline formatting (bold /
    // italic / code / link); plain text otherwise. This mirrors the reader's
    // Rust importer, which promotes formatted paragraphs to richtext.
    const runs = parseInline(para);
    if (hasFormatting(runs)) {
      elements.push({
        type: "richtext",
        runs,
        position: { x: 0, y },
        width: contentWidth,
        style: { fontFamily: "Inter", fontSize: 10, lineHeight: 1.6, color: "#334155" },
      } as any);
    } else {
      elements.push({
        type: "text",
        content: para,
        position: { x: 0, y },
        width: contentWidth,
        style: { fontFamily: "Inter", fontSize: 10, lineHeight: 1.6, color: "#334155" },
      });
    }
    y += height;
  }

  if (elements.length > 0) {
    pages.push({ id: `page-${pageNum}`, elements });
  }

  return {
    $jdf: "1.0.0",
    meta: {
      title,
      pageSize: "A4" as const,
      unit: "mm" as const,
      margins: { top: 25, right: 22, bottom: 25, left: 22 },
    },
    styles: {
      heading: { fontFamily: "Inter", fontSize: 22, fontWeight: "bold", color: "#0f172a" },
      body: { fontFamily: "Inter", fontSize: 10, lineHeight: 1.6, color: "#334155" },
    },
    pages,
  };
}
