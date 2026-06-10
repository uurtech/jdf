import { For } from "solid-js";
import type { RichTextElement, Style } from "@jdf/core";
import { resolveStyle, styleToCss } from "./PageRenderer";

interface RichTextElementViewProps {
  element: RichTextElement;
  styles: Record<string, Style>;
}

export function RichTextElementView(props: RichTextElementViewProps) {
  const containerCss = () => resolveStyle(props.element.style, props.styles);

  return (
    <p style={containerCss()}>
      <For each={props.element.runs || []}>
        {(run) => {
          const runStyle = () => {
            const css: Record<string, string> = {};
            if (run.bold) css["font-weight"] = "bold";
            if (run.italic) css["font-style"] = "italic";
            if (run.underline) css["text-decoration"] = "underline";
            if (run.strikethrough) css["text-decoration"] = "line-through";
            if (run.color) css["color"] = run.color;
            if (run.fontSize) css["font-size"] = `${run.fontSize * 1.333}px`;
            if (run.fontFamily) css["font-family"] = run.fontFamily;
            if (run.style) Object.assign(css, styleToCss(typeof run.style === "string" ? (props.styles[run.style] || {}) : run.style));
            return css;
          };

          if (run.link) {
            return (
              <a href={run.link} target="_blank" rel="noopener noreferrer" class="text-blue-600 underline" style={runStyle()}>
                {run.text}
              </a>
            );
          }

          return <span style={runStyle()}>{run.text}</span>;
        }}
      </For>
    </p>
  );
}
