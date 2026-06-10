import type { ImageElement, Style, Resources } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";

interface ImageElementViewProps {
  element: ImageElement;
  styles: Record<string, Style>;
  resources?: Resources;
}

export function ImageElementView(props: ImageElementViewProps) {
  const css = () => resolveStyle(props.element.style, props.styles);

  const src = () => {
    const el = props.element;
    // Inline base64
    if (el.src?.startsWith("data:")) return el.src;
    // Resource reference
    if (el.resource && props.resources) {
      const res = props.resources[el.resource];
      if (res?.data) {
        const mime = res.mimeType || "image/png";
        return `data:${mime};base64,${res.data}`;
      }
      if (res?.path) return res.path;
    }
    // Direct path or URL
    return el.src || "";
  };

  return (
    <img
      src={src()}
      alt={props.element.alt || ""}
      style={{
        ...css(),
        "max-width": "100%",
        height: "auto",
      }}
      class="rounded"
    />
  );
}
