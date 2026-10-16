import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Maximize2, MoveHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { formatNumber } from "@/i18n/format";
import { useApi } from "@/lib/ApiContext";
import type { ContentsItem, SourceAnnotation } from "@/types/library";
import type { DetectedReference, ScriptureRef } from "@/types/scripture";
import type { PdfBox, PdfDocument, PdfLink, PdfPageSize, PdfPlace, PdfTextLayer } from "@/lib/pdfEngine";
import { findOnPage } from "@/lib/pdfPageText";
import { pageToStored, placeSegments, storedToPage, type PagePlacement, type PageSegment } from "@/lib/pdfTextMatch";
import { PHRASE_CLASS } from "@/lib/annotationRender";
import { MarksInspector, MarksMarker, type MarkActions } from "./annotations/ParagraphMarks";
import type { SourceSelection } from "./annotations/sourceSelection";
import { usePdfEngine } from "./PdfEngineContext";
import { ScriptureReference, type ScriptureReferenceClasses } from "./ScriptureReference";

/** 100% is a page at its natural size on a 96 dpi screen. */
const CSS_PER_POINT = 96 / 72;
const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
const FALLBACK_PAGE: PdfPageSize = { width: 612, height: 792 };
const GAP = 12;
const RESIZE_SETTLE_MS = 120;
const PADDING = 16;

type Zoom = { kind: "fit-width" } | { kind: "fit-page" } | { kind: "percent"; value: number };

interface PdfViewerProps {
  sourceId: string;
  /** Physical page to open at (1-based). */
  initialPage: number;
  /** Told whenever the page in view changes, so Reading can return to it. */
  onPageChange: (page: number) => void;
  /** The outline, read from this viewer's own open document (a second chance for Contents, with no second opening). */
  onOutline?: (items: ContentsItem[]) => void;
  /** Go to this page without reopening (zoom is kept). A new `nonce` is a new request. */
  jumpTo?: { page: number; nonce: number; fraction?: number } | null;
  /** A link in the document was followed and leads here (a page, and how far down it). */
  onLink?: (place: PdfPlace) => void;
  /** Filled with a way to ask where the view is now (page and how far down it), for the reader's history. */
  locationRef?: React.MutableRefObject<(() => PdfPlace) | null>;
  /** Scripture references on the pages become "Open in Bible" actions (v0.13); without it, none are looked for. */
  onOpenInBible?: (reference: ScriptureRef) => void;
  /**
   * The current "Find in this source" match, on its page: the query, and which of that page's
   * matches it is (`index` of `count`). Marked only if the page's own text has exactly `count`.
   */
  find?: PdfFind | null;
  /**
   * The source's marks (v0.14): drawn on the pages where their stored words can be placed exactly,
   * and listed by a page's marker. Without it, none are drawn.
   */
  marks?: SourceAnnotation[];
  /** A mark was changed or removed from a page's marks; gives the source's marks as they are now. */
  onMarksChanged?: () => Promise<SourceAnnotation[]>;
  /** "Add to Study" and "Copy quotation with citation" on a page's marks (v0.15). */
  markActions?: MarkActions;
  /** Filled with a way to turn a text selection on a page into an anchor in the stored text (or null). */
  selectionRef?: React.MutableRefObject<((selection: Selection) => SourceSelection | null) | null>;
}

/** A drawn page's text layer, with the stored paragraphs placed on it: how a selection there is read. */
interface PageLayer {
  element: HTMLElement;
  map: PdfTextLayer;
  placement: PagePlacement;
}

/** A find match to mark on a page of the original (see `PdfViewerProps.find`). */
export interface PdfFind {
  page: number;
  query: string;
  index: number;
  count: number;
}

/**
 * The original PDF, page by page, as the PDF itself lays it out. Only pages
 * near the screen are drawn (and released again when far away), so a long
 * book never fills memory with canvases. The page is always drawn on white,
 * whatever the app theme: the document is not recoloured. This is a place to
 * inspect the source; search, citations and Scripture links stay with the
 * extracted text.
 */
export function PdfViewer({ sourceId, initialPage, onPageChange, jumpTo, onOutline, onLink, locationRef, onOpenInBible, find, marks, onMarksChanged, markActions, selectionRef }: PdfViewerProps) {
  const { t } = useTranslation();
  const api = useApi();
  const engine = usePdfEngine();
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [failed, setFailed] = useState(false);
  const [sizes, setSizes] = useState<Record<number, PdfPageSize>>({});
  const [zoom, setZoom] = useState<Zoom>({ kind: "fit-width" });
  const [page, setPage] = useState(Math.max(1, initialPage));
  const [draft, setDraft] = useState<string | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const scroller = useRef<HTMLDivElement>(null);
  const jumped = useRef(0);
  const placed = useRef(false);
  const onOutlineRef = useRef(onOutline);
  useEffect(() => {
    onOutlineRef.current = onOutline;
  }, [onOutline]);
  const onOpenInBibleRef = useRef(onOpenInBible);
  useEffect(() => {
    onOpenInBibleRef.current = onOpenInBible;
  }, [onOpenInBible]);
  const linksScripture = onOpenInBible !== undefined;
  const openInBible = useCallback((reference: ScriptureRef) => onOpenInBibleRef.current?.(reference), []);

  // The Scripture references on each page, read once per page from its drawn text, in the source's language.
  const detected = useRef(new Map<number, Promise<DetectedReference[]>>());
  useEffect(() => {
    detected.current = new Map();
  }, [sourceId]);
  const detect = useCallback(
    (n: number, text: string): Promise<DetectedReference[]> => {
      let found = detected.current.get(n);
      if (!found) {
        found = api.libraryDetectReferences(sourceId, [text], { page: n }).then(
          (all) => all[0] ?? [],
          (e: unknown) => {
            detected.current.delete(n);
            void api.logError(`Scripture references on a PDF page could not be read: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
            return [];
          },
        );
        detected.current.set(n, found);
      }
      return found;
    },
    [api, sourceId],
  );

  // The stored paragraphs of each page (v0.14), read once per page: what marks are placed with.
  const segmentsOfPage = useRef(new Map<number, Promise<PageSegment[]>>());
  useEffect(() => {
    segmentsOfPage.current = new Map();
  }, [sourceId]);
  const loadSegments = useCallback(
    (n: number): Promise<PageSegment[]> => {
      let found = segmentsOfPage.current.get(n);
      if (!found) {
        found = api.sourceGetSegments({ sourceId, aroundPage: n, limit: 150 }).then(
          (w) => w.segments.filter((x) => x.pageNumber === n).map((x) => ({ segmentId: x.id, position: x.position, text: x.text })),
          () => {
            segmentsOfPage.current.delete(n);
            return [];
          },
        );
        segmentsOfPage.current.set(n, found);
      }
      return found;
    },
    [api, sourceId],
  );
  // The pages' drawn text layers with their placed paragraphs, for reading a selection.
  const layers = useRef(new Map<number, PageLayer>());
  const onLayer = useCallback((n: number, entry: PageLayer | null) => {
    if (entry) layers.current.set(n, entry);
    else layers.current.delete(n);
  }, []);
  useEffect(() => {
    if (!selectionRef) return;
    selectionRef.current = (selection) => {
      if (selection.isCollapsed || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      const pageOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-page]");
      const startPage = pageOf(range.startContainer);
      const endPage = pageOf(range.endContainer);
      // One page at a time: a selection across pages is not offered (mark it in Reading).
      if (!startPage || startPage !== endPage || !scroller.current?.contains(startPage)) return null;
      const layer = layers.current.get(Number(startPage.dataset.page));
      if (!layer) return null;
      const from = layer.map.offsetOf(range.startContainer, range.startOffset);
      const to = layer.map.offsetOf(range.endContainer, range.endOffset);
      if (from === null || to === null || from >= to) return null;
      const stored = pageToStored(layer.placement, from, to);
      if (!stored) return null;
      const positions = layer.placement.placed.filter((p) => p.segmentId === stored.start.segmentId || p.segmentId === stored.end.segmentId).map((p) => p.position);
      return { ...stored, firstPosition: Math.min(...positions), lastPosition: Math.max(...positions), page: Number(startPage.dataset.page) };
    };
    return () => {
      selectionRef.current = null;
    };
  }, [selectionRef]);

  const fail = useCallback(
    (error: unknown) => {
      // Details go to the log file; the interface shows its own wording.
      void api.logError(`Original PDF could not be shown: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined);
      setFailed(true);
    },
    [api],
  );

  // Open the document; close it when the source changes or the viewer goes.
  useEffect(() => {
    let active = true;
    let opened: PdfDocument | null = null;
    engine.open(api, sourceId).then(
      (d) => {
        if (!active) return void d.destroy();
        opened = d;
        setDoc(d);
        // The outline too, from this same document: if the reader's own read of it
        // failed, Contents still appears. A failure here is not worth a message.
        void d.outline().then((items) => active && onOutlineRef.current?.(items), () => undefined);
        void d.pageSize(1).then((size) => active && setSizes((s) => ({ ...s, 1: size })), fail);
      },
      (e) => active && fail(e),
    );
    return () => {
      active = false;
      void opened?.destroy();
    };
  }, [engine, api, sourceId, fail]);

  // The room the pages have (fit modes follow it). The first measurement is
  // immediate; while a pane is being dragged wider or narrower the later ones
  // wait until it settles, so pages are not redrawn on every frame.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, RESIZE_SETTLE_MS);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [doc]);

  const room = { width: box.width || 800, height: box.height || 600 };
  const fallback = sizes[1] ?? FALLBACK_PAGE;
  const scaleFor = useCallback(
    (size: PdfPageSize) => {
      const across = Math.max(100, room.width - 2 * PADDING);
      if (zoom.kind === "fit-width") return across / size.width;
      if (zoom.kind === "fit-page") return Math.min(across / size.width, Math.max(100, room.height - 2 * PADDING) / size.height);
      return (zoom.value / 100) * CSS_PER_POINT;
    },
    [zoom, room.width, room.height],
  );
  const percentOf = (scale: number) => Math.round((scale / CSS_PER_POINT) * 100);
  const currentPercent = percentOf(scaleFor(sizes[page] ?? fallback));

  const total = doc?.numPages ?? 0;
  const goTo = useCallback(
    (target: number, fraction = 0) => {
      if (!total) return;
      const n = Math.min(total, Math.max(1, Math.round(target)));
      setPage(n);
      const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
      if (el && scroller.current) {
        jumped.current = Date.now();
        const view = scroller.current;
        const wanted = el.offsetTop - GAP + Math.min(1, Math.max(0, fraction)) * el.offsetHeight;
        view.scrollTop = wanted;
      }
    },
    [total],
  );

  // Where the view is, on request: the page at the top of it and how far down that page it starts.
  useEffect(() => {
    if (!locationRef) return;
    locationRef.current = () => {
      const el = scroller.current;
      if (!el || el.scrollHeight === 0) return { page, fraction: 0 }; // not laid out (nothing to measure)
      // The page the viewer says it is on, and how far the top of the view is below that page's top
      // (outside 0..1 when the view starts above or below it, as at the end of the document).
      const at = el.querySelector<HTMLElement>(`[data-page="${page}"]`);
      if (!at || at.offsetHeight <= 0) return { page, fraction: 0 };
      return { page, fraction: Math.min(2, Math.max(-1, (el.scrollTop - (at.offsetTop - GAP)) / at.offsetHeight)) };
    };
    return () => {
      locationRef.current = null;
    };
  }, [locationRef, page]);

  // A link in a page was followed: find where it leads with the PDF's own data. One that leads nowhere
  // is left alone (the reader stays where it is) and noted in the log, without any document text.
  const follow = useCallback(
    async (dest: unknown) => {
      const place = doc ? await doc.resolve(dest) : null;
      if (place) onLink?.(place);
      else void api.logError("A link in the original PDF could not be followed: its destination was not found").catch(() => undefined);
    },
    [doc, onLink, api],
  );

  // Open at the requested page once the first page's size has laid things out.
  useEffect(() => {
    if (!doc || !sizes[1] || placed.current) return;
    placed.current = true;
    requestAnimationFrame(() => goTo(initialPage));
  }, [doc, sizes, initialPage, goTo]);

  useEffect(() => {
    onPageChange(page);
  }, [page, onPageChange]);

  // A request from outside (the contents): move there, keeping the zoom.
  const requested = useRef<number | null>(null);
  useEffect(() => {
    if (!jumpTo || requested.current === jumpTo.nonce || !doc || !sizes[1]) return;
    requested.current = jumpTo.nonce;
    goTo(jumpTo.page, jumpTo.fraction ?? 0);
  }, [jumpTo, doc, sizes, goTo]);

  // Follow the user's own scrolling (not our own jumps).
  const onScroll = () => {
    const el = scroller.current;
    if (!el || Date.now() - jumped.current < 200) return;
    const line = el.scrollTop + el.clientHeight / 3;
    let current = 1;
    for (const node of el.querySelectorAll<HTMLElement>("[data-page]")) {
      if (node.offsetTop <= line) current = Number(node.dataset.page);
      else break;
    }
    setPage(current);
  };

  // Zooming keeps the document point at the centre of the view where it was.
  const centre = useRef<{ x: number; y: number } | null>(null);
  const changeZoom = (next: Zoom) => {
    const el = scroller.current;
    if (el && el.scrollWidth > 0 && el.scrollHeight > 0) {
      centre.current = {
        x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
        y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight,
      };
    }
    setZoom(next);
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    const kept = centre.current;
    centre.current = null;
    if (!el || !kept) return;
    jumped.current = Date.now();
    el.scrollLeft = Math.max(0, kept.x * el.scrollWidth - el.clientWidth / 2);
    el.scrollTop = Math.max(0, kept.y * el.scrollHeight - el.clientHeight / 2);
  }, [zoom]);

  // Drag the page to move it, from anywhere but the words themselves, so
  // selecting text keeps working exactly as before.
  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = scroller.current;
    if (!el || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".textLayer > span, .textLayer > br, input, button, textarea, [data-aw-skip]")) return;
    if (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) return;
    e.preventDefault();
    el.focus({ preventScroll: true });
    const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.dataset.panning = "true";
    const move = (ev: MouseEvent) => {
      el.scrollLeft = start.left - (ev.clientX - start.x);
      el.scrollTop = start.top - (ev.clientY - start.y);
    };
    const stop = () => {
      delete el.dataset.panning;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  };

  const zoomBy = (direction: 1 | -1) => {
    const now = currentPercent;
    const next =
      direction === 1 ? ZOOM_STEPS.find((s) => s > now + 1) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]! : [...ZOOM_STEPS].reverse().find((s) => s < now - 1) ?? ZOOM_STEPS[0]!;
    changeZoom({ kind: "percent", value: next });
  };

  const pages = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total]);

  if (failed) {
    return (
      <div className="p-6">
        <Notice tone="error">{t("library.original.renderFailed")}</Notice>
      </div>
    );
  }

  const commitDraft = () => {
    const n = Number(draft);
    setDraft(null);
    if (Number.isFinite(n) && draft?.trim()) goTo(n);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="pdf-viewer">
      <div
        role="toolbar"
        aria-label={t("library.original.toolbar")}
        className="@container flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle bg-bg px-3 py-1.5 font-ui text-[0.9375rem]"
      >
        <div className="flex items-center gap-1">
          <Button variant="quiet" aria-label={t("library.original.previousPage")} title={t("library.original.previousPage")} disabled={!total || page <= 1} onClick={() => goTo(page - 1)}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <input
            type="text"
            inputMode="numeric"
            aria-label={t("library.original.pageNumber")}
            value={draft ?? String(total ? page : "")}
            disabled={!total}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitDraft();
              if (e.key === "Escape") setDraft(null);
            }}
            className="h-9 w-14 rounded-aw border border-border bg-bg px-2 text-center"
          />
          <span aria-hidden="true">{total ? t("library.original.pageTotal", { total: formatNumber(total) }) : ""}</span>
          <span role="status" className="sr-only">
            {total ? t("library.original.pageOf", { page: formatNumber(page), total: formatNumber(total) }) : ""}
          </span>
          <Button variant="quiet" aria-label={t("library.original.nextPage")} title={t("library.original.nextPage")} disabled={!total || page >= total} onClick={() => goTo(page + 1)}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="quiet" aria-label={t("library.original.zoomOut")} title={t("library.original.zoomOut")} disabled={!total} onClick={() => zoomBy(-1)}>
            <ZoomOut className="size-4" aria-hidden="true" />
          </Button>
          <span data-testid="pdf-zoom" className="min-w-12 text-center tabular-nums">{t("library.original.zoomValue", { percent: formatNumber(currentPercent) })}</span>
          <Button variant="quiet" aria-label={t("library.original.zoomIn")} title={t("library.original.zoomIn")} disabled={!total} onClick={() => zoomBy(1)}>
            <ZoomIn className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="quiet" aria-pressed={zoom.kind === "fit-width"} title={t("library.original.fitWidth")} disabled={!total} onClick={() => changeZoom({ kind: "fit-width" })}>
            <MoveHorizontal className="size-4" aria-hidden="true" /> <span className="@max-md:sr-only">{t("library.original.fitWidth")}</span>
          </Button>
          <Button variant="quiet" aria-pressed={zoom.kind === "fit-page"} title={t("library.original.fitPage")} disabled={!total} onClick={() => changeZoom({ kind: "fit-page" })}>
            <Maximize2 className="size-4" aria-hidden="true" /> <span className="@max-md:sr-only">{t("library.original.fitPage")}</span>
          </Button>
        </div>
      </div>

      <div
        ref={scroller}
        role="region"
        aria-label={t("library.original.viewerLabel")}
        tabIndex={0}
        onScroll={onScroll}
        onMouseDown={onMouseDown}
        className="relative min-h-0 flex-1 overflow-auto bg-bg-secondary data-[panning=true]:cursor-grabbing data-[panning=true]:select-none"
      >
        {!doc && <p className="m-0 p-6 text-text-muted">{t("library.original.loading")}</p>}
        {/* The canvas is at least as wide as the view and as wide as its widest
            page: a small page is centred in it, a large one fills it and can be
            scrolled across from its true left edge to its true right edge. */}
        <div data-testid="pdf-canvas" className="flex w-max min-w-full flex-col items-center px-4">
        {doc &&
          pages.map((n) => (
            <PageView
              key={n}
              doc={doc}
              n={n}
              size={sizes[n] ?? fallback}
              scale={scaleFor(sizes[n] ?? fallback)}
              onSize={(size) => setSizes((s) => (s[n] ? s : { ...s, [n]: size }))}
              onFailed={fail}
              onFollow={follow}
              detect={linksScripture ? detect : undefined}
              onOpenInBible={openInBible}
              find={find && find.page === n ? find : null}
              marks={marks}
              loadSegments={marks ? loadSegments : undefined}
              onLayer={onLayer}
              onMarksChanged={onMarksChanged}
              markActions={markActions}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface PageViewProps {
  doc: PdfDocument;
  n: number;
  size: PdfPageSize;
  scale: number;
  onSize: (size: PdfPageSize) => void;
  onFailed: (error: unknown) => void;
  onFollow: (dest: unknown) => void;
  /** Reads the Scripture references in a page's drawn text; absent when references are not linked. */
  detect?: (n: number, text: string) => Promise<DetectedReference[]>;
  onOpenInBible: (reference: ScriptureRef) => void;
  find: PdfFind | null;
  marks?: SourceAnnotation[];
  /** The stored paragraphs of a page; absent when marks are not drawn. */
  loadSegments?: (n: number) => Promise<PageSegment[]>;
  onLayer: (n: number, layer: PageLayer | null) => void;
  onMarksChanged?: () => Promise<SourceAnnotation[]>;
  markActions?: MarkActions;
}

/** A mark's colour on the always-white page: the highlight colour, see-through so the print shows. */
const PDF_MARK_CLASS = "pointer-events-none absolute mix-blend-multiply opacity-60";

/** On the original page (always white), a reference is a fixed-colour dotted underline over the drawn words. */
const PDF_REFERENCE_CLASSES: ScriptureReferenceClasses = {
  wrap: "relative block h-full w-full",
  trigger:
    "block h-full w-full cursor-pointer rounded-[2px] border-0 border-b-2 border-dotted border-[#2563eb] bg-transparent p-0 text-transparent hover:bg-[rgba(37,99,235,0.14)] focus-visible:bg-[rgba(37,99,235,0.14)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#2563eb] aria-expanded:bg-[rgba(37,99,235,0.18)]",
  menu: "absolute left-0 top-full z-30 mt-1 flex min-w-max flex-col rounded-aw border border-border bg-surface p-1 font-ui text-text shadow-md",
  item: "min-h-10 whitespace-nowrap rounded-[4px] px-3 text-left text-[0.9375rem] text-text-strong hover:bg-bg-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
};

const boxStyle = (box: PdfBox): React.CSSProperties => ({
  left: `${box.x * 100}%`,
  top: `${box.y * 100}%`,
  width: `${box.width * 100}%`,
  height: `${box.height * 100}%`,
});

/** One page: an empty sheet of the right size until it is near the screen. */
function PageView({ doc, n, size, scale, onSize, onFailed, onFollow, detect, onOpenInBible, find, marks, loadSegments, onLayer, onMarksChanged, markActions }: PageViewProps) {
  const { t } = useTranslation();
  const sheet = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  // Without IntersectionObserver (tests) only the first pages count as near.
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined" && n <= 3);

  useEffect(() => {
    const el = sheet.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin: "150% 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The page's links, kept with the size they were measured against, so their
  // places are shares of the page itself: they stay on the words at any zoom,
  // pixel density or pan, with no coordinates of their own to drift.
  const [layer, setLayer] = useState<{ links: PdfLink[]; page: PdfPageSize } | null>(null);
  useEffect(() => {
    if (!near) return;
    let live = true;
    void Promise.all([doc.links(n), doc.pageSize(n)]).then(
      ([links, page]) => live && setLayer({ links, page }),
      () => undefined,
    );
    return () => {
      live = false;
      setLayer(null);
    };
  }, [near, doc, n]);

  // The page-text map of the drawn text layer (v0.13): what references and find marks are placed with.
  const [pageText, setPageText] = useState<PdfTextLayer | null>(null);
  const scaleKey = Math.round(scale * 1000);
  useEffect(() => {
    const target = canvas.current;
    const layer = text.current;
    if (!near || !target) return;
    let live = true;
    const job = doc.render(n, target, scale);
    job.promise.then(
      () => {
        if (!live) return;
        void doc.pageSize(n).then((real) => live && onSize(real), () => undefined);
        if (layer) void doc.text(n, layer, scale).then((map) => live && setPageText(map));
      },
      (e) => live && onFailed(e),
    );
    return () => {
      live = false;
      setPageText(null);
      job.cancel();
      // Far from the screen: give back the bitmap and what the page kept.
      target.width = 0;
      target.height = 0;
      layer?.replaceChildren();
      doc.release(n);
    };
    // `scale` is represented by its rounded key so tiny layout jitter does not redraw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, scaleKey, doc, n]);

  // The Scripture references in the page's drawn text, each with its boxes. Only those placed exactly
  // on usable text are offered: none in a running header or footer, vertical or right-to-left text.
  // Kept with the page-text map they were placed on, so a redrawn layer never shows stale ones.
  const [placed, setPlaced] = useState<{ on: PdfTextLayer; list: { reference: DetectedReference; boxes: PdfBox[] }[] } | null>(null);
  useEffect(() => {
    if (!pageText || !pageText.hasText || !detect) return;
    let live = true;
    void detect(n, pageText.text).then((found) => {
      if (!live) return;
      const list = found.map((reference) => ({ reference, boxes: pageText.boxes(reference.start, reference.end) })).filter((r) => r.boxes.length > 0);
      setPlaced({ on: pageText, list });
    });
    return () => {
      live = false;
    };
  }, [pageText, detect, n]);
  const references = placed && detect && placed.on === pageText ? placed.list : [];

  // The page's stored paragraphs, placed on its drawn text (v0.14): marks are drawn with them, and
  // a selection here is read through them. Kept with the text map they were placed on.
  const [paragraphs, setParagraphs] = useState<{ on: PdfTextLayer; all: PageSegment[]; placement: PagePlacement } | null>(null);
  useEffect(() => {
    if (!pageText || !pageText.hasText || !loadSegments) return;
    let live = true;
    void loadSegments(n).then((all) => {
      if (!live) return;
      const placement = placeSegments(pageText.text, all);
      setParagraphs({ on: pageText, all, placement });
      if (text.current) onLayer(n, { element: text.current, map: pageText, placement });
    });
    return () => {
      live = false;
      onLayer(n, null);
    };
  }, [pageText, loadSegments, n, onLayer]);
  const placement = paragraphs && paragraphs.on === pageText ? paragraphs : null;

  // The marks drawn on this page: each covered paragraph's part, only where it is placed exactly
  // on usable text. A mark that begins here but cannot be drawn is still listed by the page's marker.
  const onPage = useMemo(() => {
    if (!marks) return { drawn: [] as { id: string; color: string | null; note: boolean; boxes: PdfBox[] }[], listed: [] as SourceAnnotation[] };
    const here = new Set(placement?.all.map((p) => p.segmentId) ?? []);
    const listed = marks.filter((m) => m.state !== "unresolved" && (m.start ? here.has(m.start.segmentId) : m.pageNumber === n));
    const drawn: { id: string; color: string | null; note: boolean; boxes: PdfBox[] }[] = [];
    if (placement && pageText) {
      for (const mark of marks) {
        const { start, end } = mark;
        if (mark.state === "unresolved" || mark.kind === "bookmark" || mark.quote === null || !start || !end || start.offset === null || end.offset === null) continue;
        const boxes: PdfBox[] = [];
        for (const p of placement.all) {
          if (p.position < start.position || p.position > end.position) continue;
          const from = p.position === start.position ? start.offset : 0;
          const to = p.position === end.position ? end.offset : p.text.length;
          const range = storedToPage(placement.placement, p.segmentId, from, to);
          if (range) boxes.push(...pageText.boxes(range[0], range[1]));
        }
        if (boxes.length > 0) drawn.push({ id: mark.id, color: mark.kind === "highlight" ? mark.color : null, note: mark.kind === "note", boxes });
      }
    }
    return { drawn, listed };
  }, [marks, placement, pageText, n]);
  const [marksOpen, setMarksOpen] = useState(false);
  const marksButton = useRef<HTMLButtonElement | null>(null);
  // When the page has no marks left, its panel and marker go: focus moves to the page, not lost.
  const marksChanged = async () => {
    const all = await onMarksChanged?.();
    if (!all) return;
    const here = new Set(placement?.all.map((p) => p.segmentId) ?? []);
    if (all.some((m) => m.state !== "unresolved" && (m.start ? here.has(m.start.segmentId) : m.pageNumber === n))) return;
    setMarksOpen(false);
    requestAnimationFrame(() => {
      const page = sheet.current;
      if (!page) return;
      if (!page.hasAttribute("tabindex")) {
        page.setAttribute("tabindex", "-1");
        page.addEventListener("blur", () => page.removeAttribute("tabindex"), { once: true });
      }
      page.focus({ preventScroll: true });
    });
  };
  const marksId = `pdf-marks-${n}`;

  // The current find match, if this page's own text shows it unambiguously: exactly as many
  // occurrences as the source's text has on this page. Otherwise the page is shown without a mark.
  const findBoxes = (() => {
    if (!find || !pageText) return [];
    const places = findOnPage(pageText.text, find.query);
    if (places.length !== find.count) return [];
    const place = places[find.index];
    return place ? pageText.boxes(place[0], place[1]) : [];
  })();
  const findKey = findBoxes.length > 0 && find ? `${find.query}|${find.index}|${find.count}` : null;
  const findMark = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (findKey) findMark.current?.scrollIntoView?.({ block: "center", inline: "nearest" });
  }, [findKey]);

  return (
    <div
      ref={sheet}
      data-page={n}
      role="group"
      aria-label={t("library.original.pageLabel", { page: formatNumber(n) })}
      data-rendered={near || undefined}
      className="relative shrink-0 bg-white text-black shadow-md"
      style={{ width: size.width * scale, height: size.height * scale, marginTop: GAP, marginBottom: GAP }}
    >
      {near && <canvas ref={canvas} className="block" />}
      {near && <div ref={text} className="textLayer absolute inset-0" />}
      {/* The page is always white, so the link's tint and ring are fixed colours, not the app theme's. */}
      {near &&
        layer?.links.map((link, i) => (
          <button
            key={i}
            type="button"
            data-pdf-link
            aria-label={t("library.links.follow")}
            title={t("library.links.follow")}
            onClick={() => onFollow(link.dest)}
            className="absolute cursor-pointer rounded-[2px] bg-transparent hover:bg-[rgba(37,99,235,0.14)] focus-visible:bg-[rgba(37,99,235,0.14)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#2563eb]"
            style={{
              left: `${(link.x / layer.page.width) * 100}%`,
              top: `${(link.y / layer.page.height) * 100}%`,
              width: `${(link.width / layer.page.width) * 100}%`,
              height: `${(link.height / layer.page.height) * 100}%`,
            }}
          />
        ))}
      {near &&
        onPage.drawn.map((mark) =>
          mark.boxes.map((box, i) => (
            <div
              key={`m${mark.id}-${i}`}
              data-pdf-mark={mark.color ?? "note"}
              aria-hidden="true"
              className={`${PDF_MARK_CLASS} ${mark.color ? PHRASE_CLASS[mark.color as keyof typeof PHRASE_CLASS] : "border-b-2 border-dotted border-[#b45309]"}`}
              style={boxStyle(box)}
            />
          )),
        )}
      {near && onPage.listed.length > 0 && (
        <div data-aw-skip="" className="absolute right-1 top-1 z-10 flex flex-col items-end gap-1 font-ui">
          <span className="rounded-full bg-[rgba(255,255,255,0.92)] shadow-sm">
            <MarksMarker
              marks={onPage.listed}
              open={marksOpen}
              controls={marksId}
              onToggle={(button) => {
                marksButton.current = button;
                setMarksOpen((o) => !o);
              }}
            />
          </span>
          {marksOpen && (
            <div className="w-80 max-w-[90vw] text-left">
              <MarksInspector
                id={marksId}
                marks={onPage.listed}
                onChanged={() => void marksChanged()}
                onClose={() => {
                  setMarksOpen(false);
                  requestAnimationFrame(() => marksButton.current?.focus({ preventScroll: true }));
                }}
                {...markActions}
              />
            </div>
          )}
        </div>
      )}
      {near &&
        findBoxes.map((box, i) => (
          <div
            key={`f${i}`}
            ref={i === 0 ? findMark : undefined}
            data-pdf-find
            aria-hidden="true"
            className="pointer-events-none absolute rounded-[2px] bg-[rgba(250,204,21,0.45)] outline outline-2 outline-[#b45309]"
            style={boxStyle(box)}
          />
        ))}
      {near &&
        references.map(({ reference, boxes }) =>
          boxes.map((box, i) =>
            i === 0 ? (
              <div key={`r${reference.start}`} data-pdf-reference className="absolute" style={boxStyle(box)}>
                <ScriptureReference reference={reference.reference} onOpen={onOpenInBible} classes={PDF_REFERENCE_CLASSES}>
                  {reference.text}
                </ScriptureReference>
              </div>
            ) : (
              // A reference broken over two lines: the rest of it is underlined too, and acted on through its first part.
              <div key={`r${reference.start}-${i}`} aria-hidden="true" className="pointer-events-none absolute border-b-2 border-dotted border-[#2563eb]" style={boxStyle(box)} />
            ),
          ),
        )}
      {near && pageText && !pageText.hasText && (
        <p role="note" className="absolute left-2 top-2 m-0 rounded-[4px] border border-[#d4d4d4] bg-[rgba(255,255,255,0.92)] px-2 py-1 font-ui text-[0.8125rem] text-[#404040]">
          {t("library.original.noNativeText")}
        </p>
      )}
    </div>
  );
}
