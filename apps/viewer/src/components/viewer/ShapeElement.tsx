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
  const fill = () => props.element.fill || "none";
  const stroke = () => props.element.stroke || "currentColor";
  const strokeWidth = () => props.element.strokeWidth ?? 1;
  const width = () => props.element.width ?? 100;
  const height = () => props.element.height ?? 100;

  return (
    <div style={css()}>
      <svg
        width={width()}
        height={height()}
        viewBox={`0 0 ${width()} ${height()}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <Switch>
          <Match when={shape() === "rect"}>
            <rect
              x="0" y="0"
              width={width()} height={height()}
              fill={fill()} stroke={stroke()} stroke-width={strokeWidth()}
              rx={props.element.borderRadius ?? 0}
            />
          </Match>
          <Match when={shape() === "circle"}>
            <circle
              cx={width() / 2} cy={height() / 2}
              r={Math.min(width(), height()) / 2}
              fill={fill()} stroke={stroke()} stroke-width={strokeWidth()}
            />
          </Match>
          <Match when={shape() === "ellipse"}>
            <ellipse
              cx={width() / 2} cy={height() / 2}
              rx={width() / 2} ry={height() / 2}
              fill={fill()} stroke={stroke()} stroke-width={strokeWidth()}
            />
          </Match>
          <Match when={shape() === "line"}>
            <line
              x1="0" y1={height() / 2}
              x2={width()} y2={height() / 2}
              stroke={stroke()} stroke-width={strokeWidth()}
            />
          </Match>
          <Match when={shape() === "path"}>
            <path
              d={props.element.path || ""}
              fill={fill()} stroke={stroke()} stroke-width={strokeWidth()}
            />
          </Match>
        </Switch>
      </svg>
    </div>
  );
}
