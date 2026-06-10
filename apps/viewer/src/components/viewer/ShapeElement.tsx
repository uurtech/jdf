import { Switch, Match } from "solid-js";
import type { ShapeElement, Style } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";

interface ShapeElementViewProps {
  element: ShapeElement;
  styles: Record<string, Style>;
}

export function ShapeElementView(props: ShapeElementViewProps) {
  const css = () => resolveStyle(props.element.style, props.styles);
  const shape = () => props.element.shape;
  const fill = () => props.element.fill ?? "none";
  const strokeColor = () => {
    const s = props.element.stroke;
    if (typeof s === "string") return s;
    if (s?.color) return s.color;
    return props.element.fill ? "none" : "currentColor";
  };
  const strokeWidth = () => {
    const s = props.element.stroke;
    if (typeof s === "object" && s?.width != null) return s.width;
    return props.element.strokeWidth ?? 1;
  };
  const w = () => props.element.width ?? 100;
  const h = () => props.element.height ?? 100;

  return (
    <div style={css()}>
      <svg width={w()} height={h()} viewBox={`0 0 ${w()} ${h()}`} xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
        <Switch>
          <Match when={shape() === "rect"}>
            <rect x="0" y="0" width={w()} height={h()} fill={fill()} stroke={strokeColor()} stroke-width={strokeWidth()} rx={props.element.borderRadius ?? 0} />
          </Match>
          <Match when={shape() === "circle"}>
            <circle cx={w() / 2} cy={h() / 2} r={Math.min(w(), h()) / 2} fill={fill()} stroke={strokeColor()} stroke-width={strokeWidth()} />
          </Match>
          <Match when={shape() === "ellipse"}>
            <ellipse cx={w() / 2} cy={h() / 2} rx={w() / 2} ry={h() / 2} fill={fill()} stroke={strokeColor()} stroke-width={strokeWidth()} />
          </Match>
          <Match when={shape() === "line"}>
            <line x1="0" y1={h() / 2} x2={w()} y2={h() / 2} stroke={strokeColor()} stroke-width={strokeWidth()} />
          </Match>
          <Match when={shape() === "path"}>
            <path d={props.element.path || ""} fill={fill()} stroke={strokeColor()} stroke-width={strokeWidth()} />
          </Match>
        </Switch>
      </svg>
    </div>
  );
}
