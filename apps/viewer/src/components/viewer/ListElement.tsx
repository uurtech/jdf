import { For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { ListElement, Style, ListItem, ListType } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";
import { Editable } from "../shared/Editable";
import { useEdit, type ElementPath } from "../../edit/context";

interface ListElementViewProps {
  element: ListElement;
  path: ElementPath;
  styles: Record<string, Style>;
}

function ItemTree(props: { items: ListItem[]; defaultType: ListType; basePath: ElementPath; styles: Record<string, Style> }) {
  const edit = useEdit();
  return (
    <For each={props.items}>
      {(item, index) => {
        const childType = item.listType || props.defaultType;
        const itemPath = [...props.basePath, index()];
        return (
          <li class="text-[14px] leading-relaxed">
            {edit.enabled ? (
              <Editable
                value={item.content}
                onCommit={(v) => edit.updateField(itemPath, "content", v)}
              />
            ) : (
              <span>{item.content}</span>
            )}
            <Show when={item.children && item.children.length > 0}>
              <Dynamic
                component={childType === "ordered" ? "ol" : "ul"}
                class={`${childType === "ordered" ? "list-decimal" : "list-disc"} pl-5 mt-1`}
              >
                <ItemTree items={item.children!} defaultType={childType} basePath={[...itemPath, "children"]} styles={props.styles} />
              </Dynamic>
            </Show>
          </li>
        );
      }}
    </For>
  );
}

export function ListElementView(props: ListElementViewProps) {
  const css = () => resolveStyle(props.element.style, props.styles);
  const listType = (): ListType => {
    if (props.element.listType) return props.element.listType;
    if (props.element.ordered) return "ordered";
    return "unordered";
  };

  return (
    <div style={css()}>
      <Dynamic
        component={listType() === "ordered" ? "ol" : "ul"}
        class={`${listType() === "ordered" ? "list-decimal" : "list-disc"} pl-5 space-y-1 m-0`}
      >
        <ItemTree items={props.element.items || []} defaultType={listType()} basePath={[...props.path, "items"]} styles={props.styles} />
      </Dynamic>
    </div>
  );
}
