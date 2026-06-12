import { Show } from "solid-js";
import type { ImageElement, Style, Resources, ImageResource } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";
import { Editable } from "../shared/Editable";
import { useEdit, type ElementPath } from "../../edit/context";

interface ImageElementViewProps {
  element: ImageElement;
  path: ElementPath;
  styles: Record<string, Style>;
  resources?: Resources;
}

function lookupResource(resources: Resources | undefined, key: string): ImageResource | undefined {
  if (!resources) return undefined;
  const direct = (resources as any)[key];
  if (direct && typeof direct === "object" && "data" in direct) return direct as ImageResource;
  const inImages = resources.images?.[key];
  if (inImages) return inImages;
  return undefined;
}

export function ImageElementView(props: ImageElementViewProps) {
  const edit = useEdit();
  const css = () => resolveStyle(props.element.style, props.styles);

  const src = (): string => {
    const el = props.element;
    if (el.src?.startsWith("data:") || el.src?.startsWith("http")) return el.src;
    if (el.resource) {
      const res = lookupResource(props.resources, el.resource);
      if (res?.data) {
        const mime = res.mimeType || "image/png";
        if (res.data.startsWith("data:")) return res.data;
        return `data:${mime};base64,${res.data}`;
      }
      if (res?.path) return res.path;
    }
    return el.src || "";
  };

  const fitClass = () => {
    switch (props.element.fit) {
      case "cover": return "object-cover";
      case "fill": return "object-fill";
      case "none": return "object-none";
      default: return "object-contain";
    }
  };

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <img
        src={src()}
        alt={props.element.alt || ""}
        class={`${fitClass()} block`}
        style={{ ...css(), width: "100%", height: "100%" }}
      />
      <Show when={edit.enabled()}>
        <div class="text-[10px] text-gray-400 mt-1">
          src: <Editable value={props.element.src || ""} onCommit={(v) => edit.updateField(props.path, "src", v)} placeholder="(empty)" />
          {" · alt: "}
          <Editable value={props.element.alt || ""} onCommit={(v) => edit.updateField(props.path, "alt", v)} placeholder="(empty)" />
        </div>
      </Show>
    </div>
  );
}
