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

export interface PdfDocument {
  numPages: number;
  pageSize(page: number): Promise<PdfPageSize>;
  /** Draws a page onto `canvas` at `scale` CSS pixels per PDF point. */
  render(page: number, canvas: HTMLCanvasElement, scale: number): PdfRender;
  /** Adds a selectable text layer over a page. Best effort: never throws. */
  text(page: number, container: HTMLElement, scale: number): Promise<void>;
  /** Frees what was kept for a page that is no longer near the screen. */
  release(page: number): void;
  destroy(): Promise<void>;
}

export interface PdfEngine {
  /** Opens a source's original PDF. Reads only the byte ranges it needs. */
  open(api: Api, sourceId: string): Promise<PdfDocument>;
}
