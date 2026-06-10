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
  textDecoration?: "none" | "underline" | "strikethrough" | "underline strikethrough";
  color?: string; backgroundColor?: string; textAlign?: TextAlign; lineHeight?: number;
  letterSpacing?: number; padding?: number | Margins; marginTop?: number; marginBottom?: number;
  borderRadius?: number; opacity?: number;
}

export type StyleRef = string | string[] | Style;
export interface Link { type: LinkType; target: string; }
export interface FontResource { family: string; src: "embedded" | "file" | "system"; data?: string; path?: string; weight?: string; style?: string; }
export interface ImageResource { src: "embedded" | "file"; mimeType?: string; data?: string; path?: string; }
export interface Resources { fonts?: FontResource[]; images?: Record<string, ImageResource>; }
export interface HeaderFooter { height: number; elements: Element[]; }

export interface TextElement { type: "text"; content: string; style?: StyleRef; position?: Position; width?: number; height?: number; align?: TextAlign; heading?: boolean; tocEntry?: string; link?: Link; }
export interface RichTextRun { text: string; style?: StyleRef; link?: Link; }
export interface RichTextElement { type: "richtext"; runs: RichTextRun[]; style?: StyleRef; position?: Position; width?: number; height?: number; }
export interface ImageElement { type: "image"; resource: string; position?: Position; width?: number; height?: number; fit?: ImageFit; link?: Link; }
export interface TableCell { content: string; style?: StyleRef; colspan?: number; rowspan?: number; }
export interface TableColumn { width?: string; header?: string; align?: TextAlign; }
export interface TableBorders { outer?: boolean; inner?: boolean; color?: string; width?: number; }
export interface TableElement { type: "table"; columns: TableColumn[]; rows: TableCell[][]; position?: Position; width?: number; headerStyle?: StyleRef; rowStyle?: StyleRef; alternateRowStyle?: StyleRef; borders?: TableBorders; style?: StyleRef; }
export interface ListItem { content: string; style?: StyleRef; children?: ListItem[]; listType?: ListType; }
export interface ListElement { type: "list"; items: ListItem[]; listType?: ListType; position?: Position; width?: number; style?: StyleRef; }
export interface ShapeStroke { color?: string; width?: number; }
export interface ShapeElement { type: "shape"; shape: ShapeType; position?: Position; width?: number; height?: number; fill?: string; stroke?: ShapeStroke; borderRadius?: number; path?: string; points?: Position[]; }
export interface CollapsibleElement { type: "collapsible"; title: string; elements: Element[]; expanded?: boolean; position?: Position; width?: number; style?: StyleRef; }
export interface TocElement { type: "toc"; position?: Position; width?: number; depth?: number; style?: StyleRef; }

export type Element = TextElement | RichTextElement | ImageElement | TableElement | ListElement | ShapeElement | CollapsibleElement | TocElement;

export interface Page { id?: string; pageSize?: PageSize; pageOrientation?: PageOrientation; margins?: Margins; background?: string; flow?: boolean; elements: Element[]; }
export interface Meta { title: string; author?: string; created?: string; modified?: string; language?: string; keywords?: string[]; pageSize?: PageSize; pageOrientation?: PageOrientation; margins?: Margins; unit?: Unit; }
export interface JdfDocument { $jdf: string; meta: Meta; styles?: Record<string, Style>; resources?: Resources; header?: HeaderFooter; footer?: HeaderFooter; pages: Page[]; }
