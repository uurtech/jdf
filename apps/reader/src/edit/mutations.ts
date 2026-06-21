import type { JdfDocument, Element } from "@jdf/core";
import type { ElementPath } from "./context";

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

function navigate(root: any, path: ElementPath): { parent: any; key: string | number } | null {
  if (path.length === 0) return null;
  let node: any = root;
  for (let i = 0; i < path.length - 1; i++) {
    if (node == null) return null;
    node = node[path[i] as any];
  }
  if (node == null) return null;
  return { parent: node, key: path[path.length - 1] };
}

export function applyFieldUpdate(doc: JdfDocument, path: ElementPath, field: string, value: unknown): JdfDocument {
  const next = clone(doc);
  let node: any = next;
  for (const seg of path) {
    if (node == null) return doc;
    node = node[seg as any];
  }
  if (node == null || typeof node !== "object") return doc;
  const parts = field.split(".");
  let target: any = node;
  for (let i = 0; i < parts.length - 1; i++) {
    if (target[parts[i]] == null || typeof target[parts[i]] !== "object") {
      target[parts[i]] = {};
    }
    target = target[parts[i]];
  }
  target[parts[parts.length - 1]] = value;
  return next;
}

export function deleteElement(doc: JdfDocument, path: ElementPath): JdfDocument {
  const next = clone(doc);
  const nav = navigate(next, path);
  if (!nav) return doc;
  const { parent, key } = nav;
  if (Array.isArray(parent) && typeof key === "number") {
    parent.splice(key, 1);
  } else if (parent && typeof key === "string") {
    delete parent[key];
  }
  return next;
}

export function moveElement(doc: JdfDocument, path: ElementPath, direction: -1 | 1): JdfDocument {
  const next = clone(doc);
  const nav = navigate(next, path);
  if (!nav || !Array.isArray(nav.parent) || typeof nav.key !== "number") return doc;
  const arr = nav.parent;
  const idx = nav.key;
  const target = idx + direction;
  if (target < 0 || target >= arr.length) return doc;
  const [moved] = arr.splice(idx, 1);
  arr.splice(target, 0, moved);
  return next;
}

export function duplicateElement(doc: JdfDocument, path: ElementPath): JdfDocument {
  const next = clone(doc);
  const nav = navigate(next, path);
  if (!nav || !Array.isArray(nav.parent) || typeof nav.key !== "number") return doc;
  const arr = nav.parent;
  const item = clone(arr[nav.key]);
  // Offset position so the duplicate is visible
  if (item && typeof item === "object" && item.position) {
    item.position = { x: (item.position.x || 0) + 4, y: (item.position.y || 0) + 4 };
  }
  arr.splice(nav.key + 1, 0, item);
  return next;
}

export function insertElementAfter(doc: JdfDocument, path: ElementPath, element: Element): JdfDocument {
  const next = clone(doc);
  const nav = navigate(next, path);
  if (!nav || !Array.isArray(nav.parent) || typeof nav.key !== "number") return doc;
  nav.parent.splice(nav.key + 1, 0, element);
  return next;
}

export function appendElementToPage(doc: JdfDocument, pageIndex: number, element: Element): JdfDocument {
  const next = clone(doc);
  const page = next.pages?.[pageIndex];
  if (!page) return doc;
  if (!page.elements) page.elements = [];
  page.elements.push(element);
  return next;
}

export function makeBlankElement(type: Element["type"], y: number = 5): Element {
  switch (type) {
    case "text":
      return { type: "text", content: "New text", position: { x: 0, y }, width: 166, style: { fontFamily: "Inter", fontSize: 11, color: "#0f172a" } };
    case "richtext":
      return { type: "richtext", runs: [{ text: "New text" }], position: { x: 0, y }, width: 166, style: { fontFamily: "Inter", fontSize: 11, color: "#0f172a" } };
    case "list":
      return { type: "list", listType: "unordered", items: [{ content: "Item 1" }, { content: "Item 2" }], position: { x: 0, y }, width: 166, style: { fontFamily: "Inter", fontSize: 11, color: "#334155" } } as Element;
    case "table":
      return {
        type: "table",
        headers: ["Column A", "Column B"],
        rows: [["", ""], ["", ""]],
        borders: true,
        position: { x: 0, y }, width: 166,
      } as Element;
    case "shape":
      return { type: "shape", shape: "rect", position: { x: 0, y }, width: 60, height: 30, fill: "#3b82f6" } as Element;
    case "image":
      return { type: "image", src: "", alt: "Image", position: { x: 0, y }, width: 80, height: 60, fit: "contain" } as Element;
    case "collapsible":
      return { type: "collapsible", title: "Section", expanded: true, elements: [], position: { x: 0, y }, width: 166 } as Element;
    case "toc":
      return { type: "toc", depth: 6, position: { x: 0, y }, width: 166, style: { fontFamily: "Inter", fontSize: 10, color: "#334155" } } as Element;
    case "input":
      return { type: "input", name: `field_${Date.now()}`, inputType: "text", value: "", placeholder: "Enter text", position: { x: 0, y }, width: 166, height: 8 } as Element;
    case "textarea":
      return { type: "textarea", name: `field_${Date.now()}`, value: "", placeholder: "Enter text", rows: 3, position: { x: 0, y }, width: 166, height: 24 } as Element;
    case "checkbox":
      return { type: "checkbox", name: `field_${Date.now()}`, label: "Check me", checked: false, position: { x: 0, y }, width: 60, height: 6 } as Element;
    case "select":
      return { type: "select", name: `field_${Date.now()}`, options: [{ value: "1", label: "Option 1" }, { value: "2", label: "Option 2" }], value: "1", position: { x: 0, y }, width: 80, height: 8 } as Element;
    case "signature":
      return { type: "signature", name: `signature_${Date.now()}`, label: "Sign here", value: "", position: { x: 0, y }, width: 80, height: 30 } as Element;
  }
}

export function insertPageAfter(doc: JdfDocument, pageIndex: number): JdfDocument {
  const next = clone(doc);
  next.pages.splice(pageIndex + 1, 0, { id: `page-${Date.now()}`, elements: [] });
  return next;
}

export function deletePage(doc: JdfDocument, pageIndex: number): JdfDocument {
  if (doc.pages.length <= 1) return doc;
  const next = clone(doc);
  next.pages.splice(pageIndex, 1);
  return next;
}
