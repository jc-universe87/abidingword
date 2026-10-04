import { describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { resolveDestination, type OutlineSource } from "@/lib/pdfjsEngine";

// Where a link's destination is, found with the PDF's own data. A stand-in for a
// PDF.js document: page objects are {num} references, three pages.

const doc: OutlineSource = {
  numPages: 3,
  getDestination: async (name) => {
    if (name === "chap2") return [{ num: 12, gen: 0 }, { name: "XYZ" }, 0, 700, null];
    if (name === "fit-h") return [{ num: 11, gen: 0 }, { name: "FitH" }, 400];
    if (name === "throws") throw new Error("lookup failed");
    return null;
  },
  getPageIndex: async (ref) => {
    const n = (ref as { num: number }).num;
    const pages: Record<number, number> = { 10: 0, 11: 1, 12: 2 };
    if (!(n in pages)) throw new Error("unknown page");
    return pages[n]!;
  },
};

describe("resolving a link's destination", () => {
  it("resolves a named destination, with where on the page it points", async () => {
    expect(await resolveDestination(doc, "chap2")).toEqual({ index: 2, top: 700 });
  });

  it("resolves an explicit destination, with and without a position on the page", async () => {
    expect(await resolveDestination(doc, [{ num: 11, gen: 0 }, { name: "Fit" }])).toEqual({ index: 1, top: null });
    expect(await resolveDestination(doc, "fit-h")).toEqual({ index: 1, top: 400 });
    expect(await resolveDestination(doc, [{ num: 10 }, { name: "XYZ" }, 0, null, null])).toEqual({ index: 0, top: null });
  });

  it("accepts a page index, and refuses anything outside the document", async () => {
    expect(await resolveDestination(doc, [2, { name: "Fit" }])).toEqual({ index: 2, top: null });
    for (const bad of [[3], [-1], [1.5], [{ num: 999 }], "missing", "throws", [], null, undefined, 7, { not: "a destination" }, [{ nope: 1 }]]) {
      expect(await resolveDestination(doc, bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

// The engine's own use of it: link areas converted with the page's viewport, and following them.
const page = vi.hoisted(() => ({
  annotations: [] as unknown[],
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  class PDFDataRangeTransport {
    delivered: (() => void) | null = null;
    constructor(
      public length: number,
      public initial: Uint8Array,
    ) {}
    onDataRange() {
      this.delivered?.();
    }
    requestDataRange(_begin: number, _end: number) {}
    abort() {}
  }
  // A 600 x 800 page whose view is flipped, as in PDF: user space has its origin at the bottom left.
  const viewport = { width: 600, height: 800, convertToViewportPoint: (x: number, y: number) => [x, 800 - y] };
  const pageObject = { view: [0, 0, 600, 800], getViewport: () => viewport, getAnnotations: async () => page.annotations, cleanup: () => undefined };
  const stub = {
    numPages: 3,
    getPage: async () => pageObject,
    getOutline: async () => [],
    getDestination: async (name: string) => (name === "named" ? [{ num: 2 }, { name: "XYZ" }, 0, 600, null] : null),
    getPageIndex: async (ref: { num: number }) => ref.num,
  };
  return {
    GlobalWorkerOptions: {},
    PDFDataRangeTransport,
    getDocument: (params: { range: InstanceType<typeof PDFDataRangeTransport> }) => ({
      promise: new Promise((resolve) => {
        params.range.delivered = () => resolve(stub);
        params.range.requestDataRange(0, 10);
      }),
      destroy: async () => undefined,
    }),
  };
});
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
vi.mock("pdfjs-dist/web/pdf_viewer.css", () => ({}));

const { createPdfJsEngine } = await import("@/lib/pdfjsEngine");

const api = {
  libraryOriginalInfo: async () => ({ kind: "pdf", sizeBytes: 1000 }),
  libraryOriginalRead: async () => new Uint8Array(10),
} as unknown as Api;

describe("a PDF page's links", () => {
  it("gives only links that point inside the document, as areas of the page at 100% from its top left", async () => {
    page.annotations = [
      { subtype: "Link", rect: [60, 700, 180, 720], dest: "named" }, // 120 x 20, 80 down from the top
      { subtype: "Link", rect: [180, 720, 60, 700], dest: [{ num: 1 }, { name: "Fit" }] }, // corners in the other order
      { subtype: "Link", rect: [0, 0, 10, 10], url: "https://example.org" }, // a web link: not followed here
      { subtype: "Link", rect: [0, 0, 10, 10], unsafeUrl: "javascript:alert(1)", dest: "named" },
      { subtype: "Link", rect: [0, 0, 10, 10], action: "NextPage" }, // another kind of action
      { subtype: "Link", rect: [5, 5, 5, 5], dest: "named" }, // no area
      { subtype: "Highlight", rect: [0, 0, 10, 10], dest: "named" },
      { subtype: "Link", dest: "named" },
    ];
    const doc = await createPdfJsEngine().open(api, "s1");
    const found = await doc.links(1);
    expect(found).toEqual([
      { x: 60, y: 80, width: 120, height: 20, dest: "named" },
      { x: 60, y: 80, width: 120, height: 20, dest: [{ num: 1 }, { name: "Fit" }] },
    ]);
  });

  it("follows a link to a page and how far down it, and a link to nowhere to nothing", async () => {
    const doc = await createPdfJsEngine().open(api, "s2");
    expect(await doc.resolve("named")).toEqual({ page: 3, fraction: 0.25 }); // 600 up from the bottom of an 800-point page: a quarter of the way down
    expect(await doc.resolve("absent")).toBeNull();
    expect(await doc.resolve([{ num: 99 }])).toBeNull();
  });

  it("never throws for a page it cannot read", async () => {
    page.annotations = null as unknown as unknown[];
    const doc = await createPdfJsEngine().open(api, "s3");
    expect(await doc.links(1)).toEqual([]);
  });
});
