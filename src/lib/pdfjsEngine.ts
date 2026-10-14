import type { ContentsItem } from "@/types/library";
import type { Api } from "./api";
import { PdfOutlineError, type OutlineStage, type PdfBox, type PdfDocument, type PdfEngine, type PdfLink, type PdfPageSize, type PdfPlace, type PdfRender } from "./pdfEngine";
import { buildPageText, offsetInLayer, rangeParts, toPageTextItems } from "./pdfPageText";

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

/** A slice of the file that cannot be read is tried again this many times before the document fails. */
const RANGE_RETRIES = 2;
const RANGE_RETRY_MS = 150;
/** Reading an outline that has not finished in this long has stalled; it fails (and is tried again) instead of hanging. */
const OUTLINE_TIMEOUT_MS = 25_000;
/** Destinations are looked up this many at a time: each can need a read, and reads are what is slow. */
const RESOLVE_CONCURRENCY = 6;

interface OpenHooks {
  /** Where the opening has got to (for the outline's failure report). */
  stage?: (stage: OutlineStage) => void;
  /** Called with the way to cancel the loading, as soon as there is one (so a stalled load can be cancelled). */
  created?: (destroy: () => Promise<void>) => void;
  /** A slice of the file could not be read (after retries): PDF.js would wait for it forever. */
  fail?: (error: PdfOutlineError) => void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A promise that only ever rejects, with no unhandled-rejection noise if nobody is racing it. */
function failure() {
  let reject!: (error: unknown) => void;
  const promise = new Promise<never>((_, r) => {
    reject = r;
  });
  promise.catch(() => undefined);
  return { promise, reject };
}

async function openRaw(api: Api, sourceId: string, hooks: OpenHooks = {}) {
  const fail = (stage: OutlineStage, error: unknown): never => {
    throw error instanceof PdfOutlineError ? error : new PdfOutlineError(stage, messageOf(error));
  };
  const pdfjs = await loadPdfJs().catch((e) => fail("open", e));
  hooks.stage?.("info");
  const info = await api.libraryOriginalInfo(sourceId).catch((e) => fail("info", e));
  hooks.stage?.("read");
  const first = await api.libraryOriginalRead(sourceId, 0, Math.min(INITIAL_BYTES, info.sizeBytes)).catch((e) => fail("read", e));
  hooks.stage?.("open");

  class CoreRange extends pdfjs.PDFDataRangeTransport {
    private stopped = false;

    override requestDataRange(begin: number, end: number) {
      void (async () => {
        try {
          for (let at = begin; at < end && !this.stopped; at += READ_SLICE) {
            const chunk = await this.slice(at, Math.min(READ_SLICE, end - at));
            if (this.stopped) return;
            this.onDataRange(at, chunk);
          }
        } catch (error) {
          // PDF.js has no way to be told a range failed and would wait for it
          // for ever, so the opening is failed from outside.
          this.stopped = true;
          hooks.fail?.(new PdfOutlineError("read", `a range of the file could not be read: ${messageOf(error)}`));
        }
      })();
    }

    private async slice(at: number, length: number): Promise<Uint8Array> {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await api.libraryOriginalRead(sourceId, at, length);
        } catch (error) {
          if (attempt >= RANGE_RETRIES || this.stopped) throw error;
          await new Promise((resolve) => setTimeout(resolve, RANGE_RETRY_MS * (attempt + 1)));
        }
      }
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
  hooks.created?.(() => task.destroy());
  const doc = await task.promise.catch((e) => fail("open", e));
  return { pdfjs, doc, destroy: () => task.destroy() };
}

export function createPdfJsEngine(): PdfEngine {
  return {
    async open(api: Api, sourceId: string): Promise<PdfDocument> {
      const failed = failure();
      const { pdfjs, doc, destroy } = await Promise.race([openRaw(api, sourceId, { fail: failed.reject }), failed.promise]);
      return wrap(pdfjs, doc, destroy);
    },
    async outline(api: Api, sourceId: string): Promise<ContentsItem[]> {
      let stage: OutlineStage = "info";
      let cancel: (() => Promise<void>) | undefined;
      const failed = failure();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PdfOutlineError(stage, `stalled for ${OUTLINE_TIMEOUT_MS / 1000} s`)), OUTLINE_TIMEOUT_MS);
      });
      stalled.catch(() => undefined);
      const work = (async () => {
        const { doc } = await openRaw(api, sourceId, {
          stage: (s) => {
            stage = s;
          },
          created: (destroy) => {
            cancel = destroy;
          },
          fail: failed.reject,
        });
        return readOutline(doc, (s) => {
          stage = s;
        });
      })();
      work.catch(() => undefined);
      try {
        return await Promise.race([work, failed.promise, stalled]);
      } catch (error) {
        throw error instanceof PdfOutlineError ? error : new PdfOutlineError(stage, messageOf(error));
      } finally {
        clearTimeout(timer);
        void cancel?.().catch(() => undefined);
      }
    },
  };
}

/** The document's outline, resolved; empty if it has none; a [`PdfOutlineError`] if reading it failed. */
async function readOutline(doc: Awaited<ReturnType<typeof openRaw>>["doc"], setStage?: (stage: OutlineStage) => void): Promise<ContentsItem[]> {
  setStage?.("outline");
  let raw: unknown;
  try {
    raw = await doc.getOutline();
  } catch (error) {
    throw new PdfOutlineError("outline", messageOf(error));
  }
  if (!Array.isArray(raw) || raw.length === 0) return []; // a genuine "no outline"
  setStage?.("resolve");
  const { items, wanted } = await resolveOutlineCounted(doc, raw);
  // Entries that point inside the document, none of which could be resolved,
  // is a failure to look them up, not an outline without contents.
  if (items.length === 0 && wanted > 0) {
    throw new PdfOutlineError("resolve", `the outline has ${wanted} entries with destinations but none could be resolved`);
  }
  return items;
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

interface OutlineNode {
  id: string;
  title: string;
  dest: unknown;
  page: number | null;
  children: OutlineNode[];
}

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
  return (await resolveOutlineCounted(doc, raw)).items;
}

/**
 * Where a destination is: the page's index and, when the destination says so,
 * how far down it the target is (in PDF user space, measured up from the
 * bottom). A destination is a name (looked up in the document's name tree) or
 * an explicit array whose first element is a reference to the page object
 * (or, in some producers, a plain page index); either way it is resolved with
 * PDF.js itself, never assumed to hold a page number. Null for anything
 * unresolvable or out of range. Shared by the contents and by links.
 */
export async function resolveDestination(
  doc: OutlineSource,
  dest: unknown,
  indexOf?: (ref: { num: number; gen?: number }) => Promise<number>,
): Promise<{ index: number; top: number | null } | null> {
  try {
    const target = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(target) || target.length === 0) return null;
    const head: unknown = target[0];
    let index: number;
    if (typeof head === "number") {
      index = head;
    } else if (head && typeof head === "object" && "num" in head) {
      const ref = head as { num: number; gen?: number };
      index = indexOf ? await indexOf(ref) : await doc.getPageIndex(ref as never).catch(() => -1);
    } else {
      return null;
    }
    if (!(Number.isInteger(index) && index >= 0 && index < doc.numPages)) return null;
    const mode = (target[1] as { name?: string } | null | undefined)?.name;
    const raw = mode === "XYZ" ? target[3] : mode === "FitH" || mode === "FitBH" ? target[2] : null;
    return { index, top: typeof raw === "number" && Number.isFinite(raw) ? raw : null };
  } catch {
    return null;
  }
}

/** As [`resolveOutline`], also counting the entries that had a destination to look up. */
export async function resolveOutlineCounted(doc: OutlineSource, raw: unknown): Promise<{ items: ContentsItem[]; wanted: number }> {
  const lookups = new Map<string, Promise<number>>();
  let count = 0;

  const indexOf = (ref: { num: number; gen?: number }): Promise<number> => {
    const key = `${ref.num}:${ref.gen ?? 0}`;
    let found = lookups.get(key);
    if (!found) {
      found = doc.getPageIndex(ref as never).catch(() => -1);
      lookups.set(key, found);
    }
    return found;
  };

  const pageOf = async (dest: unknown): Promise<number | null> => {
    const found = await resolveDestination(doc, dest, indexOf);
    return found ? found.index + 1 : null;
  };

  // First the shape, with no waiting; then the lookups, a few at a time.
  const build = (entries: unknown, depth: number): OutlineNode[] => {
    const out: OutlineNode[] = [];
    if (!Array.isArray(entries)) return out;
    for (const entry of entries) {
      if (count >= MAX_OUTLINE_ITEMS) break;
      if (!entry || typeof entry !== "object") continue;
      const item = entry as { title?: unknown; dest?: unknown; items?: unknown };
      const title = typeof item.title === "string" ? item.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) : "";
      const id = `p${count}`;
      if (title) count += 1;
      const children = depth + 1 < MAX_OUTLINE_DEPTH ? build(item.items, depth + 1) : [];
      if (!title) {
        out.push(...children); // an untitled wrapper: its children still count
        continue;
      }
      out.push({ id, title, dest: item.dest ?? null, page: null, children });
    }
    return out;
  };
  const nodes = build(raw, 0);

  const wantedNodes: OutlineNode[] = [];
  const collect = (list: OutlineNode[]) => {
    for (const node of list) {
      if (node.dest !== null) wantedNodes.push(node);
      collect(node.children);
    }
  };
  collect(nodes);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(RESOLVE_CONCURRENCY, wantedNodes.length) }, async () => {
      while (next < wantedNodes.length) {
        const node = wantedNodes[next++]!;
        node.page = await pageOf(node.dest);
      }
    }),
  );

  const prune = (list: OutlineNode[]): ContentsItem[] => {
    const out: ContentsItem[] = [];
    for (const node of list) {
      const children = prune(node.children);
      if (node.page === null && children.length === 0) continue;
      out.push({ id: node.id, title: node.title, target: node.page === null ? null : { kind: "page", page: node.page }, children });
    }
    return out;
  };
  return { items: prune(nodes), wanted: wantedNodes.length };
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
        // The page's text is read once and shared: the text layer draws it, and the page-text map is made from it.
        const content = await p.getTextContent();
        const viewport = p.getViewport({ scale });
        const layer = new pdfjs.TextLayer({ textContentSource: content, container, viewport });
        await layer.render();
        const items = toPageTextItems(content, p.getViewport({ scale: 1 }));
        const map = buildPageText(items);
        // PDF.js keeps one span per text item, in the same order (textDivs[i] draws items[i]).
        const spans = layer.textDivs as HTMLElement[];
        return {
          ...map,
          boxes(start, end) {
            const parts = rangeParts(map, start, end);
            if (!parts || spans.length !== map.starts.length) return [];
            const page = container.getBoundingClientRect();
            if (page.width <= 0 || page.height <= 0) return [];
            const out: PdfBox[] = [];
            for (const part of parts) {
              const node = spans[part.item]?.firstChild;
              if (!node || node.nodeType !== Node.TEXT_NODE) return [];
              const range = document.createRange();
              range.setStart(node, part.from);
              range.setEnd(node, Math.min(part.to, node.textContent?.length ?? 0));
              for (const r of range.getClientRects()) {
                if (r.width <= 0 || r.height <= 0) continue;
                out.push({ x: (r.left - page.left) / page.width, y: (r.top - page.top) / page.height, width: r.width / page.width, height: r.height / page.height });
              }
            }
            return out;
          },
          offsetOf: (node, offset) => (spans.length === map.starts.length ? offsetInLayer(container, spans, map, node, offset) : null),
        };
      } catch {
        // Selectable text is a convenience; the page itself is already drawn.
        return null;
      }
    },
    outline: () => readOutline(doc),
    async links(n): Promise<PdfLink[]> {
      try {
        const p = await page(n);
        const viewport = p.getViewport({ scale: 1 });
        const found: PdfLink[] = [];
        for (const a of (await p.getAnnotations({ intent: "display" })) as Array<{ subtype?: string; rect?: number[]; dest?: unknown; url?: unknown; unsafeUrl?: unknown }>) {
          // Only links that point into this document; a web link is not followed here.
          if (a.subtype !== "Link" || !a.rect || a.rect.length < 4 || a.dest == null || a.url || a.unsafeUrl) continue;
          const [left, bottom, right, top] = a.rect as [number, number, number, number];
          const [x1, y1] = viewport.convertToViewportPoint(left, bottom) as [number, number];
          const [x2, y2] = viewport.convertToViewportPoint(right, top) as [number, number];
          const width = Math.abs(x2 - x1);
          const height = Math.abs(y2 - y1);
          if (width > 0 && height > 0) found.push({ x: Math.min(x1, x2), y: Math.min(y1, y2), width, height, dest: a.dest });
        }
        return found;
      } catch {
        return [];
      }
    },
    async resolve(dest): Promise<PdfPlace | null> {
      const found = await resolveDestination(doc, dest);
      if (!found) return null;
      let fraction = 0;
      if (found.top !== null) {
        try {
          const view = (await page(found.index + 1)).view;
          const bottom = view[1] ?? 0;
          const top = view[3] ?? 0;
          fraction = top > bottom ? Math.min(1, Math.max(0, (top - found.top) / (top - bottom))) : 0;
        } catch {
          fraction = 0;
        }
      }
      return { page: found.index + 1, fraction };
    },
    release(n) {
      const p = pages.get(n);
      pages.delete(n);
      void p?.then((loaded) => loaded.cleanup());
    },
    destroy,
  };
}
