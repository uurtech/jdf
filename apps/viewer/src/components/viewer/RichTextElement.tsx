import { For } from "solid-js";
import type { RichTextElement, Style, RichTextRun, Link } from "@jdf/core";
import { resolveStyle, styleToCss } from "./PageRenderer";
import { Editable } from "../shared/Editable";
import { useEdit, type ElementPath } from "../../edit/context";

interface RichTextElementViewProps {
  element: RichTextElement;
  path: ElementPath;
  styles: Record<string, Style>;
  onNavigatePage?: (pageIndex: number) => void;
}

function runCss(run: RichTextRun, styles: Record<string, Style>): Record<string, string> {
  const css: Record<string, string> = {};
  if (run.style) {
    if (typeof run.style === "string") Object.assign(css, styleToCss(styles[run.style] || {}));
    else if (Array.isArray(run.style)) for (const s of run.style) Object.assign(css, styleToCss(styles[s] || {}));
    else Object.assign(css, styleToCss(run.style));
  }
  if (run.bold) css["font-weight"] = "bold";
  if (run.italic) css["font-style"] = "italic";
  const decos: string[] = [];
  if (run.underline) decos.push("underline");
  if (run.strikethrough) decos.push("line-through");
  if (decos.length) css["text-decoration"] = decos.join(" ");
  if (run.color) css["color"] = run.color;
  if (run.fontSize) css["font-size"] = `${run.fontSize * 1.333}px`;
  if (run.fontFamily) css["font-family"] = run.fontFamily;
  return css;
}

function linkInfo(link: Link | undefined) {
  if (!link) return null;
  if (typeof link === "string") return { href: link, internal: link.startsWith("#") };
  return { href: link.target, internal: link.type === "internal" };
}

export function RichTextElementView(props: RichTextElementViewProps) {
  const edit = useEdit();
  const containerCss = () => resolveStyle(props.element.style, props.styles);
  const fullText = () => (props.element.runs || []).map((r) => r.text).join("");

  function commitWholeParagraph(next: string) {
    const runs = props.element.runs || [];
    if (runs.length === 1) {
      edit.updateField(props.path, "runs.0.text", next);
      return;
    }
    edit.updateField(props.path, "runs", [{ text: next }]);
  }

  if (edit.enabled) {
    const isLong = () => fullText().length > 60 || fullText().includes("\n");
    return (
      <Editable
        as="p"
        value={fullText()}
        multiline={isLong()}
        onCommit={commitWholeParagraph}
        class="m-0 whitespace-pre-wrap"
        style={containerCss() as any}
      />
    );
  }

  return (
    <p class="m-0" style={containerCss()}>
      <For each={props.element.runs || []}>
        {(run) => {
          const css = runCss(run, props.styles);
          const link = linkInfo(run.link);

          if (link) {
            return (
              <a
                href={link.href}
                class="text-blue-600 hover:text-blue-800 underline"
                target={link.internal ? undefined : "_blank"}
                rel={link.internal ? undefined : "noopener noreferrer"}
                onClick={(e) => {
                  if (link.internal && props.onNavigatePage) {
                    e.preventDefault();
                    const m = link.href.replace(/^#/, "").match(/^page-(\d+)$/i);
                    if (m) props.onNavigatePage(Number(m[1]) - 1);
                  }
                }}
                style={css}
              >
                {run.text}
              </a>
            );
          }
          return <span style={css}>{run.text}</span>;
        }}
      </For>
    </p>
  );
}
