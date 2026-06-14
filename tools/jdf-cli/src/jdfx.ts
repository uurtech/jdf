import JSZip from "jszip";
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

function extractAssets(doc: JdfDocument): { doc: JdfDocument; assets: ExtractedAsset[] } {
  const assets: ExtractedAsset[] = [];
  const cloned: JdfDocument = JSON.parse(JSON.stringify(doc));
  let counter = 0;

  function walk(els: any[] | undefined) {
    if (!els) return;
    for (const el of els) {
      if (el?.type === "image" && typeof el.src === "string" && el.src.startsWith("data:")) {
        const m = el.src.match(/^data:([^;]+);base64,(.*)$/);
        if (m) {
          counter++;
          const id = `asset-${counter}`;
          const mimeType = m[1];
          const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "bin";
          assets.push({ id, bytes: decodeBase64(m[2]), mimeType, ext });
          delete el.src;
          el.resource = id;
        }
      }
      if (el?.elements) walk(el.elements);
      if (el?.children) walk(el.children);
    }
  }
  for (const page of cloned.pages || []) walk(page.elements as any[]);

  // Drain inline-base64 entries inside resources.images too
  if (cloned.resources?.images) {
    for (const [key, res] of Object.entries(cloned.resources.images)) {
      if (!res || typeof res !== "object" || !("data" in res) || !res.data) continue;
      const data = String(res.data);
      const m = data.match(/^data:([^;]+);base64,(.*)$/);
      const b64 = m ? m[2] : data;
      const mimeType = m ? m[1] : (res as any).mimeType || "image/png";
      const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "bin";
      counter++;
      const id = key || `asset-${counter}`;
      assets.push({ id, bytes: decodeBase64(b64), mimeType, ext });
    }
    cloned.resources.images = {};
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
