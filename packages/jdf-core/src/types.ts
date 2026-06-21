export type Unit = "mm" | "in" | "pt" | "px";
export type PageSizeName = "A4" | "A3" | "A5" | "Letter" | "Legal" | "Tabloid";
export type PageOrientation = "portrait" | "landscape";
export type FontWeight = "normal" | "bold" | "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900";
export type TextAlign = "left" | "center" | "right" | "justify";
export type ImageFit = "contain" | "cover" | "fill" | "none";
export type ListType = "ordered" | "unordered";
export type ShapeType = "rect" | "circle" | "ellipse" | "line" | "path";
export type LinkType = "internal" | "external";

export interface Margins { top?: number; right?: number; bottom?: number; left?: number; }
export interface Position { x: number; y: number; }
export interface CustomPageSize { width: number; height: number; }
export type PageSize = PageSizeName | CustomPageSize;

export interface Style {
  fontFamily?: string; fontSize?: number; fontWeight?: FontWeight; fontStyle?: "normal" | "italic";
  textDecoration?: "none" | "underline" | "strikethrough" | "underline strikethrough" | "line-through";
  color?: string; backgroundColor?: string; textAlign?: TextAlign; lineHeight?: number;
  letterSpacing?: number | string; padding?: number | string | Margins;
  margin?: number | string | Margins; marginTop?: number; marginBottom?: number;
  border?: string; borderRadius?: number | string; opacity?: number;
}

export type StyleRef = string | string[] | Style;

export type Link = string | { type: LinkType; target: string };

export interface FontResource { family: string; src: "embedded" | "file" | "system"; data?: string; path?: string; weight?: string; style?: string; }
export interface ImageResource { src?: "embedded" | "file"; mimeType?: string; data?: string; path?: string; }
export type Resources = {
  fonts?: FontResource[];
  images?: Record<string, ImageResource>;
} & Record<string, ImageResource | undefined>;

export interface HeaderFooter {
  height?: number;
  elements?: Element[];
  content?: string;
  style?: StyleRef;
}

export interface TextElement {
  type: "text";
  content: string;
  style?: StyleRef;
  position?: Position;
  width?: number;
  height?: number;
  align?: TextAlign;
  heading?: boolean | 1 | 2 | 3 | 4 | 5 | 6;
  tocEntry?: string;
  tocLevel?: number;
  link?: Link;
}

export interface RichTextRun {
  text: string;
  style?: StyleRef;
  link?: Link;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
}

export interface RichTextElement {
  type: "richtext";
  runs: RichTextRun[];
  style?: StyleRef;
  position?: Position;
  width?: number;
  height?: number;
}

export interface ImageElement {
  type: "image";
  resource?: string;
  src?: string;
  alt?: string;
  position?: Position;
  width?: number;
  height?: number;
  fit?: ImageFit;
  link?: Link;
  style?: StyleRef;
}

export type TableCellValue = string | { content: string; style?: StyleRef; colspan?: number; rowspan?: number };

export interface TableColumn { width?: string | number; header?: string; align?: TextAlign; }

export interface TableBorders { outer?: boolean; inner?: boolean; color?: string; width?: number; }

export interface TableElement {
  type: "table";
  columns?: TableColumn[];
  headers?: string[];
  rows: TableCellValue[][];
  position?: Position;
  width?: number;
  headerStyle?: StyleRef;
  rowStyle?: StyleRef;
  alternateRowStyle?: StyleRef;
  alternatingRowColor?: string;
  borders?: boolean | TableBorders;
  style?: StyleRef;
}

export interface ListItem {
  content: string;
  style?: StyleRef;
  children?: ListItem[];
  listType?: ListType;
}

export interface ListElement {
  type: "list";
  items: ListItem[];
  listType?: ListType;
  ordered?: boolean;
  position?: Position;
  width?: number;
  style?: StyleRef;
}

export interface ShapeStroke { color?: string; width?: number; }

export interface ShapeElement {
  type: "shape";
  shape: ShapeType;
  position?: Position;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string | ShapeStroke;
  strokeWidth?: number;
  borderRadius?: number;
  path?: string;
  points?: Position[];
  style?: StyleRef;
}

export interface CollapsibleElement {
  type: "collapsible";
  title: string;
  elements: Element[];
  expanded?: boolean;
  position?: Position;
  width?: number;
  style?: StyleRef;
}

export interface TocElement {
  type: "toc";
  position?: Position;
  width?: number;
  depth?: number;
  style?: StyleRef;
  title?: string;
}

/**
 * Form input — a fillable text field. The user types into it; the value
 * lives on the document. When jdf.js exports the document (the user clicks
 * the embed's save button), the rendered DOM's value is read back into
 * `value` and the resulting JSON is downloaded — that's the whole point of
 * JDF forms: the document carries its own filled state.
 */
export interface FormInputElement {
  type: "input";
  /** Stable field name — used by RAG / scripts to look the value up by key
   *  instead of by position. Required. */
  name: string;
  /** HTML-style input type. `text` is the default. `signature` renders a
   *  signature pad; the value is a base64 PNG. */
  inputType?: "text" | "number" | "email" | "url" | "tel" | "date" | "time" | "datetime-local" | "password" | "color";
  /** Current value — what the user typed. Empty string by default. */
  value?: string;
  /** Placeholder text shown when value is empty. */
  placeholder?: string;
  /** Disable editing in the rendered form. */
  readonly?: boolean;
  /** Mark required for client-side validation hint. */
  required?: boolean;
  /** Optional pattern (regex string) for validation hint. */
  pattern?: string;
  /** Free-form label rendered above / next to the input. */
  label?: string;
  position?: Position;
  width?: number;
  height?: number;
  style?: StyleRef;
}

export interface FormTextareaElement {
  type: "textarea";
  name: string;
  value?: string;
  placeholder?: string;
  readonly?: boolean;
  required?: boolean;
  rows?: number;
  label?: string;
  position?: Position;
  width?: number;
  height?: number;
  style?: StyleRef;
}

export interface FormCheckboxElement {
  type: "checkbox";
  name: string;
  /** True when the box is ticked. Default false. */
  checked?: boolean;
  label?: string;
  readonly?: boolean;
  required?: boolean;
  position?: Position;
  width?: number;
  height?: number;
  style?: StyleRef;
}

export interface FormSelectOption {
  value: string;
  label?: string;
}

export interface FormSelectElement {
  type: "select";
  name: string;
  options: FormSelectOption[];
  /** Currently-selected option value (empty string = none selected). */
  value?: string;
  /** Allow choosing multiple options. */
  multiple?: boolean;
  /** Selected values when `multiple: true`. */
  values?: string[];
  label?: string;
  readonly?: boolean;
  required?: boolean;
  position?: Position;
  width?: number;
  height?: number;
  style?: StyleRef;
}

export interface FormSignatureElement {
  type: "signature";
  name: string;
  /** base64 PNG of the rendered signature, or empty string. */
  value?: string;
  label?: string;
  readonly?: boolean;
  required?: boolean;
  position?: Position;
  width?: number;
  height?: number;
  style?: StyleRef;
}

export type FormElement =
  | FormInputElement
  | FormTextareaElement
  | FormCheckboxElement
  | FormSelectElement
  | FormSignatureElement;

export type Element =
  | TextElement
  | RichTextElement
  | ImageElement
  | TableElement
  | ListElement
  | ShapeElement
  | CollapsibleElement
  | TocElement
  | FormElement;

export interface Page {
  id?: string;
  pageSize?: PageSize;
  pageOrientation?: PageOrientation;
  margins?: Margins;
  background?: string;
  flow?: boolean;
  header?: HeaderFooter;
  footer?: HeaderFooter;
  elements: Element[];
}

export interface Meta {
  title: string;
  author?: string;
  created?: string;
  modified?: string;
  language?: string;
  keywords?: string[];
  pageSize?: PageSize;
  pageOrientation?: PageOrientation;
  margins?: Margins;
  unit?: Unit;
}

export interface JdfDocument {
  $jdf: string;
  meta: Meta;
  styles?: Record<string, Style>;
  resources?: Resources;
  header?: HeaderFooter;
  footer?: HeaderFooter;
  pages: Page[];
}
