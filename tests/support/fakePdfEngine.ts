import { PdfOutlineError, type PdfDocument, type PdfEngine, type PdfPageSize } from "@/lib/pdfEngine";
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
}

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
        text: async () => undefined,
        // The open document's own outline: independent of the standalone read, which may fail.
        outline: async () => engine.docOutlineItems ?? engine.outlineBySource?.[sourceId] ?? engine.outlineItems,
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
