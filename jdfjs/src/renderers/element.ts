import type {
  Element, Style, Resources, JdfDocument,
  TextElement, RichTextElement, ImageElement, TableElement, ListElement,
  ShapeElement, CollapsibleElement, TocElement, RichTextRun, ListItem, TableCellValue, ImageResource,
} from "@jdf/core";
import { unitToPx } from "@jdf/core";
import { resolveStyle, styleToCss, applyStyle } from "../utils/style";
import { resolveLink, attachLinkBehaviour } from "../utils/link";

export interface RenderContext {
  styles: Record<string, Style>;
  resources?: Resources;
  document: JdfDocument;
  path: (string | number)[];
  onNavigatePage?: (pageIndex: number) => void;
}

const NS_SVG = "http://www.w3.org/2000/svg";

export function renderElement(el: Element, ctx: RenderContext): HTMLElement | null {
  const wrap = document.createElement("div");
  applyPositionAndSize(wrap, el);
  let inner: HTMLElement | null = null;
  switch (el.type) {
    case "text": inner = renderText(el, ctx); break;
    case "richtext": inner = renderRichText(el, ctx); break;
    case "image": inner = renderImage(el, ctx); break;
    case "table": inner = renderTable(el, ctx); break;
    case "list": inner = renderList(el, ctx); break;
    case "shape": inner = renderShape(el); break;
    case "collapsible": inner = renderCollapsible(el, ctx); break;
    case "toc": inner = renderToc(el, ctx); break;
  }
  if (!inner) return null;
  wrap.appendChild(inner);
  return wrap;
}

function applyPositionAndSize(el: HTMLElement, e: Element) {
  const any = e as any;
  if (any.position) {
    el.style.position = "absolute";
    if (any.position.x != null) el.style.left = `${unitToPx(any.position.x)}px`;
    if (any.position.y != null) el.style.top = `${unitToPx(any.position.y)}px`;
  }
  if (any.width != null) el.style.width = `${unitToPx(any.width)}px`;
  if (any.height != null) el.style.height = `${unitToPx(any.height)}px`;
}

// ── text ────────────────────────────────────────────────────────────────────
function renderText(el: TextElement, ctx: RenderContext): HTMLElement {
  const tag = textTag(el.heading);
  const node = document.createElement(tag);
  node.className = "jdfjs-text";
  node.style.margin = "0";
  node.style.whiteSpace = "pre-wrap";
  applyStyle(node, resolveStyle(el.style, ctx.styles));
  if (el.align) node.style.textAlign = el.align;

  const link = resolveLink(el.link);
  if (link) {
    const a = document.createElement("a");
    attachLinkBehaviour(a, link, ctx.onNavigatePage);
    a.className = "jdfjs-link";
    a.textContent = el.content || "";
    node.appendChild(a);
  } else {
    node.textContent = el.content || "";
  }
  return node;
}

function textTag(h: TextElement["heading"]): keyof HTMLElementTagNameMap {
  if (h === true) return "h1";
  if (typeof h === "number" && h >= 1 && h <= 6) return ("h" + h) as keyof HTMLElementTagNameMap;
  return "p";
}

// ── richtext ────────────────────────────────────────────────────────────────
function renderRichText(el: RichTextElement, ctx: RenderContext): HTMLElement {
  const p = document.createElement("p");
  p.className = "jdfjs-richtext";
  p.style.margin = "0";
  applyStyle(p, resolveStyle(el.style, ctx.styles));
  for (const run of el.runs || []) {
    p.appendChild(renderRun(run, ctx));
  }
  return p;
}

function runCss(run: RichTextRun, styles: Record<string, Style>): Record<string, string> {
  const css: Record<string, string> = {};
  if (run.style) {
    if (typeof run.style === "string") Object.assign(css, styleToCss(styles[run.style] || {}));
    else if (Array.isArray(run.style)) for (const s of run.style) Object.assign(css, styleToCss(styles[s] || {}));
    else Object.assign(css, styleToCss(run.style));
  }
  if (run.bold) css["font-weight"] = "bold";
  if (run.italic) css["font-style"] = "italic";
  const decos: string[] = [];
  if (run.underline) decos.push("underline");
  if (run.strikethrough) decos.push("line-through");
  if (decos.length) css["text-decoration"] = decos.join(" ");
  if (run.color) css["color"] = run.color;
  if (run.fontSize) css["font-size"] = `${run.fontSize * 1.333}px`;
  if (run.fontFamily) css["font-family"] = run.fontFamily;
  return css;
}

function renderRun(run: RichTextRun, ctx: RenderContext): HTMLElement {
  const link = resolveLink(run.link);
  const node: HTMLElement = link ? document.createElement("a") : document.createElement("span");
  if (link) {
    attachLinkBehaviour(node as HTMLAnchorElement, link, ctx.onNavigatePage);
    node.classList.add("jdfjs-link");
  }
  applyStyle(node, runCss(run, ctx.styles));
  node.textContent = run.text;
  return node;
}

// ── image ───────────────────────────────────────────────────────────────────
function lookupResource(resources: Resources | undefined, key: string): ImageResource | undefined {
  if (!resources) return undefined;
  const direct = (resources as any)[key];
  if (direct && typeof direct === "object" && "data" in direct) return direct as ImageResource;
  const inImages = resources.images?.[key];
  if (inImages) return inImages;
  return undefined;
}

function imageSrc(el: ImageElement, resources?: Resources): string {
  if (el.src?.startsWith("data:") || el.src?.startsWith("http")) return el.src;
  if (el.resource) {
    const res = lookupResource(resources, el.resource);
    if (res?.data) {
      const mime = res.mimeType || "image/png";
      if (res.data.startsWith("data:")) return res.data;
      return `data:${mime};base64,${res.data}`;
    }
    if (res?.path) return res.path;
  }
  return el.src || "";
}

function renderImage(el: ImageElement, ctx: RenderContext): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "jdfjs-image";
  wrap.style.width = "100%";
  wrap.style.height = "100%";
  const img = document.createElement("img");
  img.src = imageSrc(el, ctx.resources);
  img.alt = el.alt || "";
  img.style.display = "block";
  img.style.width = "100%";
  img.style.height = "100%";
  switch (el.fit) {
    case "cover": img.style.objectFit = "cover"; break;
    case "fill": img.style.objectFit = "fill"; break;
    case "none": img.style.objectFit = "none"; break;
    default: img.style.objectFit = "contain";
  }
  applyStyle(img, resolveStyle(el.style, ctx.styles));
  wrap.appendChild(img);
  return wrap;
}

// ── table ───────────────────────────────────────────────────────────────────
function cellText(c: TableCellValue): string {
  return typeof c === "string" ? c : c.content;
}
function cellAttrs(c: TableCellValue): { colspan?: number; rowspan?: number } {
  if (typeof c === "string") return {};
  return { colspan: c.colspan, rowspan: c.rowspan };
}

function renderTable(el: TableElement, ctx: RenderContext): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "jdfjs-table-wrap";
  applyStyle(wrap, resolveStyle(el.style, ctx.styles));
  wrap.style.overflowX = "auto";

  const headerCss = (() => {
    const s = el.headerStyle;
    if (!s) return {};
    if (typeof s === "string") return styleToCss(ctx.styles[s] || {});
    if (Array.isArray(s)) { let m = {}; for (const k of s) m = { ...m, ...styleToCss(ctx.styles[k] || {}) }; return m; }
    return styleToCss(s);
  })();
  const rowCss = (() => {
    const s = el.rowStyle;
    if (!s) return {};
    if (typeof s === "string") return styleToCss(ctx.styles[s] || {});
    if (Array.isArray(s)) { let m = {}; for (const k of s) m = { ...m, ...styleToCss(ctx.styles[k] || {}) }; return m; }
    return styleToCss(s);
  })();
  const altRowCss = (() => {
    const s = el.alternateRowStyle;
    if (!s) {
      const c = el.alternatingRowColor;
      return c ? { "background-color": c } : {};
    }
    if (typeof s === "string") return styleToCss(ctx.styles[s] || {});
    if (Array.isArray(s)) { let m = {}; for (const k of s) m = { ...m, ...styleToCss(ctx.styles[k] || {}) }; return m; }
    return styleToCss(s);
  })();
  const borders = (() => {
    const b = el.borders;
    if (b === false) return { outer: false, inner: false } as const;
    if (b === true || b === undefined) return { outer: true, inner: true, color: "#e2e8f0", width: 1 } as const;
    return { outer: true, inner: true, color: "#e2e8f0", width: 1, ...b } as const;
  })();

  const headers = el.headers ?? el.columns?.map((c) => c.header || "").filter((h) => h !== "");
  const colAlign = (i: number) => el.columns?.[i]?.align;

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.fontSize = "14px";
  if (borders.outer) table.style.border = `${borders.width || 1}px solid ${borders.color || "#e2e8f0"}`;

  if (headers && headers.length > 0) {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    applyStyle(tr, headerCss as any);
    headers.forEach((h, i) => {
      const th = document.createElement("th");
      th.textContent = h;
      th.style.padding = "8px 12px";
      th.style.fontWeight = "600";
      th.style.background = "#f8fafc";
      th.style.textAlign = colAlign(i) || "left";
      if (borders.inner) th.style.border = `${borders.width || 1}px solid ${borders.color || "#e2e8f0"}`;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
  }

  const tbody = document.createElement("tbody");
  el.rows.forEach((row, ri) => {
    const tr = document.createElement("tr");
    applyStyle(tr, rowCss as any);
    if (ri % 2 === 1) applyStyle(tr, altRowCss as any);
    row.forEach((cell, ci) => {
      const td = document.createElement("td");
      td.textContent = cellText(cell);
      const attrs = cellAttrs(cell);
      if (attrs.colspan) td.colSpan = attrs.colspan;
      if (attrs.rowspan) td.rowSpan = attrs.rowspan;
      td.style.padding = "8px 12px";
      td.style.verticalAlign = "top";
      td.style.textAlign = colAlign(ci) || "left";
      if (borders.inner) td.style.border = `${borders.width || 1}px solid ${borders.color || "#e2e8f0"}`;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// ── list ────────────────────────────────────────────────────────────────────
function renderList(el: ListElement, ctx: RenderContext): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "jdfjs-list-wrap";
  applyStyle(wrap, resolveStyle(el.style, ctx.styles));

  const defaultType = el.listType ?? (el.ordered ? "ordered" : "unordered");
  const root = listElementForType(defaultType);
  buildItems(root, el.items || [], defaultType, ctx);
  wrap.appendChild(root);
  return wrap;
}

function listElementForType(t: "ordered" | "unordered") {
  const node = document.createElement(t === "ordered" ? "ol" : "ul");
  node.style.margin = "0";
  node.style.paddingLeft = "20px";
  node.style.listStyle = t === "ordered" ? "decimal" : "disc";
  return node;
}

function buildItems(parent: HTMLElement, items: ListItem[], def: "ordered" | "unordered", ctx: RenderContext) {
  for (const item of items) {
    const li = document.createElement("li");
    li.style.fontSize = "14px";
    li.style.lineHeight = "1.6";
    li.appendChild(document.createTextNode(item.content));
    if (item.children?.length) {
      const childType = item.listType || def;
      const nested = listElementForType(childType);
      nested.style.marginTop = "4px";
      buildItems(nested, item.children, childType, ctx);
      li.appendChild(nested);
    }
    parent.appendChild(li);
  }
}

// ── shape ───────────────────────────────────────────────────────────────────
function renderShape(el: ShapeElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "jdfjs-shape";
  wrap.style.width = "100%";
  wrap.style.height = "100%";

  const w = el.width ?? 100;
  const h = el.height ?? 100;
  const fill = el.fill ?? "none";
  const strokeColor = (() => {
    const s = el.stroke;
    if (typeof s === "string") return s;
    if (s?.color) return s.color;
    return "none";
  })();
  const strokeWidth = (() => {
    const s = el.stroke;
    if (typeof s === "object" && s?.width != null) return s.width;
    return el.strokeWidth ?? 0;
  })();

  const svg = document.createElementNS(NS_SVG, "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.display = "block";
  svg.style.overflow = "visible";

  let shapeNode: SVGElement | null = null;
  switch (el.shape) {
    case "rect": {
      const r = document.createElementNS(NS_SVG, "rect");
      r.setAttribute("x", "0");
      r.setAttribute("y", "0");
      r.setAttribute("width", String(w));
      r.setAttribute("height", String(h));
      if (el.borderRadius) r.setAttribute("rx", String(el.borderRadius));
      shapeNode = r;
      break;
    }
    case "circle": {
      const c = document.createElementNS(NS_SVG, "circle");
      c.setAttribute("cx", String(w / 2));
      c.setAttribute("cy", String(h / 2));
      c.setAttribute("r", String(Math.min(w, h) / 2));
      shapeNode = c;
      break;
    }
    case "ellipse": {
      const e = document.createElementNS(NS_SVG, "ellipse");
      e.setAttribute("cx", String(w / 2));
      e.setAttribute("cy", String(h / 2));
      e.setAttribute("rx", String(w / 2));
      e.setAttribute("ry", String(h / 2));
      shapeNode = e;
      break;
    }
    case "line": {
      const l = document.createElementNS(NS_SVG, "line");
      l.setAttribute("x1", "0");
      l.setAttribute("y1", "0");
      l.setAttribute("x2", String(w));
      l.setAttribute("y2", String(h));
      l.setAttribute("stroke", strokeColor === "none" ? (fill !== "none" ? fill : "currentColor") : strokeColor);
      l.setAttribute("stroke-width", String(strokeWidth || 0.3));
      svg.appendChild(l);
      wrap.appendChild(svg);
      return wrap;
    }
    case "path": {
      const p = document.createElementNS(NS_SVG, "path");
      p.setAttribute("d", el.path || "");
      p.setAttribute("fill-rule", "evenodd");
      shapeNode = p;
      break;
    }
  }
  if (shapeNode) {
    shapeNode.setAttribute("fill", fill);
    shapeNode.setAttribute("stroke", strokeColor);
    if (strokeWidth) shapeNode.setAttribute("stroke-width", String(strokeWidth));
    svg.appendChild(shapeNode);
  }
  wrap.appendChild(svg);
  return wrap;
}

// ── collapsible ─────────────────────────────────────────────────────────────
function renderCollapsible(el: CollapsibleElement, ctx: RenderContext): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "jdfjs-collapsible";
  applyStyle(wrap, resolveStyle(el.style, ctx.styles));
  wrap.style.border = "1px solid #e2e8f0";
  wrap.style.borderRadius = "8px";
  wrap.style.overflow = "hidden";
  wrap.style.background = "#ffffff";

  const header = document.createElement("button");
  header.type = "button";
  header.className = "jdfjs-collapsible-header";
  header.style.width = "100%";
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.gap = "8px";
  header.style.padding = "10px 16px";
  header.style.fontSize = "14px";
  header.style.fontWeight = "500";
  header.style.background = "#f8fafc";
  header.style.border = "0";
  header.style.cursor = "pointer";
  header.style.textAlign = "left";

  const arrow = document.createElement("span");
  arrow.textContent = "▶";
  arrow.style.fontSize = "10px";
  arrow.style.transition = "transform 0.15s ease";

  const titleSpan = document.createElement("span");
  titleSpan.textContent = el.title || "Section";
  titleSpan.style.flex = "1";

  header.appendChild(arrow);
  header.appendChild(titleSpan);
  wrap.appendChild(header);

  const body = document.createElement("div");
  body.className = "jdfjs-collapsible-body";
  body.style.padding = "12px 16px";
  body.style.position = "relative";

  let expanded = el.expanded ?? false;
  const apply = () => {
    body.style.display = expanded ? "block" : "none";
    arrow.style.transform = expanded ? "rotate(90deg)" : "rotate(0deg)";
  };
  apply();
  header.addEventListener("click", () => { expanded = !expanded; apply(); });

  for (const child of el.elements || []) {
    const node = renderElement(child, { ...ctx, path: [...ctx.path, "elements"] });
    if (node) body.appendChild(node);
  }
  wrap.appendChild(body);
  return wrap;
}

// ── toc ─────────────────────────────────────────────────────────────────────
function renderToc(el: TocElement, ctx: RenderContext): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "jdfjs-toc";
  applyStyle(wrap, resolveStyle(el.style, ctx.styles));

  const depth = el.depth ?? 6;
  const entries: { title: string; pageIndex: number; level: number }[] = [];
  ctx.document.pages.forEach((page, pi) => {
    for (const e of page.elements) {
      if (e.type !== "text") continue;
      const t = e as TextElement;
      const title = t.tocEntry || (t.heading ? t.content : null);
      if (!title) continue;
      const level = typeof t.tocLevel === "number" ? t.tocLevel : (typeof t.heading === "number" ? t.heading : 1);
      if (level > depth) continue;
      entries.push({ title, pageIndex: pi, level });
    }
  });

  for (const entry of entries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "jdfjs-toc-entry";
    btn.style.display = "flex";
    btn.style.alignItems = "baseline";
    btn.style.gap = "8px";
    btn.style.width = "100%";
    btn.style.background = "transparent";
    btn.style.border = "0";
    btn.style.borderBottom = "1px dotted #e2e8f0";
    btn.style.padding = `6px 8px 6px ${(entry.level - 1) * 16 + 8}px`;
    btn.style.cursor = "pointer";
    btn.style.fontSize = "14px";
    btn.style.color = "#334155";
    btn.style.textAlign = "left";

    const titleSpan = document.createElement("span");
    titleSpan.textContent = entry.title;
    titleSpan.style.flex = "1";

    const filler = document.createElement("span");
    filler.style.flex = "1";
    filler.style.borderBottom = "1px dotted #cbd5e1";
    filler.style.alignSelf = "end";
    filler.style.marginBottom = "4px";

    const num = document.createElement("span");
    num.textContent = String(entry.pageIndex + 1);
    num.style.fontFamily = "JetBrains Mono, monospace";
    num.style.fontSize = "12px";
    num.style.color = "#94a3b8";
    num.style.flexShrink = "0";

    btn.appendChild(titleSpan);
    btn.appendChild(filler);
    btn.appendChild(num);

    btn.addEventListener("click", () => ctx.onNavigatePage?.(entry.pageIndex));
    wrap.appendChild(btn);
  }
  return wrap;
}
