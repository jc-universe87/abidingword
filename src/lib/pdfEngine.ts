import type { ContentsItem } from "@/types/library";
import type { Api } from "./api";

/**
 * What the in-app PDF viewer needs from a PDF renderer. The viewer talks to
 * this, never to PDF.js directly, so it can be tested without a browser
 * canvas and the renderer can be replaced.
 */

/** A page's natural size in PDF points (1/72 inch), unscaled. */
export interface PdfPageSize {
  width: number;
  height: number;
}

export interface PdfRender {
  promise: Promise<void>;
  cancel(): void;
}

/** Where reading a PDF's outline went wrong (for the log; never shown). */
export type OutlineStage = "info" | "read" | "open" | "outline" | "resolve";

/**
 * Reading the outline failed. This is not "the PDF has no outline" (that is
 * an empty result): a failure may succeed on another try.
 */
export class PdfOutlineError extends Error {
  constructor(
    readonly stage: OutlineStage,
    message: string,
  ) {
    super(message);
    this.name = "PdfOutlineError";
  }
}

/** A place in a PDF: a physical page (1-based) and how far down it (0 = the top, 1 = the bottom). */
export interface PdfPlace {
  page: number;
  fraction: number;
}

/**
 * A link on a page that is meant to lead somewhere in the same document: its
 * area as a rectangle of the page at 100% (PDF points, rotation applied,
 * origin at the top left), and where it points, kept opaque and resolved only
 * when followed (see [`PdfDocument.resolve`]).
 */
export interface PdfLink {
  x: number;
  y: number;
  width: number;
  height: number;
  dest: unknown;
}

/** A box on a page, as shares of the page (0..1 from the top left), whatever the zoom. */
export interface PdfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A page's text as PDF.js draws it (v0.13): the second of a PDF's two
 * representations. The first, the normalised text imported into the library,
 * is what search, citations and segments use; this one exists only while the
 * page is on screen, and is what marks are placed with. The two are never
 * merged.
 */
export interface PdfPageText {
  /** The text items' strings in drawing order, with a line break after each item that ends a line. */
  text: string;
  /** Where each text item starts in `text` (UTF-16 offsets), by item index. */
  starts: number[];
  /** Each item's length in `text`. */
  lengths: number[];
  /**
   * Whether each item can carry a mark: upright, left-to-right text, away from
   * the page's top and bottom margins (running headers and footers). Vertical,
   * rotated and right-to-left items never do; their places are not guessed.
   */
  usable: boolean[];
  /** Whether the page has any text of its own (a scanned page has none). */
  hasText: boolean;
}

export interface PdfTextLayer extends PdfPageText {
  /**
   * The boxes covering `text[start, end)`, measured on the drawn text layer.
   * Empty when the range touches an item that cannot carry a mark, or covers no item.
   */
  boxes(start: number, end: number): PdfBox[];
}

export interface PdfDocument {
  numPages: number;
  pageSize(page: number): Promise<PdfPageSize>;
  /** Draws a page onto `canvas` at `scale` CSS pixels per PDF point. */
  render(page: number, canvas: HTMLCanvasElement, scale: number): PdfRender;
  /**
   * Adds a selectable text layer over a page, and gives back the page's text
   * map (v0.13): the page text as PDF.js draws it, and the way from a range of
   * it to boxes on the page. Null when the page's text could not be read.
   * Best effort: never throws.
   */
  text(page: number, container: HTMLElement, scale: number): Promise<PdfTextLayer | null>;
  /**
   * The outline of this already open document, so the viewer never needs a
   * second opening just to learn it. Empty when the PDF has none; throws a
   * [`PdfOutlineError`] when it could not be read.
   */
  outline(): Promise<ContentsItem[]>;
  /**
   * The links on a page that point inside this document (web links and other
   * actions are not among them). Best effort: never throws.
   */
  links(page: number): Promise<PdfLink[]>;
  /**
   * Where a link's destination is, found with the PDF's own destination
   * data (a name, an explicit destination or a page reference), never
   * guessed. Null when it leads nowhere inside the document. Never throws.
   */
  resolve(dest: unknown): Promise<PdfPlace | null>;
  /** Frees what was kept for a page that is no longer near the screen. */
  release(page: number): void;
  destroy(): Promise<void>;
}

export interface PdfEngine {
  /** Opens a source's original PDF. Reads only the byte ranges it needs. */
  open(api: Api, sourceId: string): Promise<PdfDocument>;
  /**
   * The outline (bookmarks) the PDF itself carries, nested, each entry
   * resolved to a physical page. Empty when it has none; never generated.
   * Reads the outline objects only, never the pages' content. An empty list
   * means the PDF has none; a read that fails throws a [`PdfOutlineError`]
   * (it never hangs: a stalled read times out).
   */
  outline(api: Api, sourceId: string): Promise<ContentsItem[]>;
}
