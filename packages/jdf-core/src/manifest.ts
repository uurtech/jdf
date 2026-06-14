/**
 * `.jdfx` is a ZIP bundle of:
 *
 *   document.json   — the JDF document, identical to a standalone .jdf
 *   manifest.json   — format metadata (THIS file's type)
 *   assets/*        — binary blobs referenced by element `resource` fields
 *
 * Scope rule: document.json owns CONTENT metadata (title/author/keywords).
 * manifest.json owns FORMAT metadata (version/generator/asset listing).
 * The two never duplicate fields.
 */

export interface JdfxAssetEntry {
  /** Stable id used by element `resource` references. */
  id: string;
  /** Path inside the zip, e.g. `assets/img-1.png`. */
  path: string;
  /** MIME type, e.g. `image/png`. */
  mimeType: string;
  /** Byte size of the asset on disk (post-compression irrelevant). */
  size: number;
  /** Optional pixel dimensions for images. */
  width?: number;
  height?: number;
}

export interface JdfxManifest {
  /** Always `"jdfx"`. */
  format: "jdfx";
  /** Manifest schema version (semver). Bumped when manifest shape changes. */
  version: "1.0.0";
  /** Path inside the zip of the JDF document. Always `"document.json"`. */
  document: "document.json";
  /** ISO 8601 UTC timestamp set on first write. */
  created?: string;
  /** ISO 8601 UTC timestamp set on every save. */
  modified?: string;
  /** App name + version that wrote this bundle, e.g. `"JDF Reader 0.1.14"`. */
  generator?: string;
  /** Inventory of every binary asset in the bundle. */
  assets: JdfxAssetEntry[];
}

export const JDFX_MANIFEST_VERSION = "1.0.0" as const;
export const JDFX_DOCUMENT_PATH = "document.json" as const;
export const JDFX_MANIFEST_PATH = "manifest.json" as const;
export const JDFX_ASSET_DIR = "assets" as const;

export const MIME_BY_EXT: Readonly<Record<string, string>> = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
});

export function extOf(pathOrName: string): string {
  const i = pathOrName.lastIndexOf(".");
  return i < 0 ? "" : pathOrName.slice(i + 1).toLowerCase();
}

export function mimeOf(pathOrName: string): string {
  return MIME_BY_EXT[extOf(pathOrName)] || "application/octet-stream";
}
