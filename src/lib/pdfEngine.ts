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

export interface PdfDocument {
  numPages: number;
  pageSize(page: number): Promise<PdfPageSize>;
  /** Draws a page onto `canvas` at `scale` CSS pixels per PDF point. */
  render(page: number, canvas: HTMLCanvasElement, scale: number): PdfRender;
  /** Adds a selectable text layer over a page. Best effort: never throws. */
  text(page: number, container: HTMLElement, scale: number): Promise<void>;
  /**
   * The outline of this already open document, so the viewer never needs a
   * second opening just to learn it. Empty when the PDF has none; throws a
   * [`PdfOutlineError`] when it could not be read.
   */
  outline(): Promise<ContentsItem[]>;
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
