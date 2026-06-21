import fs from "node:fs";
import path from "node:path";
import type { JdfDocument, Page, Element } from "@jdf/core";
import { packJdfx, shouldUseJdfx } from "../jdfx";

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

    // Bullet list
    if (line.match(/^\s*[-*+]\s/)) {
      const items: { content: string }[] = [];
      while (i < lines.length && lines[i].match(/^\s*[-*+]\s/)) {
        items.push({ content: lines[i].replace(/^\s*[-*+]\s+/, "").trim() });
        i++;
      }
      const height = items.length * 5 + 3;
      if (y + height > maxY) {
        pages.push({ id: `page-${pageNum}`, elements });
        elements = [];
        y = 5;
        pageNum++;
      }
      elements.push({
        type: "list",
        listType: "unordered",
        position: { x: 0, y },
        width: contentWidth,
        style: { fontFamily: "Inter", fontSize: 10, lineHeight: 1.6, color: "#334155" },
        items,
      });
      y += height;
      continue;
    }

    // Ordered list
    if (line.match(/^\s*\d+\.\s/)) {
      const items: { content: string }[] = [];
      while (i < lines.length && lines[i].match(/^\s*\d+\.\s/)) {
        items.push({ content: lines[i].replace(/^\s*\d+\.\s+/, "").trim() });
        i++;
      }
      const height = items.length * 5 + 3;
      if (y + height > maxY) {
        pages.push({ id: `page-${pageNum}`, elements });
        elements = [];
        y = 5;
        pageNum++;
      }
      elements.push({
        type: "list",
        listType: "ordered",
        position: { x: 0, y },
        width: contentWidth,
        style: { fontFamily: "Inter", fontSize: 10, lineHeight: 1.6, color: "#334155" },
        items,
      });
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
    // the start of another block (heading, unordered list, ordered list,
    // code fence). Without the ordered-list guard, "1. Step one" would be
    // absorbed into the previous paragraph and the list would vanish.
    let para = "";
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^\s*[-*+]\s/) &&
      !lines[i].match(/^\s*\d+\.\s/) &&
      !lines[i].startsWith("```")
    ) {
      para += (para ? " " : "") + lines[i].trim();
      i++;
    }
    const paraLines = Math.ceil(para.length / 80);
    const height = paraLines * 4.5 + 3;
    if (y + height > maxY) {
      pages.push({ id: `page-${pageNum}`, elements });
      elements = [];
      y = 5;
      pageNum++;
    }
    elements.push({
      type: "text",
      content: para,
      position: { x: 0, y },
      width: contentWidth,
      style: { fontFamily: "Inter", fontSize: 10, lineHeight: 1.6, color: "#334155" },
    });
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
