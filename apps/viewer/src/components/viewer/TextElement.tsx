import { Dynamic } from "solid-js/web";
import type { TextElement, Style, Link } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";
import { Editable } from "../shared/Editable";
import { useEdit, type ElementPath } from "../../edit/context";

interface TextElementViewProps {
  element: TextElement;
  path: ElementPath;
  styles: Record<string, Style>;
  onNavigatePage?: (pageIndex: number) => void;
}

function linkInfo(link: Link | undefined) {
  if (!link) return null;
  if (typeof link === "string") return { href: link, internal: link.startsWith("#") };
  return { href: link.target, internal: link.type === "internal" };
}

export function TextElementView(props: TextElementViewProps) {
  const edit = useEdit();
  const css = () => {
    const base = resolveStyle(props.element.style, props.styles);
    if (props.element.align && !base["text-align"]) base["text-align"] = props.element.align;
    return base;
  };

  const tag = (): "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" => {
    const h = props.element.heading;
    if (h === true) return "h1";
    if (typeof h === "number" && h >= 1 && h <= 6) return `h${h}` as any;
    return "p";
  };

  const text = () => props.element.content || "";
  const link = () => linkInfo(props.element.link);

  function handleInternalClick(e: MouseEvent) {
    if (edit.enabled) return;
    const l = link();
    if (l?.internal && props.onNavigatePage) {
      e.preventDefault();
      const m = l.href.replace(/^#/, "").match(/^page-(\d+)$/i);
      if (m) props.onNavigatePage(Number(m[1]) - 1);
    }
  }

  if (edit.enabled) {
    const isLong = () => text().length > 60 || text().includes("\n");
    return (
      <Editable
        as={tag()}
        value={text()}
        multiline={isLong()}
        onCommit={(v) => edit.updateField(props.path, "content", v)}
        class="m-0 whitespace-pre-wrap"
        style={css() as any}
      />
    );
  }

  const renderInner = () => {
    const l = link();
    if (!l) return text();
    if (l.internal) return <a href={l.href} class="text-blue-600 hover:text-blue-800 underline" onClick={handleInternalClick}>{text()}</a>;
    return <a href={l.href} target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-800 underline">{text()}</a>;
  };

  return (
    <Dynamic component={tag()} class="m-0 whitespace-pre-wrap" style={css()}>
      {renderInner()}
    </Dynamic>
  );
}
