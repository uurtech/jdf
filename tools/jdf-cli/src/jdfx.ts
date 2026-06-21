import JSZip from "jszip";
import { createHash } from "node:crypto";
import {
  JDFX_DOCUMENT_PATH,
  JDFX_MANIFEST_PATH,
  JDFX_MANIFEST_VERSION,
  JDFX_ASSET_DIR,
  type JdfDocument,
  type JdfxManifest,
  type JdfxAssetEntry,
} from "@jdf/core";

const GENERATOR = "@uurtech/jdf-cli";

interface ExtractedAsset {
  id: string;
  bytes: Buffer;
  mimeType: string;
  ext: string;
}

function decodeBase64(s: string): Buffer {
  return Buffer.from(s, "base64");
}

function hashBytes(bytes: Buffer): string {
  return createHash("sha1").update(bytes).digest("hex").slice(0, 16);
}

/** Walk every element and rewrite `el.resource === oldKey` to point at `newKey`. */
function rewriteResourceRefs(doc: JdfDocument, oldKey: string, newKey: string): void {
  function walk(els: any[] | undefined) {
    if (!els) return;
    for (const el of els) {
      if (el?.resource === oldKey) el.resource = newKey;
      if (el?.elements) walk(el.elements);
      if (el?.children) walk(el.children);
    }
  }
  for (const page of doc.pages || []) walk(page.elements as any[]);
}

function extractAssets(doc: JdfDocument): { doc: JdfDocument; assets: ExtractedAsset[] } {
  const assets: ExtractedAsset[] = [];
  const cloned: JdfDocument = JSON.parse(JSON.stringify(doc));
  const usedIds = new Set<string>();
  // Content-hash → existing asset id. Two elements that reference the same
  // bytes (the same logo on every page of a PDF, the same icon used in 50
  // table cells, etc.) get one shared `resources.images` entry instead of
  // N copies. This keeps the .jdfx zip from inflating linearly with usage
  // count and gives RAG ingestion one image chunk per logical asset.
  const hashToId = new Map<string, string>();
  let inlineCounter = 0;

  // Reserve ids that resources.images already uses so the page-walk counter
  // can't collide with them.
  if (cloned.resources?.images) {
    for (const key of Object.keys(cloned.resources.images)) {
      usedIds.add(key);
    }
  }

  function nextInlineId(): string {
    while (true) {
      inlineCounter++;
      const id = `asset-${inlineCounter}`;
      if (!usedIds.has(id)) {
        usedIds.add(id);
        return id;
      }
    }
  }

  function intern(bytes: Buffer, mimeType: string, ext: string): string {
    const h = hashBytes(bytes);
    const existing = hashToId.get(h);
    if (existing) return existing;
    const id = nextInlineId();
    hashToId.set(h, id);
    assets.push({ id, bytes, mimeType, ext });
    return id;
  }

  function walk(els: any[] | undefined) {
    if (!els) return;
    for (const el of els) {
      if (el?.type === "image" && typeof el.src === "string" && el.src.startsWith("data:")) {
        const m = el.src.match(/^data:([^;]+);base64,(.*)$/);
        if (m) {
          const mimeType = m[1];
          const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "bin";
          const id = intern(decodeBase64(m[2]), mimeType, ext);
          delete el.src;
          el.resource = id;
        }
      }
      if (el?.elements) walk(el.elements);
      if (el?.children) walk(el.children);
    }
  }
  for (const page of cloned.pages || []) walk(page.elements as any[]);

  // Drain inline-base64 entries inside resources.images. Preserve the
  // entry's other fields (mimeType, width, height, alt, etc.) — only the
  // base64 `data` itself is moved to the zip's assets/ directory. Renderers
  // still look up the resource by key and find the same metadata, just
  // without the inlined bytes (the asset is loaded from the zip).
  //
  // Hash here too so resources.images entries that share bytes with each
  // other (or with the inline-image walk above) collapse to one zipped
  // file. The original key is preserved for backwards compatibility — the
  // zip's asset path is named after the content hash, not the key.
  if (cloned.resources?.images) {
    for (const [key, res] of Object.entries(cloned.resources.images)) {
      if (!res || typeof res !== "object" || !("data" in res) || !res.data) continue;
      const data = String(res.data);
      const m = data.match(/^data:([^;]+);base64,(.*)$/);
      const b64 = m ? m[2] : data;
      const mimeType = m ? m[1] : (res as any).mimeType || "image/png";
      const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "bin";
      const bytes = decodeBase64(b64);
      const h = hashBytes(bytes);
      let canonicalId = hashToId.get(h);
      if (!canonicalId) {
        // Use the original key as the canonical id when possible — keeps
        // existing renderers that look up resources by name working.
        canonicalId = key;
        hashToId.set(h, canonicalId);
        usedIds.add(canonicalId);
        assets.push({ id: canonicalId, bytes, mimeType, ext });
      }
      // Update the document to point at the canonical id (may be the same
      // as `key`, may be a previously-interned hash hit).
      const updated: Record<string, unknown> = { ...(res as Record<string, unknown>) };
      delete updated.data;
      updated.src = "embedded";
      if (canonicalId !== key) {
        // Drop the duplicate key and rewrite element references.
        delete (cloned.resources.images as any)[key];
        rewriteResourceRefs(cloned, key, canonicalId);
      } else {
        (cloned.resources.images as any)[key] = updated;
      }
    }
  }

  return { doc: cloned, assets };
}

export async function packJdfx(doc: JdfDocument): Promise<{ bytes: Buffer; manifest: JdfxManifest }> {
  const { doc: rewritten, assets } = extractAssets(doc);

  const zip = new JSZip();
  const assetEntries: JdfxAssetEntry[] = assets.map((a) => {
    const p = `${JDFX_ASSET_DIR}/${a.id}.${a.ext}`;
    zip.file(p, a.bytes);
    return { id: a.id, path: p, mimeType: a.mimeType, size: a.bytes.length };
  });

  const now = new Date().toISOString();
  const manifest: JdfxManifest = {
    format: "jdfx",
    version: JDFX_MANIFEST_VERSION,
    document: JDFX_DOCUMENT_PATH,
    created: now,
    modified: now,
    generator: GENERATOR,
    assets: assetEntries,
  };

  zip.file(JDFX_DOCUMENT_PATH, JSON.stringify(rewritten, null, 2));
  zip.file(JDFX_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { bytes, manifest };
}

export function shouldUseJdfx(doc: JdfDocument): boolean {
  const images = doc.resources?.images ?? {};
  for (const v of Object.values(images)) {
    if (v && typeof v === "object" && "data" in v && (v as any).data) return true;
  }
  function walk(els: any[] | undefined): boolean {
    if (!els) return false;
    for (const el of els) {
      if (el?.type === "image" && typeof el.src === "string" && el.src.startsWith("data:")) return true;
      if (el?.elements && walk(el.elements)) return true;
      if (el?.children && walk(el.children)) return true;
    }
    return false;
  }
  for (const page of doc.pages || []) {
    if (walk(page.elements as any[])) return true;
  }
  return false;
}
