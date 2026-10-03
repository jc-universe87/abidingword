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

export function createPdfJsEngine(): PdfEngine {
  return {
    async open(api: Api, sourceId: string): Promise<PdfDocument> {
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
      return wrap(pdfjs, doc, () => task.destroy());
    },
  };
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
