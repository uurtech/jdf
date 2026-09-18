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
  /** First-line indent in the document unit (mm by default) — written by the PDF importer for indented paragraphs. */
  textIndent?: number;
  letterSpacing?: number | string; padding?: number | string | Margins;
  margin?: number | string | Margins; marginTop?: number; marginBottom?: number;
  border?: string; borderRadius?: number | string; opacity?: number;
}

export type StyleRef = string | string[] | Style;

export type Link = string | { type: LinkType; target: string };

export interface FontResource { family: string; src: "embedded" | "file" | "system"; data?: string; path?: string; weight?: string; style?: string; }
export interface ImageResource { src?: "embedded" | "file"; mimeType?: string; data?: string; path?: string; }
/** A binary asset: embedded base64 (`data`) or a file path. Same shape for images and videos. */
export type VideoResource = ImageResource;
export type Resources = {
  fonts?: FontResource[];
  images?: Record<string, ImageResource>;
  /** Video assets (`video/mp4`, `video/webm`). In a `.jdfx` they live under `assets/` like images. */
  videos?: Record<string, VideoResource>;
} & Record<string, ImageResource | Record<string, ImageResource> | FontResource[] | undefined>;

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

/** One recognised text block of an image (OCR). `bbox` is in fractions of the image (0–1). */
export interface OcrBlock { text: string; bbox?: { x: number; y: number; w: number; h: number }; confidence?: number; }
/**
 * Text recovered from an image — the image-side twin of VideoTranscript. Lives
 * in document.json (text, not an asset). `jdf describe` writes it; `jdf chunk`
 * indexes it; reader search finds it. Without it a scanned page or a chart is
 * invisible to RAG, which is exactly what `jdf rag` reports as "media without text".
 */
export interface ImageOcr { language?: string; source?: string; created?: string; blocks: OcrBlock[]; }

export interface ImageElement {
  type: "image";
  /** Stable id — `jdf chunk` media references and `jdf describe --element` use it. */
  id?: string;
  resource?: string;
  src?: string;
  alt?: string;
  /** One-paragraph description of what the image shows (vision model or human). Indexed by RAG. */
  caption?: string;
  /** Where the caption came from: "ollama:moondream", "openai:gpt-4o", "manual", … */
  captionSource?: string;
  /** Recognised text (OCR) — see ImageOcr. */
  ocr?: ImageOcr;
  position?: Position;
  width?: number;
  height?: number;
  fit?: ImageFit;
  link?: Link;
  style?: StyleRef;
}

/**
 * Video — plays inline in jdf.js and the desktop reader (HTML5 `<video>`).
 * Source is either a bundled asset (`resource` → `resources.videos[id]`, which a
 * `.jdfx` stores under `assets/`) or a `src` URL / data URL. PDF export draws a
 * poster-style placeholder with the title, since PDF cannot play video.
 */
/** One spoken/captioned span of a video, in seconds from the start. */
export interface TranscriptSegment { t0: number; t1: number; text: string; speaker?: string; }
/**
 * Time-stamped text for a video — the part of a video RAG can actually use.
 * Lives in document.json (it is text, not an asset), so a `.jdf` with a hosted
 * `src` stays a single JSON file. `jdf chunk` turns segments into time-windowed
 * chunks carrying `media: { element, t0, t1 }`; renderers expose it as captions.
 */
export interface VideoTranscript {
  /** BCP-47 language tag, e.g. "en", "tr". */
  language?: string;
  /** Where the text came from: "whisper-large-v3", "srt-import", "manual", … */
  source?: string;
  /** When it was produced (ISO 8601). */
  created?: string;
  segments: TranscriptSegment[];
}
/** Named point in a video; becomes a breadcrumb level for the chunks under it. */
export interface VideoChapter { t: number; title: string; }

export interface VideoElement {
  type: "video";
  /** Stable id — retrieval results point back to `media.element`; needed for `viewer.seek(id, t)`. */
  id?: string;
  resource?: string;
  src?: string;
  /** Time-stamped text; see VideoTranscript. */
  transcript?: VideoTranscript;
  /** Chapter markers; chunk breadcrumbs read "… > Video title > Chapter". */
  chapters?: VideoChapter[];
  /** Still frame shown before playback: URL, data URL, or an image resource id. */
  poster?: string;
  /** Caption / accessible name. Also what `jdf chunk` and search index. */
  title?: string;
  position?: Position;
  width?: number;
  height?: number;
  fit?: ImageFit;
  /** Show the browser's playback controls (default true). */
  controls?: boolean;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  style?: StyleRef;
}

export type TableCellValue = string | { content: string; style?: StyleRef; align?: TextAlign; colspan?: number; rowspan?: number };

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
  | VideoElement
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
  /** Document-level default for flow layout. When true, PDF export lays
   *  elements out top-to-bottom and auto-paginates overflow. Per-page
   *  `flow` overrides this. */
  flow?: boolean;
}

/** A single retrieval chunk — see `jdf chunk`. Data-only; renderers ignore it. */
export interface ChunkRecord {
  id: string;
  text: string;
  path: string[];
  page: number;
  types: string[];
  tokens: number;
  hash: string;
}

/**
 * Precomputed RAG index. Optional, derived, cacheable — produced by
 * `jdf chunk --format inline`. Renderers ignore it entirely; a pipeline reads
 * `index.chunks` instead of recomputing chunk boundaries. Deleting it never
 * affects rendering or validity.
 */
export interface DocumentIndex {
  chunker: string;
  chunks: ChunkRecord[];
}

export interface JdfDocument {
  $jdf: string;
  meta: Meta;
  styles?: Record<string, Style>;
  resources?: Resources;
  header?: HeaderFooter;
  footer?: HeaderFooter;
  pages: Page[];
  /** Optional precomputed RAG chunk index (see `jdf chunk`). Data-only. */
  index?: DocumentIndex;
}
