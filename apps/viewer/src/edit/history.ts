import { createSignal } from "solid-js";
import type { JdfDocument } from "@jdf/core";

const MAX_HISTORY = 100;

export function createHistory(initial: JdfDocument | null) {
  const [past, setPast] = createSignal<JdfDocument[]>([]);
  const [future, setFuture] = createSignal<JdfDocument[]>([]);
  const [present, setPresent] = createSignal<JdfDocument | null>(initial);

  function reset(doc: JdfDocument | null) {
    setPast([]);
    setFuture([]);
    setPresent(doc);
  }

  function push(next: JdfDocument) {
    const cur = present();
    if (cur) {
      const p = past();
      const trimmed = p.length >= MAX_HISTORY ? p.slice(1) : p;
      setPast([...trimmed, cur]);
    }
    setFuture([]);
    setPresent(next);
  }

  function undo(): JdfDocument | null {
    const p = past();
    if (p.length === 0) return present();
    const previous = p[p.length - 1];
    setPast(p.slice(0, -1));
    const cur = present();
    if (cur) setFuture([cur, ...future()]);
    setPresent(previous);
    return previous;
  }

  function redo(): JdfDocument | null {
    const f = future();
    if (f.length === 0) return present();
    const next = f[0];
    setFuture(f.slice(1));
    const cur = present();
    if (cur) setPast([...past(), cur]);
    setPresent(next);
    return next;
  }

  return {
    present,
    setPresent,
    canUndo: () => past().length > 0,
    canRedo: () => future().length > 0,
    push,
    undo,
    redo,
    reset,
  };
}
