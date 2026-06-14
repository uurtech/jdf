import { readFile } from "@tauri-apps/plugin-fs";

const IMAGE_REF_RE = /(!\[[^\]]*\])\(\s*([^)\s]+)([^)]*)\)/g;

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

function uint8ToBase64(arr: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < arr.length; i += CHUNK) {
    binary += String.fromCharCode(...arr.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function dirOf(filePath: string): string {
  const i = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return i < 0 ? "" : filePath.slice(0, i);
}

function joinPath(base: string, rel: string): string {
  if (!base) return rel;
  const sep = base.includes("\\") ? "\\" : "/";
  return base.replace(/[\/\\]+$/, "") + sep + rel.replace(/^[\/\\]+/, "");
}

function isAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

function isRemote(src: string): boolean {
  return /^(https?:|data:|file:)/i.test(src);
}

/**
 * Rewrite ![alt](relative.png) image refs in a Markdown string so each
 * relative path becomes a `data:image/...;base64,...` URL. The Markdown
 * file's directory is used as the base for resolving relative paths.
 *
 * Remote URLs (http/https), data: URLs, and file: URLs are left untouched.
 * If a referenced image cannot be read, the original markdown is preserved.
 */
export async function preprocessMarkdownImages(
  markdown: string,
  markdownPath: string,
): Promise<string> {
  const baseDir = dirOf(markdownPath);
  const matches = Array.from(markdown.matchAll(IMAGE_REF_RE));
  if (matches.length === 0) return markdown;

  const replacements = new Map<string, string>();

  await Promise.all(
    matches.map(async (m) => {
      const [full, alt, rawSrc, rest] = m;
      const src = rawSrc.trim();
      if (!src || isRemote(src)) return;
      if (replacements.has(full)) return;

      const absolute = isAbsolute(src) ? src : joinPath(baseDir, src);
      try {
        const bytes = await readFile(absolute);
        const ext = (absolute.split(".").pop() || "").toLowerCase();
        const mime = MIME_BY_EXT[ext] || "application/octet-stream";
        const b64 = uint8ToBase64(bytes);
        const dataUrl = `data:${mime};base64,${b64}`;
        replacements.set(full, `${alt}(${dataUrl}${rest})`);
      } catch {
        // image unreadable — keep original reference, viewer will show alt text
      }
    }),
  );

  if (replacements.size === 0) return markdown;
  return markdown.replace(IMAGE_REF_RE, (full) => replacements.get(full) ?? full);
}
