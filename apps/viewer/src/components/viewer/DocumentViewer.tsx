import { For, createEffect, onMount } from "solid-js";
import type { JdfDocument } from "@jdf/core";
import { PageRenderer } from "./PageRenderer";

interface DocumentViewerProps {
  document: JdfDocument;
  zoom: number;
  currentPage: number;
  onPageChange: (page: number) => void;
}

export function DocumentViewer(props: DocumentViewerProps) {
  let containerRef!: HTMLDivElement;

  createEffect(() => {
    const pageEl = containerRef?.querySelector(`[data-page-index="${props.currentPage}"]`);
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  function handleScroll() {
    if (!containerRef) return;
    const pages = containerRef.querySelectorAll("[data-page-index]");
    const containerTop = containerRef.scrollTop;
    const containerMid = containerTop + containerRef.clientHeight / 3;

    let closest = 0;
    let closestDist = Infinity;

    pages.forEach((el) => {
      const idx = Number(el.getAttribute("data-page-index"));
      const top = (el as HTMLElement).offsetTop;
      const dist = Math.abs(top - containerMid);
      if (dist < closestDist) {
        closestDist = dist;
        closest = idx;
      }
    });

    if (closest !== props.currentPage) {
      props.onPageChange(closest);
    }
  }

  return (
    <div
      ref={containerRef}
      class="h-full overflow-auto bg-gray-100 p-8"
      onScroll={handleScroll}
    >
      <div
        class="flex flex-col items-center gap-8"
        style={{ transform: `scale(${props.zoom})`, "transform-origin": "top center" }}
      >
        <For each={props.document.pages}>
          {(page, index) => (
            <div data-page-index={index()}>
              <PageRenderer
                page={page}
                pageIndex={index()}
                totalPages={props.document.pages.length}
                document={props.document}
                styles={props.document.styles || {}}
              />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
