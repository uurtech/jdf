import fs from "node:fs";
import path from "node:path";
import type { JdfDocument, Page, Element } from "@jdf/core";

export async function importMarkdown(inputPath: string, outputPath?: string) {
  const input = path.resolve(inputPath);
  const output = outputPath
    ? path.resolve(outputPath)
    : input.replace(/\.(md|markdown)$/i, ".jdf");

  console.log(`Importing: ${input}`);
  console.log(`Output:    ${output}`);

  const content = fs.readFileSync(input, "utf-8");
  const doc = convertMarkdownToJdf(content, path.basename(input, path.extname(input)));

  fs.writeFileSync(output, JSON.stringify(doc, null, 2));
  console.log(`\nDone! Created ${doc.pages.length} page(s)`);
  console.log(`Open with: open -a "JDF Reader" "${output}"`);
}

function convertMarkdownToJdf(md: string, title: string): JdfDocument {
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
        heading: true,
        tocEntry: text,
        style: { fontFamily: "Inter", fontSize, fontWeight: "bold", color: level <= 2 ? "#0f172a" : "#1e293b" },
      });
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
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
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

    // Normal paragraph — collect consecutive non-empty lines
    let para = "";
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].match(/^#{1,6}\s/) && !lines[i].match(/^\s*[-*+]\s/) && !lines[i].startsWith("```")) {
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
