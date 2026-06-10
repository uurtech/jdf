import { For } from "solid-js";
import type { ListElement, Style } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";

interface ListElementViewProps {
  element: ListElement;
  styles: Record<string, Style>;
}

interface ListItem {
  content: string;
  children?: ListItem[];
}

function ListItems(props: { items: ListItem[]; ordered: boolean; styles: Record<string, Style> }) {
  const Tag = props.ordered ? "ol" : "ul";

  return (
    <Tag class={`${props.ordered ? "list-decimal" : "list-disc"} pl-5 space-y-1`}>
      <For each={props.items}>
        {(item) => (
          <li class="text-sm">
            {item.content}
            {item.children && item.children.length > 0 && (
              <ListItems items={item.children} ordered={props.ordered} styles={props.styles} />
            )}
          </li>
        )}
      </For>
    </Tag>
  );
}

export function ListElementView(props: ListElementViewProps) {
  const css = () => resolveStyle(props.element.style, props.styles);
  const ordered = () => props.element.ordered ?? false;
  const items = () => props.element.items || [];

  return (
    <div style={css()}>
      <ListItems items={items()} ordered={ordered()} styles={props.styles} />
    </div>
  );
}
