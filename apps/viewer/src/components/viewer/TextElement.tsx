import { Dynamic } from "solid-js/web";
import type { TextElement, Style, Link } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";

interface TextElementViewProps {
  element: TextElement;
  styles: Record<string, Style>;
  onNavigatePage?: (pageIndex: number) => void;
}

function linkHref(link: Link | undefined): { href: string; internal: boolean; target?: string } | null {
  if (!link) return null;
  if (typeof link === "string") return { href: link, internal: link.startsWith("#") };
  return { href: link.target, internal: link.type === "internal", target: link.target };
}

export function TextElementView(props: TextElementViewProps) {
  const css = () => resolveStyle(props.element.style, props.styles);

  const tag = (): "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" => {
    const h = props.element.heading;
    if (h === true) return "h1";
    if (typeof h === "number" && h >= 1 && h <= 6) return `h${h}` as any;
    return "p";
  };

  const text = () => props.element.content || "";
  const link = () => linkHref(props.element.link);

  function handleInternalClick(e: MouseEvent) {
    const l = link();
    if (l?.internal && props.onNavigatePage) {
      e.preventDefault();
      const id = l.href.replace(/^#/, "");
      const pageMatch = id.match(/^page-(\d+)$/i);
      if (pageMatch) props.onNavigatePage(Number(pageMatch[1]) - 1);
    }
  }

  const renderInner = () => {
    const l = link();
    if (!l) return text();
    if (l.internal) {
      return (
        <a href={l.href} class="text-blue-600 hover:text-blue-800 underline" onClick={handleInternalClick}>
          {text()}
        </a>
      );
    }
    return (
      <a href={l.href} target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-800 underline">
        {text()}
      </a>
    );
  };

  return (
    <Dynamic component={tag()} class="m-0 whitespace-pre-wrap" style={css()}>
      {renderInner()}
    </Dynamic>
  );
}
