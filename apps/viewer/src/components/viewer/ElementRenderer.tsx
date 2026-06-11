import { Switch, Match } from "solid-js";
import type { Element, Style, Resources, JdfDocument } from "@jdf/core";
import { unitToPx } from "@jdf/core";
import { TextElementView } from "./TextElement";
import { RichTextElementView } from "./RichTextElement";
import { ImageElementView } from "./ImageElement";
import { TableElementView } from "./TableElement";
import { ListElementView } from "./ListElement";
import { ShapeElementView } from "./ShapeElement";
import { CollapsibleElementView } from "./CollapsibleElement";
import { TocElementView } from "./TocElement";
import type { ElementPath } from "../../edit/context";

interface ElementRendererProps {
  element: Element;
  path: ElementPath;
  styles: Record<string, Style>;
  resources?: Resources;
  document?: JdfDocument;
  onNavigatePage?: (pageIndex: number) => void;
}

export function ElementRenderer(props: ElementRendererProps) {
  const positionStyle = () => {
    const el = props.element as any;
    const style: Record<string, string> = {};
    if (el.position) {
      style["position"] = "absolute";
      if (el.position.x != null) style["left"] = `${unitToPx(el.position.x)}px`;
      if (el.position.y != null) style["top"] = `${unitToPx(el.position.y)}px`;
    }
    if (el.width) style["width"] = `${unitToPx(el.width)}px`;
    if (el.height) style["height"] = `${unitToPx(el.height)}px`;
    return style;
  };

  return (
    <div style={positionStyle()}>
      <Switch fallback={<div class="text-xs text-gray-400">[unknown: {(props.element as any).type}]</div>}>
        <Match when={props.element.type === "text"}>
          <TextElementView element={props.element as any} styles={props.styles} path={props.path} onNavigatePage={props.onNavigatePage} />
        </Match>
        <Match when={props.element.type === "richtext"}>
          <RichTextElementView element={props.element as any} styles={props.styles} path={props.path} onNavigatePage={props.onNavigatePage} />
        </Match>
        <Match when={props.element.type === "image"}>
          <ImageElementView element={props.element as any} styles={props.styles} resources={props.resources} path={props.path} />
        </Match>
        <Match when={props.element.type === "table"}>
          <TableElementView element={props.element as any} styles={props.styles} path={props.path} />
        </Match>
        <Match when={props.element.type === "list"}>
          <ListElementView element={props.element as any} styles={props.styles} path={props.path} />
        </Match>
        <Match when={props.element.type === "shape"}>
          <ShapeElementView element={props.element as any} styles={props.styles} />
        </Match>
        <Match when={props.element.type === "collapsible"}>
          <CollapsibleElementView element={props.element as any} styles={props.styles} resources={props.resources} document={props.document} path={props.path} onNavigatePage={props.onNavigatePage} />
        </Match>
        <Match when={props.element.type === "toc"}>
          <TocElementView element={props.element as any} styles={props.styles} document={props.document} onNavigatePage={props.onNavigatePage} />
        </Match>
      </Switch>
    </div>
  );
}
