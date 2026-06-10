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

interface ElementRendererProps {
  element: Element;
  styles: Record<string, Style>;
  resources?: Resources;
  document?: JdfDocument;
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

    if (el.width) {
      style["width"] = `${unitToPx(el.width)}px`;
    }

    return style;
  };

  return (
    <div style={positionStyle()}>
      <Switch fallback={<div class="text-xs text-gray-400">[{(props.element as any).type}]</div>}>
        <Match when={(props.element as any).type === "text"}>
          <TextElementView element={props.element as any} styles={props.styles} />
        </Match>
        <Match when={(props.element as any).type === "richtext"}>
          <RichTextElementView element={props.element as any} styles={props.styles} />
        </Match>
        <Match when={(props.element as any).type === "image"}>
          <ImageElementView element={props.element as any} styles={props.styles} resources={props.resources} />
        </Match>
        <Match when={(props.element as any).type === "table"}>
          <TableElementView element={props.element as any} styles={props.styles} />
        </Match>
        <Match when={(props.element as any).type === "list"}>
          <ListElementView element={props.element as any} styles={props.styles} />
        </Match>
        <Match when={(props.element as any).type === "shape"}>
          <ShapeElementView element={props.element as any} styles={props.styles} />
        </Match>
        <Match when={(props.element as any).type === "collapsible"}>
          <CollapsibleElementView element={props.element as any} styles={props.styles} resources={props.resources} document={props.document} />
        </Match>
        <Match when={(props.element as any).type === "toc"}>
          <TocElementView element={props.element as any} styles={props.styles} document={props.document} />
        </Match>
      </Switch>
    </div>
  );
}
