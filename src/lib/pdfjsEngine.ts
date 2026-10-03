import type { ContentsItem } from "@/types/library";
import type { Api } from "./api";
import type { PdfDocument, PdfEngine, PdfPageSize, PdfRender } from "./pdfEngine";

/**
 * The PDF.js implementation of the viewer's engine.
 *
 * - Everything is bundled: the library and its worker are loaded from the
 *   app's own files, nothing from the network. It is PDF.js's `legacy`
 *   build: the standard build needs very recent JavaScript features
 *   (checked: it fails on a current Chromium without them), and the app
 *   runs in whatever web view the system has (WebView2, WebKitGTK).
 * - The file is never given to the web view whole. PDF.js asks for byte
 *   ranges (`PDFDataRangeTransport`) and each one is read by the core
 *   through `libraryOriginalRead`, by source id, a megabyte at most at a time.
 *   Auto-fetch and streaming are off, so a 200 MB book loads only the parts
 *   of the file that the pages on screen need.
 * - WebAssembly is off, and the CMap/standard-font/WASM data files are not
 *   bundled: the app's content-security policy has no `connect-src` for
 *   them, and it is not widened for this. The few PDFs that need them
 *   (JPEG 2000 images, some non-embedded CJK fonts) show those parts
 *   approximately; see docs/formatted-source-viewer.md.
 */

const INITIAL_BYTES = 64 * 1024;
const READ_SLICE = 1024 * 1024;

/** The PDF.js module, loaded on first use (and never in tests of other parts). */
async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
    import("pdfjs-dist/web/pdf_viewer.css"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

type PdfJs = Awaited<ReturnType<typeof loadPdfJs>>;

async function openRaw(api: Api, sourceId: string) {
  {
    {
      const pdfjs = await loadPdfJs();
      const info = await api.libraryOriginalInfo(sourceId);
      const first = await api.libraryOriginalRead(sourceId, 0, Math.min(INITIAL_BYTES, info.sizeBytes));

      class CoreRange extends pdfjs.PDFDataRangeTransport {
        private stopped = false;

        override requestDataRange(begin: number, end: number) {
          void (async () => {
            try {
              for (let at = begin; at < end && !this.stopped; at += READ_SLICE) {
                const chunk = await api.libraryOriginalRead(sourceId, at, Math.min(READ_SLICE, end - at));
                if (this.stopped) return;
                this.onDataRange(at, chunk);
              }
            } catch {
              // The document's own loading reports the failure.
              this.stopped = true;
            }
          })();
        }

        override abort() {
          this.stopped = true;
        }
      }

      const transport = new CoreRange(info.sizeBytes, first);
      const task = pdfjs.getDocument({
        range: transport,
        disableAutoFetch: true,
        disableStream: true,
        useWasm: false,
        enableXfa: false,
      });
      const doc = await task.promise;
      return { pdfjs, doc, destroy: () => task.destroy() };
    }
  }
}

export function createPdfJsEngine(): PdfEngine {
  return {
    async open(api: Api, sourceId: string): Promise<PdfDocument> {
      const { pdfjs, doc, destroy } = await openRaw(api, sourceId);
      return wrap(pdfjs, doc, destroy);
    },
    async outline(api: Api, sourceId: string): Promise<ContentsItem[]> {
      const { doc, destroy } = await openRaw(api, sourceId);
      try {
        return await resolveOutline(doc, (await doc.getOutline()) ?? []);
      } finally {
        void destroy();
      }
    },
  };
}

/** What outline resolution needs from a PDF.js document (so it can be tested without one). */
export interface OutlineSource {
  numPages: number;
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(ref: never): Promise<number>;
}

const MAX_OUTLINE_ITEMS = 5000;
const MAX_OUTLINE_DEPTH = 12;
const MAX_TITLE = 300;

/**
 * Turns PDF.js's outline into the app's contents tree. A destination is a
 * name (looked up in the document's name tree) or an explicit array whose
 * first element is a reference to the page object (or, in some producers, a
 * plain page index); either way it is resolved to a physical page number
 * with PDF.js itself, never assumed to hold one. Entries that lead nowhere
 * inside the document (a web link, a broken or out-of-range destination)
 * keep no target; those left with neither a target nor children are dropped.
 * Malformed entries are skipped, never fatal.
 */
export async function resolveOutline(doc: OutlineSource, raw: unknown): Promise<ContentsItem[]> {
  const cache = new Map<string, number | null>();
  let count = 0;

  const pageOf = async (dest: unknown): Promise<number | null> => {
    try {
      const target = typeof dest === "string" ? await doc.getDestination(dest) : dest;
      if (!Array.isArray(target) || target.length === 0) return null;
      const head: unknown = target[0];
      let index: number;
      if (typeof head === "number") {
        index = head;
      } else if (head && typeof head === "object" && "num" in head) {
        const ref = head as { num: number; gen?: number };
        const key = `${ref.num}:${ref.gen ?? 0}`;
        if (!cache.has(key)) cache.set(key, await doc.getPageIndex(ref as never).catch(() => -1));
        index = cache.get(key) ?? -1;
      } else {
        return null;
      }
      return Number.isInteger(index) && index >= 0 && index < doc.numPages ? index + 1 : null;
    } catch {
      return null;
    }
  };

  const walk = async (entries: unknown, depth: number): Promise<ContentsItem[]> => {
    const out: ContentsItem[] = [];
    if (!Array.isArray(entries)) return out;
    for (const entry of entries) {
      if (count >= MAX_OUTLINE_ITEMS) break;
      if (!entry || typeof entry !== "object") continue;
      const item = entry as { title?: unknown; dest?: unknown; items?: unknown };
      const title = typeof item.title === "string" ? item.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) : "";
      const id = `p${count}`;
      if (title) count += 1;
      const children = depth + 1 < MAX_OUTLINE_DEPTH ? await walk(item.items, depth + 1) : [];
      if (!title) {
        out.push(...children); // an untitled wrapper: its children still count
        continue;
      }
      const page = item.dest === undefined || item.dest === null ? null : await pageOf(item.dest);
      if (page === null && children.length === 0) continue;
      out.push({ id, title, target: page === null ? null : { kind: "page", page }, children });
    }
    return out;
  };

  return walk(raw, 0);
}

function wrap(
  pdfjs: PdfJs,
  doc: Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>,
  destroy: () => Promise<void>,
): PdfDocument {
  const pages = new Map<number, Promise<Awaited<ReturnType<typeof doc.getPage>>>>();
  const page = (n: number) => {
    let p = pages.get(n);
    if (!p) {
      p = doc.getPage(n);
      pages.set(n, p);
    }
    return p;
  };
  return {
    numPages: doc.numPages,
    async pageSize(n): Promise<PdfPageSize> {
      const { width, height } = (await page(n)).getViewport({ scale: 1 });
      return { width, height };
    },
    render(n, canvas, scale): PdfRender {
      let cancel = () => undefined as void;
      const promise = (async () => {
        const p = await page(n);
        const ratio = window.devicePixelRatio || 1;
        const viewport = p.getViewport({ scale: scale * ratio });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
        const task = p.render({ canvas, viewport });
        cancel = () => task.cancel();
        try {
          await task.promise;
        } catch (error) {
          // A cancelled render (the page scrolled away or zoom changed) is not a failure.
          if ((error as { name?: string })?.name !== "RenderingCancelledException") throw error;
        }
      })();
      return { promise, cancel: () => cancel() };
    },
    async text(n, container, scale) {
      try {
        const p = await page(n);
        container.replaceChildren();
        container.style.setProperty("--total-scale-factor", String(scale));
        const layer = new pdfjs.TextLayer({
          textContentSource: p.streamTextContent(),
          container,
          viewport: p.getViewport({ scale }),
        });
        await layer.render();
      } catch {
        // Selectable text is a convenience; the page itself is already drawn.
      }
    },
    release(n) {
      const p = pages.get(n);
      pages.delete(n);
      void p?.then((loaded) => loaded.cleanup());
    },
    destroy,
  };
}
