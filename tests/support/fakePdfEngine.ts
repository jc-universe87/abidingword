import type { PdfDocument, PdfEngine, PdfPageSize } from "@/lib/pdfEngine";
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
  /** Makes reading the outline fail. */
  failOutline: boolean;
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
    outlineReads: [],
    async outline(_api, sourceId) {
      engine.outlineReads.push(sourceId);
      if (engine.failOutline) throw new Error("synthetic: the outline could not be read");
      return engine.outlineItems;
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
