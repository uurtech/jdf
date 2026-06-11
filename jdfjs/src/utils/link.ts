import type { Link } from "@jdf/core";

export interface ResolvedLink {
  href: string;
  internal: boolean;
  pageIndex?: number;
}

export function resolveLink(link: Link | undefined): ResolvedLink | null {
  if (!link) return null;
  const target = typeof link === "string" ? link : link.target;
  const internal = typeof link === "string" ? link.startsWith("#") : link.type === "internal";
  if (internal) {
    const m = target.replace(/^#/, "").match(/^page-(\d+)$/i);
    if (m) return { href: target, internal: true, pageIndex: Number(m[1]) - 1 };
    return { href: target, internal: true };
  }
  return { href: target, internal: false };
}

export function attachLinkBehaviour(
  el: HTMLAnchorElement,
  resolved: ResolvedLink,
  onNavigatePage?: (idx: number) => void
) {
  el.href = resolved.href;
  if (resolved.internal) {
    el.addEventListener("click", (e) => {
      if (resolved.pageIndex != null && onNavigatePage) {
        e.preventDefault();
        onNavigatePage(resolved.pageIndex);
      }
    });
  } else {
    el.target = "_blank";
    el.rel = "noopener noreferrer";
  }
}
