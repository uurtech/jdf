import type { JdfDocument } from "@jdf/core";
import type { ElementPath } from "./context";

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function applyFieldUpdate(doc: JdfDocument, path: ElementPath, field: string, value: unknown): JdfDocument {
  const next = deepClone(doc);
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
