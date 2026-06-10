import type { ImageElement, Style, Resources, ImageResource } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";

interface ImageElementViewProps {
  element: ImageElement;
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
    <img
      src={src()}
      alt={props.element.alt || ""}
      class={`${fitClass()} block`}
      style={{ ...css(), "max-width": "100%", width: "100%", height: "auto" }}
    />
  );
}
