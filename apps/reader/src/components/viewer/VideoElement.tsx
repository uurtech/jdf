import { Show } from "solid-js";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { VideoElement, Style, Resources, ImageResource } from "@jdf/core";
import { resolveStyle } from "./PageRenderer";
import { Editable } from "../shared/Editable";
import { useEdit, type ElementPath } from "../../edit/context";

interface VideoElementViewProps {
  element: VideoElement;
  path: ElementPath;
  styles: Record<string, Style>;
  resources?: Resources;
}

/** `resource` ids may live in resources.videos (bundled clips) or resources.images (posters). */
function lookupResource(resources: Resources | undefined, key: string): ImageResource | undefined {
  if (!resources) return undefined;
  return resources.videos?.[key] ?? resources.images?.[key] ?? undefined;
}

function resolveMedia(resources: Resources | undefined, ref: string | undefined, fallbackMime: string): string {
  if (!ref) return "";
  if (ref.startsWith("data:") || /^https?:\/\//i.test(ref) || ref.startsWith("asset:") || ref.startsWith("blob:")) return ref;
  const res = lookupResource(resources, ref);
  if (res?.data) {
    if (res.data.startsWith("data:")) return res.data;
    return `data:${res.mimeType || fallbackMime};base64,${res.data}`;
  }
  if (res?.path) {
    try { return convertFileSrc(res.path); } catch { return res.path; }
  }
  return ref;
}

/**
 * Same DOM contract as jdf.js's renderVideo: an HTML5 <video> filling the
 * element box, controls on by default, muted whenever autoplay is set
 * (browsers block unmuted autoplay). PDF export draws a poster placeholder.
 */
/** Build a WebVTT captions track from the transcript so playback shows the same text RAG indexes. */
export function transcriptToVttUrl(el: VideoElement): string | undefined {
  const segs = el.transcript?.segments;
  if (!segs?.length) return undefined;
  const ts = (t: number) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`; };
  const body = segs.map((sg, i) => `${i + 1}\n${ts(sg.t0)} --> ${ts(Math.max(sg.t1, sg.t0 + 0.2))}\n${sg.speaker ? sg.speaker + ": " : ""}${sg.text}`).join("\n\n");
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n${body}\n`)}`;
}

export function VideoElementView(props: VideoElementViewProps) {
  const edit = useEdit();
  const vtt = () => transcriptToVttUrl(props.element);
  const css = () => resolveStyle(props.element.style, props.styles);
  const src = () => {
    const el = props.element;
    if (el.src && (el.src.startsWith("data:") || /^https?:\/\//i.test(el.src))) return el.src;
    if (el.resource) return resolveMedia(props.resources, el.resource, "video/mp4");
    return el.src || "";
  };
  const poster = () => resolveMedia(props.resources, props.element.poster, "image/png");
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
      <video
        src={src()}
        poster={poster() || undefined}
        title={props.element.title || ""}
        aria-label={props.element.title || "video"}
        controls={props.element.controls !== false}
        autoplay={!!props.element.autoplay}
        loop={!!props.element.loop}
        muted={!!props.element.muted || !!props.element.autoplay}
        playsinline
        preload="metadata"
        class={`${fitClass()} block bg-black`}
        style={{ ...css(), width: "100%", height: "100%" }}
        data-jdf-video={props.element.id || undefined}
      >
        <Show when={vtt()}>
          <track kind="captions" src={vtt()} srclang={props.element.transcript?.language || "en"} label="Transcript" default />
        </Show>
      </video>
      <Show when={edit.enabled()}>
        <div class="text-[10px] text-gray-400 mt-1">
          src: <Editable value={props.element.src || ""} onCommit={(v) => edit.updateField(props.path, "src", v)} placeholder="(empty)" />
          {" · title: "}
          <Editable value={props.element.title || ""} onCommit={(v) => edit.updateField(props.path, "title", v)} placeholder="(empty)" />
        </div>
      </Show>
    </div>
  );
}
