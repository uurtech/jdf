import { For, createEffect } from "solid-js";
import type { JdfDocument } from "@jdf/core";
import { PageRenderer } from "./PageRenderer";

interface DocumentViewerProps {
  document: JdfDocument;
  zoom: number;
  currentPage: number;
  editable: boolean;
  onPageChange: (page: number) => void;
}

export function DocumentViewer(props: DocumentViewerProps) {
  let containerRef!: HTMLDivElement;
  let scrollFromUser = true;

  createEffect(() => {
    const target = props.currentPage;
    if (!containerRef) return;
    const pageEl = containerRef.querySelector(`[data-page-index="${target}"]`) as HTMLElement | null;
    if (pageEl) {
      scrollFromUser = false;
      pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => { scrollFromUser = true; }, 700);
    }
  });

  function handleScroll() {
    if (!containerRef || !scrollFromUser) return;
    const pages = containerRef.querySelectorAll("[data-page-index]");
    const containerTop = containerRef.scrollTop;
    const containerMid = containerTop + containerRef.clientHeight / 3;
    let closest = 0;
    let closestDist = Infinity;
    pages.forEach((el) => {
      const idx = Number(el.getAttribute("data-page-index"));
      const top = (el as HTMLElement).offsetTop;
      const dist = Math.abs(top - containerMid);
      if (dist < closestDist) { closestDist = dist; closest = idx; }
    });
    if (closest !== props.currentPage) props.onPageChange(closest);
  }

  return (
    <div ref={containerRef} class={`h-full overflow-auto bg-gray-100 dark:bg-slate-900 transition-colors ${props.editable ? "edit-mode" : ""}`} onScroll={handleScroll}>
      <div class="flex flex-col items-center gap-8 py-8" style={{ transform: `scale(${props.zoom})`, "transform-origin": "top center" }}>
        <For each={props.document.pages}>
          {(page, index) => (
            <div data-page-index={index()}>
              <PageRenderer
                page={page}
                pageIndex={index()}
                totalPages={props.document.pages.length}
                document={props.document}
                styles={props.document.styles || {}}
                onNavigatePage={props.onPageChange}
              />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
