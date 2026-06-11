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
import { useEdit, type ElementPath } from "../../edit/context";
import { ContextMenu, type MenuItem } from "../shared/ContextMenu";
import { makeBlankElement } from "../../edit/mutations";

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
  const [menuPos, setMenuPos] = createSignal<{ x: number; y: number } | null>(null);

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

  function onContextMenu(e: MouseEvent) {
    if (!edit.enabled) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
  }

  function buildMenuItems(): MenuItem[] {
    const types: Element["type"][] = ["text", "richtext", "list", "table", "shape", "image", "collapsible", "toc"];
    return [
      {
        label: "Insert below",
        submenu: types.map((t) => ({
          label: t.charAt(0).toUpperCase() + t.slice(1),
          onClick: () => {
            const newEl = makeBlankElement(t);
            // Position the new element just below the current one
            const cur = props.element as any;
            if (cur.position) {
              (newEl as any).position = { x: cur.position.x || 0, y: (cur.position.y || 0) + (cur.height || 10) + 4 };
            }
            edit.insertAfter(props.path, newEl);
          },
        })),
      },
      { label: "Duplicate", shortcut: "⌘D", onClick: () => edit.duplicateAt(props.path) },
      { separator: true, label: "" },
      { label: "Move up", shortcut: "↑", onClick: () => edit.moveAt(props.path, -1) },
      { label: "Move down", shortcut: "↓", onClick: () => edit.moveAt(props.path, 1) },
      { separator: true, label: "" },
      { label: "Delete", shortcut: "⌫", danger: true, onClick: () => edit.deleteAt(props.path) },
    ];
  }

  return (
    <>
      <div
        style={positionStyle()}
        onContextMenu={onContextMenu}
        class={edit.enabled ? "jdf-element-target" : ""}
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
        </Switch>
      </div>
      <Show when={menuPos()}>
        <ContextMenu
          x={menuPos()!.x}
          y={menuPos()!.y}
          items={buildMenuItems()}
          onClose={() => setMenuPos(null)}
        />
      </Show>
    </>
  );
}
