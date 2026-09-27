import { Switch, Match, Show, For, createUniqueId } from "solid-js";
import type { ShapeElement, Style } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";

interface ShapeElementViewProps {
  element: ShapeElement;
  styles: Record<string, Style>;
}

export function ShapeElementView(props: ShapeElementViewProps) {
  const css = () => resolveStyle(props.element.style, props.styles);
  const shape = () => props.element.shape;
  // Gradient fill via SVG defs — same geometry as jdf.js renderShape.
  const gradId = `jdf-grad-${createUniqueId()}`;
  const grad = () => { const g = props.element.gradient; return g && Array.isArray(g.stops) && g.stops.length >= 2 ? g : undefined; };
  const gradVec = () => { const a = ((grad()?.angle ?? 180) * Math.PI) / 180; return { dx: Math.sin(a) / 2, dy: -Math.cos(a) / 2 }; };
  const fill = () => (grad() ? `url(#${gradId})` : props.element.fill ?? "none");
  const strokeColor = () => {
    const s = props.element.stroke;
    if (typeof s === "string") return s;
    if (s?.color) return s.color;
    return "none";
  };
  const strokeWidth = () => {
    const s = props.element.stroke;
    if (typeof s === "object" && s?.width != null) return s.width;
    return props.element.strokeWidth ?? 0;
  };
  // Min radius / extent so a degenerate 0-area shape (PDF importer can emit
  // these for thin lines or 1-px borders) still draws a visible mark instead
  // of silently disappearing. 0.05mm matches the importer's existing clamp
  // for path widths.
  const w = () => Math.max(0.05, props.element.width ?? 100);
  const h = () => Math.max(0.05, props.element.height ?? 100);

  return (
    <div style={{ ...css(), width: "100%", height: "100%", display: "block" }}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${w()} ${h()}`}
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: "block", overflow: "visible" }}
      >
        <Show when={grad()}>
          <defs>
            <Show when={grad()!.type === "radial"} fallback={
              <linearGradient id={gradId} x1={0.5 - gradVec().dx} y1={0.5 - gradVec().dy} x2={0.5 + gradVec().dx} y2={0.5 + gradVec().dy}>
                <For each={grad()!.stops}>{(st) => <stop offset={`${Math.max(0, Math.min(1, st.offset)) * 100}%`} stop-color={st.color} />}</For>
              </linearGradient>
            }>
              <radialGradient id={gradId} cx="50%" cy="50%" r="50%">
                <For each={grad()!.stops}>{(st) => <stop offset={`${Math.max(0, Math.min(1, st.offset)) * 100}%`} stop-color={st.color} />}</For>
              </radialGradient>
            </Show>
          </defs>
        </Show>
        <Switch>
          <Match when={shape() === "rect"}>
            <rect
              x="0" y="0" width={w()} height={h()}
              fill={fill()} stroke={strokeColor()} stroke-width={strokeWidth()}
              rx={props.element.borderRadius ?? 0}
            />
          </Match>
          <Match when={shape() === "circle"}>
            <circle
              cx={w() / 2} cy={h() / 2}
              r={Math.min(w(), h()) / 2}
              fill={fill()} stroke={strokeColor()} stroke-width={strokeWidth()}
            />
          </Match>
          <Match when={shape() === "ellipse"}>
            <ellipse
              cx={w() / 2} cy={h() / 2}
              rx={w() / 2} ry={h() / 2}
              fill={fill()} stroke={strokeColor()} stroke-width={strokeWidth()}
            />
          </Match>
          <Match when={shape() === "line"}>
            {/* Line from top-left to bottom-right of the bbox; importer encodes both diagonals
                by setting (width, height) to absolute deltas, so this draws the bounding diagonal.
                For a horizontal line height ≈ 0; for vertical width ≈ 0. */}
            <line
              x1="0" y1="0" x2={w()} y2={h()}
              stroke={strokeColor() === "none" ? (fill() !== "none" ? fill() : "currentColor") : strokeColor()}
              stroke-width={strokeWidth() || 0.3}
            />
          </Match>
          <Match when={shape() === "path"}>
            <path
              d={props.element.path || ""}
              fill={fill()} stroke={strokeColor()} stroke-width={strokeWidth()}
              fill-rule="evenodd"
            />
          </Match>
        </Switch>
      </svg>
    </div>
  );
}
