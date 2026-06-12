import { createContext, useContext } from "solid-js";
import type { Element } from "@jdf/core";

export type ElementPath = (string | number)[];

export interface EditAPI {
  /**
   * Reactive accessor — call as `edit.enabled()` to subscribe.
   * SolidJS context values are NOT reactive on their own; we wrap with
   * a getter so consumers re-render when the underlying signal changes.
   */
  enabled: () => boolean;
  updateField: (path: ElementPath, field: string, value: unknown) => void;
  deleteAt: (path: ElementPath) => void;
  duplicateAt: (path: ElementPath) => void;
  moveAt: (path: ElementPath, direction: -1 | 1) => void;
  insertAfter: (path: ElementPath, element: Element) => void;
  appendToPage: (pageIndex: number, element: Element) => void;
  insertPageAfter: (pageIndex: number) => void;
  deletePage: (pageIndex: number) => void;
}

const noop = () => {};

export const EditContext = createContext<EditAPI>({
  enabled: () => false,
  updateField: noop,
  deleteAt: noop,
  duplicateAt: noop,
  moveAt: noop,
  insertAfter: noop,
  appendToPage: noop,
  insertPageAfter: noop,
  deletePage: noop,
});

export function useEdit(): EditAPI {
  return useContext(EditContext);
}
