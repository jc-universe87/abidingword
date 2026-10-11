import { PdfOutlineError, type PdfDocument, type PdfEngine, type PdfLink, type PdfPageSize, type PdfPlace, type PdfTextLayer } from "@/lib/pdfEngine";
import { buildPageText, rangeParts, type PageTextItem } from "@/lib/pdfPageText";
import type { ContentsItem } from "@/types/library";

export interface FakePdfEngine extends PdfEngine {
  /** Source ids opened, in order. */
  opened: string[];
  /** Pages drawn at least once. */
  rendered: Set<number>;
  /** Pages released after being drawn. */
  released: number[];
  destroyed: number;
  /** Makes the next opens fail (as an unreadable PDF would). */
  failOpen: boolean;
  /** Makes drawing fail. */
  failRender: boolean;
  /** The outline the PDF "carries" (none by default). */
  outlineItems: ContentsItem[];
  /** What an open document reports as its outline, if that should differ from `outlineItems`. */
  docOutlineItems?: ContentsItem[];
  /** A different outline per source (overrides `outlineItems` for the sources it names). */
  outlineBySource?: Record<string, ContentsItem[]>;
  /** Makes reading the outline fail. */
  failOutline: boolean;
  /** Makes the next N outline reads fail, then lets them succeed (a transient failure). */
  outlineFailures: number;
  /** Milliseconds the standalone outline read takes (a slow read). */
  outlineDelay: number;
  /** Source ids whose outline was read. */
  outlineReads: string[];
  /** Links on pages (1-based), as the PDF carries them: where they are and the destination they hold. */
  pageLinks: Record<number, PdfLink[]>;
  /** What each destination resolves to (a destination missing here leads nowhere). */
  destinations: Record<string, PdfPlace>;
  /** Destinations looked up, in order. */
  resolved: string[];
  /**
   * The text items drawn on pages (1-based), as PDF.js would report them. A page
   * missing here has no page-text map (its text could not be read); an empty list is a page without text.
   */
  pageTexts: Record<number, PageTextItem[]>;
  /** Pages whose text layer was drawn, in order. */
  textReads: number[];
}

/** A text item for `pageTexts`: upright, left to right, in the body of the page unless told otherwise. */
export const textItem = (str: string, more: Partial<PageTextItem> = {}): PageTextItem => ({ str, hasEOL: true, dir: "ltr", upright: true, top: 0.3, ...more });

/** A synthetic PDF renderer for tests: `pages` pages of `size`, no canvas needed. */
export function createFakePdfEngine({ pages = 5, size = { width: 600, height: 800 }, outline = [] }: { pages?: number; size?: PdfPageSize; outline?: ContentsItem[] } = {}): FakePdfEngine {
  const engine: FakePdfEngine = {
    opened: [],
    rendered: new Set(),
    released: [],
    destroyed: 0,
    failOpen: false,
    failRender: false,
    outlineItems: outline,
    failOutline: false,
    outlineFailures: 0,
    outlineDelay: 0,
    outlineReads: [],
    pageLinks: {},
    destinations: {},
    resolved: [],
    pageTexts: {},
    textReads: [],
    async outline(_api, sourceId) {
      engine.outlineReads.push(sourceId);
      if (engine.outlineDelay) await new Promise((resolve) => setTimeout(resolve, engine.outlineDelay));
      if (engine.failOutline || engine.outlineFailures-- > 0) throw new PdfOutlineError("read", "synthetic: the outline could not be read");
      return engine.outlineBySource?.[sourceId] ?? engine.outlineItems;
    },
    async open(_api, sourceId) {
      engine.opened.push(sourceId);
      if (engine.failOpen) throw new Error("synthetic: the PDF could not be read");
      const doc: PdfDocument = {
        numPages: pages,
        pageSize: async () => size,
        render(page) {
          engine.rendered.add(page);
          return { promise: engine.failRender ? Promise.reject(new Error("synthetic render failure")) : Promise.resolve(), cancel: () => undefined };
        },
        // The page-text map, with boxes laid out on a simple grid: item i on row i, one hundredth of the width per character.
        text: async (page): Promise<PdfTextLayer | null> => {
          engine.textReads.push(page);
          const items = engine.pageTexts[page];
          if (!items) return null;
          const map = buildPageText(items);
          return {
            ...map,
            boxes: (start, end) => (rangeParts(map, start, end) ?? []).map((p) => ({ x: p.from / 100, y: 0.1 + p.item * 0.05, width: (p.to - p.from) / 100, height: 0.03 })),
          };
        },
        // The open document's own outline: independent of the standalone read, which may fail.
        outline: async () => engine.docOutlineItems ?? engine.outlineBySource?.[sourceId] ?? engine.outlineItems,
        links: async (page) => engine.pageLinks[page] ?? [],
        resolve: async (dest) => {
          const key = String(dest);
          engine.resolved.push(key);
          return engine.destinations[key] ?? null;
        },
        release: (page) => {
          engine.released.push(page);
        },
        destroy: async () => {
          engine.destroyed += 1;
        },
      };
      return doc;
    },
  };
  return engine;
}

/**
 * Installs an IntersectionObserver whose notion of "visible" the test
 * controls: only elements for which `isVisible` is true intersect. Returns a
 * function that restores the previous global.
 */
export function installIntersectionObserver(isVisible: (el: Element) => boolean): () => void {
  const previous = globalThis.IntersectionObserver;
  class Fake {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(el: Element) {
      const entry = { isIntersecting: isVisible(el), target: el } as IntersectionObserverEntry;
      queueMicrotask(() => this.callback([entry], this as unknown as IntersectionObserver));
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  globalThis.IntersectionObserver = Fake as unknown as typeof IntersectionObserver;
  return () => {
    globalThis.IntersectionObserver = previous;
  };
}
