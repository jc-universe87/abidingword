import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { PdfOutlineError } from "@/lib/pdfEngine";

// A stand-in for PDF.js that behaves the way the real one does where it
// matters here: loading finishes only once the byte ranges it asked for have
// been delivered, and it has no way to be told that one could not be.
const behaviour = vi.hoisted(() => ({
  stall: false,
  outline: [] as unknown[],
  outlineError: null as Error | null,
  destroyed: 0,
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
  const doc = {
    numPages: 3,
    getOutline: async () => {
      if (behaviour.outlineError) throw behaviour.outlineError;
      return behaviour.outline;
    },
    getDestination: async () => null,
    getPageIndex: async (ref: { num: number }) => ref.num,
  };
  return {
    GlobalWorkerOptions: {},
    PDFDataRangeTransport,
    getDocument: (params: { range: InstanceType<typeof PDFDataRangeTransport> }) => {
      const transport = params.range;
      const promise = new Promise((resolve) => {
        if (behaviour.stall) return; // never finishes
        transport.delivered = () => resolve(doc);
        transport.requestDataRange(0, 10); // it needs a range first
      });
      return {
        promise,
        destroy: async () => {
          behaviour.destroyed += 1;
        },
      };
    },
  };
});
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
vi.mock("pdfjs-dist/web/pdf_viewer.css", () => ({}));

const { createPdfJsEngine } = await import("@/lib/pdfjsEngine");

function apiWith(read: (n: number) => Promise<Uint8Array>) {
  let reads = 0;
  const api = {
    libraryOriginalInfo: async () => ({ kind: "pdf", sizeBytes: 1000 }),
    libraryOriginalRead: async () => read(++reads),
  } as unknown as Api;
  return { api, reads: () => reads };
}

const bytes = new Uint8Array(10);
const OUTLINE = [{ title: "Chapter", dest: [{ num: 1 }], items: [] }];

beforeEach(() => {
  behaviour.stall = false;
  behaviour.outline = OUTLINE;
  behaviour.outlineError = null;
  behaviour.destroyed = 0;
});
afterEach(() => vi.useRealTimers());

describe("reading a PDF's outline never hangs and never mistakes failing for 'none'", () => {
  it("reads it when all goes well", async () => {
    const { api } = apiWith(async () => bytes);
    const items = await createPdfJsEngine().outline(api, "s1");
    expect(items.map((i) => i.title)).toEqual(["Chapter"]);
    expect(behaviour.destroyed).toBe(1); // the second opening is always closed again
  });

  it("a slice of the file that fails once is read again, and the outline still arrives", async () => {
    const { api, reads } = apiWith(async (n) => {
      if (n === 2) throw new Error("busy"); // the first read after the initial one
      return bytes;
    });
    const items = await createPdfJsEngine().outline(api, "s1");
    expect(items).toHaveLength(1);
    expect(reads()).toBeGreaterThanOrEqual(3);
  });

  it("a slice that keeps failing rejects with where it went wrong, instead of waiting for ever", async () => {
    vi.useFakeTimers();
    const { api } = apiWith(async (n) => {
      if (n >= 2) throw new Error("access denied");
      return bytes;
    });
    const result = createPdfJsEngine()
      .outline(api, "s1")
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2000); // the retries' pauses
    const error = (await result) as PdfOutlineError;
    expect(error).toBeInstanceOf(PdfOutlineError);
    expect(error.stage).toBe("read");
    expect(error.message).toMatch(/access denied/);
    expect(behaviour.destroyed).toBe(1);
  });

  it("a load that stalls with no error is failed after a while, and cancelled", async () => {
    vi.useFakeTimers();
    behaviour.stall = true;
    const { api } = apiWith(async () => bytes);
    const result = createPdfJsEngine()
      .outline(api, "s1")
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(26_000);
    const error = (await result) as PdfOutlineError;
    expect(error).toBeInstanceOf(PdfOutlineError);
    expect(error.stage).toBe("open");
    expect(error.message).toMatch(/stalled/);
    expect(behaviour.destroyed).toBe(1); // the hung loading is torn down, not left running
  });

  it("an outline that cannot be read fails at the 'outline' stage", async () => {
    behaviour.outlineError = new Error("bad object");
    const { api } = apiWith(async () => bytes);
    await expect(createPdfJsEngine().outline(api, "s1")).rejects.toMatchObject({ stage: "outline" });
  });

  it("no outline at all is a valid, empty answer", async () => {
    behaviour.outline = [];
    const { api } = apiWith(async () => bytes);
    expect(await createPdfJsEngine().outline(api, "s1")).toEqual([]);
  });

  it("an outline whose every destination fails to resolve is a failure (resolve), not an empty outline", async () => {
    behaviour.outline = [{ title: "A", dest: [{ num: 99 }] }, { title: "B", dest: "gone" }];
    const { api } = apiWith(async () => bytes);
    await expect(createPdfJsEngine().outline(api, "s1")).rejects.toMatchObject({ stage: "resolve" });
  });

  it("an outline of web links only is simply empty (nothing was meant to be looked up)", async () => {
    behaviour.outline = [{ title: "Site", url: "https://example.org" }];
    const { api } = apiWith(async () => bytes);
    expect(await createPdfJsEngine().outline(api, "s1")).toEqual([]);
  });

  it("an open document reports its own outline without being opened a second time", async () => {
    const { api } = apiWith(async () => bytes);
    const doc = await createPdfJsEngine().open(api, "s1");
    expect((await doc.outline()).map((i) => i.title)).toEqual(["Chapter"]);
  });

  it("opening a document fails (rather than waiting for ever) when a range of the file cannot be read", async () => {
    vi.useFakeTimers();
    const { api } = apiWith(async (n) => {
      if (n >= 2) throw new Error("gone");
      return bytes;
    });
    const result = createPdfJsEngine()
      .open(api, "s1")
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBeInstanceOf(PdfOutlineError);
  });
});
