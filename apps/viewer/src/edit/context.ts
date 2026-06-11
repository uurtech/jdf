import { createContext, useContext } from "solid-js";

export type ElementPath = (string | number)[];

export interface EditAPI {
  enabled: boolean;
  updateField: (path: ElementPath, field: string, value: unknown) => void;
}

export const EditContext = createContext<EditAPI>({
  enabled: false,
  updateField: () => {},
});

export function useEdit(): EditAPI {
  return useContext(EditContext);
}
