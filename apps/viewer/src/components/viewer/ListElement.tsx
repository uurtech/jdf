import { For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { ListElement, Style, ListItem, ListType } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";

interface ListElementViewProps {
  element: ListElement;
  styles: Record<string, Style>;
}

function ItemTree(props: { items: ListItem[]; defaultType: ListType; styles: Record<string, Style> }) {
  return (
    <For each={props.items}>
      {(item) => {
        const childType = item.listType || props.defaultType;
        return (
          <li class="text-[14px] leading-relaxed">
            <span>{item.content}</span>
            <Show when={item.children && item.children.length > 0}>
              <Dynamic
                component={childType === "ordered" ? "ol" : "ul"}
                class={`${childType === "ordered" ? "list-decimal" : "list-disc"} pl-5 mt-1`}
              >
                <ItemTree items={item.children!} defaultType={childType} styles={props.styles} />
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
        <ItemTree items={props.element.items || []} defaultType={listType()} styles={props.styles} />
      </Dynamic>
    </div>
  );
}
