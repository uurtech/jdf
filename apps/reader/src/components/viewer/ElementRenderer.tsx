import { Switch, Match, createSignal, Show } from "solid-js";
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
import { FormElementSwitch } from "./FormElement";
import { useEdit, type ElementPath } from "../../edit/context";

interface ElementRendererProps {
  element: Element;
  path: ElementPath;
  styles: Record<string, Style>;
  resources?: Resources;
  document?: JdfDocument;
  onNavigatePage?: (pageIndex: number) => void;
}

export function ElementRenderer(props: ElementRendererProps) {
  const edit = useEdit();
  const [hover, setHover] = createSignal(false);

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
    <div
      style={positionStyle()}
      class={edit.enabled() ? "jdf-element-target" : ""}
      onMouseEnter={() => edit.enabled() && setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-element-path={JSON.stringify(props.path)}
    >
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
        <Match when={["input","textarea","checkbox","select","signature"].includes(props.element.type as string)}>
          <FormElementSwitch element={props.element} path={props.path} styles={props.styles} />
        </Match>
      </Switch>

      <Show when={edit.enabled() && hover()}>
        <div
          class="jdf-action-bar"
          onMouseDown={(e) => e.stopPropagation()}
          onDblClick={(e) => e.stopPropagation()}
        >
          <button title="Move up" onClick={(e) => { e.stopPropagation(); edit.moveAt(props.path, -1); }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M3 7l3-3 3 3" />
            </svg>
          </button>
          <button title="Move down" onClick={(e) => { e.stopPropagation(); edit.moveAt(props.path, 1); }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M3 5l3 3 3-3" />
            </svg>
          </button>
          <button title="Duplicate" onClick={(e) => { e.stopPropagation(); edit.duplicateAt(props.path); }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2" y="2" width="6" height="6" rx="1" />
              <rect x="4" y="4" width="6" height="6" rx="1" />
            </svg>
          </button>
          <button class="danger" title="Delete" onClick={(e) => { e.stopPropagation(); edit.deleteAt(props.path); }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
              <line x1="3" y1="3" x2="9" y2="9" />
              <line x1="9" y1="3" x2="3" y2="9" />
            </svg>
          </button>
        </div>
      </Show>
    </div>
  );
}
