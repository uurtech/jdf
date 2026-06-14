import JSZip from "jszip";
import {
  JDFX_DOCUMENT_PATH,
  JDFX_MANIFEST_PATH,
  type JdfDocument,
  type JdfxManifest,
} from "@jdf/core";

/**
 * Open a `.jdfx` zip bundle and return the embedded JDF document with all
 * `image` element `resource` references rewritten to blob URLs that work as
 * `<img src>`. The blob URLs are leaked intentionally — they live for the
 * lifetime of the page; jdf.js does not (yet) support unmounting a viewer
 * and reclaiming them.
 */
export async function unpackJdfxToDocument(bytes: ArrayBuffer | Uint8Array): Promise<JdfDocument> {
  const zip = await JSZip.loadAsync(bytes as ArrayBuffer);

  const docFile = zip.file(JDFX_DOCUMENT_PATH);
  if (!docFile) throw new Error(`${JDFX_DOCUMENT_PATH} missing from .jdfx bundle`);
  const doc = JSON.parse(await docFile.async("string")) as JdfDocument;

  const manifestFile = zip.file(JDFX_MANIFEST_PATH);
  let manifest: JdfxManifest | null = null;
  if (manifestFile) {
    try {
      manifest = JSON.parse(await manifestFile.async("string")) as JdfxManifest;
    } catch {
      manifest = null;
    }
  }

  const idToBlobUrl = new Map<string, string>();
  if (manifest?.assets) {
    for (const entry of manifest.assets) {
      const file = zip.file(entry.path);
      if (!file) continue;
      const data = await file.async("uint8array");
      const blob = new Blob([data as BlobPart], { type: entry.mimeType });
      idToBlobUrl.set(entry.id, URL.createObjectURL(blob));
    }
  }

  function rebind(els: any[] | undefined) {
    if (!els) return;
    for (const el of els) {
      if (el?.type === "image" && el.resource) {
        const url = idToBlobUrl.get(el.resource);
        if (url) el.src = url;
      }
      if (el?.elements) rebind(el.elements);
      if (el?.children) rebind(el.children);
    }
  }
  for (const page of doc.pages || []) rebind(page.elements as any[]);

  return doc;
}
