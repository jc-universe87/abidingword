import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Maximize2, MoveHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { formatNumber } from "@/i18n/format";
import { useApi } from "@/lib/ApiContext";
import type { PdfDocument, PdfPageSize } from "@/lib/pdfEngine";
import { usePdfEngine } from "./PdfEngineContext";

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
}

/**
 * The original PDF, page by page, as the PDF itself lays it out. Only pages
 * near the screen are drawn (and released again when far away), so a long
 * book never fills memory with canvases. The page is always drawn on white,
 * whatever the app theme: the document is not recoloured. This is a place to
 * inspect the source; search, citations and Scripture links stay with the
 * extracted text.
 */
export function PdfViewer({ sourceId, initialPage, onPageChange }: PdfViewerProps) {
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
    (target: number) => {
      if (!total) return;
      const n = Math.min(total, Math.max(1, Math.round(target)));
      setPage(n);
      const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
      if (el && scroller.current) {
        jumped.current = Date.now();
        scroller.current.scrollTop = el.offsetTop - GAP;
      }
    },
    [total],
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
    if (target.closest(".textLayer > span, .textLayer > br, input, button, textarea")) return;
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
}

/** One page: an empty sheet of the right size until it is near the screen. */
function PageView({ doc, n, size, scale, onSize, onFailed }: PageViewProps) {
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
        if (layer) void doc.text(n, layer, scale);
      },
      (e) => live && onFailed(e),
    );
    return () => {
      live = false;
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
    </div>
  );
}
