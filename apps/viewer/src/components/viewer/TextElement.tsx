import { Show, Dynamic } from "solid-js/web";
import type { TextElement, Style } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";

interface TextElementViewProps {
  element: TextElement;
  styles: Record<string, Style>;
}

export function TextElementView(props: TextElementViewProps) {
  const css = () => resolveStyle(props.element.style, props.styles);
  const heading = () => props.element.heading;
  const link = () => props.element.link;

  const content = () => {
    const text = props.element.content || "";
    if (link()) {
      return (
        <a href={link()} target="_blank" rel="noopener noreferrer" class="text-blue-600 underline hover:text-blue-800">
          {text}
        </a>
      );
    }
    return text;
  };

  const tag = () => {
    const h = heading();
    if (h && h >= 1 && h <= 6) return `h${h}`;
    return "p";
  };

  return (
    <Dynamic component={tag()} style={css()}>
      {content()}
    </Dynamic>
  );
}
