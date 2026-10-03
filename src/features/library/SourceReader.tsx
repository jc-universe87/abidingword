import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, List, Maximize2 } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { formatNumber } from "@/i18n/format";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { ContentsItem, SegmentWindow, SourceSegment } from "@/types/library";
import { formatLabel, licenceLabel, locatorLabel, sourceTypeLabel } from "./labels";
import { ContentsPanel, useContentsLayout } from "./ContentsPanel";
import { PdfViewer } from "./PdfViewer";
import { currentEntry, useSourceContents } from "./useSourceContents";

export type ReaderMode = "reading" | "original";

/**
 * Where a reader is: which view, and the physical page (PDF) that view is
 * at. Kept by the shell for the current session so that moving between the
 * Sources pane and the full reader (and back) does not lose the place.
 */
export interface ReaderPosition {
  mode: ReaderMode;
  /** Physical page, or null for a source that has none (or before it is known). */
  page: number | null;
}

interface SourceReaderProps {
  sourceId: string;
  segmentId?: string;
  /** Leaves the reader. Told where it was, so the next reader can open there. */
  onClose: (position: ReaderPosition) => void;
  /**
   * "page" (default): the full-width reader that replaces the workspace.
   * "pane": inside the Sources pane, beside Scripture and the Study, with
   * "Open full reader" to switch to the page.
   */
  variant?: "page" | "pane";
  /** Pane only: open this source in the full-width reader, at the same place. */
  onExpand?: (position: ReaderPosition) => void;
  /** Where to open (view and page), when continuing from another reader. */
  initialPosition?: ReaderPosition;
}

/**
 * A plain reader for a library source, for context and checking citations:
 * extracted text with page markers (PDF) or section headings (EPUB,
 * Markdown). Opens at an exact segment and loads more around it on demand.
 */
export function SourceReader({ sourceId, segmentId, onClose, variant = "page", onExpand, initialPosition }: SourceReaderProps) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const source = useLoad(useCallback(() => api.libraryGetSource(sourceId), [api, sourceId]));
  const [window, setWindow] = useState<SegmentWindow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ReaderMode>(initialPosition?.mode ?? "reading");
  // The page this reader was told to open at (continuing from another reader).
  const [initialPage] = useState(initialPosition?.page ?? null);
  const startedInOriginal = initialPosition?.mode === "original";
  // The physical page the original is showing, kept for the way back to Reading.
  const originalPage = useRef<number | null>(null);
  // A page Reading should scroll to after coming back from the original.
  const landing = useRef<number | null>(null);
  // Where the original opens; until chosen, the page of the passage opened at.
  const [openPage, setOpenPage] = useState<number | null>(null);
  // The source's own contents (an EPUB's, a PDF's outline), and the panel that shows them.
  const contents = useSourceContents(source.data);
  const stage = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const contentsLayout = useContentsLayout(stage, contents.length > 0);
  const [panel, setPanel] = useState<{ currentId: string | null } | null>(null);
  const [jump, setJump] = useState<{ page: number; nonce: number } | null>(null);
  // A segment position Reading should scroll to after a contents entry was chosen.
  const landingPosition = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    let load: Promise<SegmentWindow>;
    if (initialPage !== null) {
      // Continuing from another reader: open the text where that page begins.
      // The marked passage stays marked only if it is on that page.
      load = api.sourceGetSegments({ sourceId, aroundPage: initialPage }).then((w) => {
        const marked = segmentId ? w.segments.find((x) => x.id === segmentId) : undefined;
        const keep = marked !== undefined && marked.pageNumber === initialPage;
        if (!keep && !startedInOriginal) landing.current = initialPage;
        return { ...w, targetSegmentId: keep ? segmentId! : null };
      });
    } else {
      load = segmentId ? api.libraryOpenSegment(segmentId) : api.sourceGetSegments({ sourceId });
    }
    load.then((w) => active && setWindow(w), (e) => active && setError(toApiError(e).message));
    return () => {
      active = false;
    };
  }, [api, sourceId, segmentId, initialPage, startedInOriginal]);

  // Opened at a place: show and focus that paragraph. Otherwise focus the
  // title, so keyboard and screen-reader users know the reader opened.
  const targetId = window?.targetSegmentId;
  const loaded = !!window && !!source.data;
  useEffect(() => {
    if (!loaded) return;
    if (target.current) {
      target.current.scrollIntoView?.({ block: "center" });
      target.current.focus({ preventScroll: true });
    } else {
      heading.current?.focus({ preventScroll: true });
    }
  }, [loaded, targetId]);

  const hasOriginal = source.data?.originalView?.kind === "pdf";
  const targetPage = window?.segments.find((x) => x.id === window.targetSegmentId)?.pageNumber ?? null;
  const startPage = openPage ?? initialPage ?? targetPage ?? 1;
  const showOriginal = mode === "original" && hasOriginal;

  /** The physical page Reading is at: the marked passage if it is in view, else the top of the view. */
  const readingPage = (): number => {
    const body = bodyRef.current;
    const paragraphs = body ? [...body.querySelectorAll<HTMLElement>("[data-seg-page]")] : [];
    const area = body?.getBoundingClientRect();
    const targetPage = window?.segments.find((x) => x.id === window.targetSegmentId)?.pageNumber ?? null;
    const marked = body?.querySelector<HTMLElement>("[data-target]");
    if (marked && area && targetPage !== null) {
      const box = marked.getBoundingClientRect();
      if (box.bottom > area.top && box.top < area.bottom) return targetPage;
    }
    const top = paragraphs.find((el) => area && el.getBoundingClientRect().bottom > area.top);
    return Number(top?.dataset.segPage ?? targetPage ?? 1);
  };

  /** Where this reader is now, for the next reader to continue from. */
  const positionNow = (): ReaderPosition =>
    showOriginal
      ? { mode: "original", page: originalPage.current ?? startPage }
      : { mode: "reading", page: hasOriginal && window ? readingPage() : null };

  const choose = async (next: ReaderMode) => {
    if (next === mode) return;
    if (next === "original") {
      setOpenPage(readingPage());
      setMode("original");
      return;
    }
    // Back to Reading: open the text where the original was.
    const page = originalPage.current;
    setMode("reading");
    if (page === null || page === startPage) {
      // Still where it was opened: keep the window (and any marked passage).
      landing.current = startPage;
      setWindow((w) => (w ? { ...w } : w));
      return;
    }
    try {
      const w = await api.sourceGetSegments({ sourceId, aroundPage: page });
      landing.current = page;
      setWindow({ ...w, targetSegmentId: null });
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  // Scroll Reading to the page the original was on, or to the entry chosen in the contents.
  useEffect(() => {
    if (mode !== "reading" || !window) return;
    const body = bodyRef.current;
    if (landing.current !== null) {
      // The page itself, or (a page with no text of its own) the next one that has some.
      const wanted = landing.current;
      const spots = body ? [...body.querySelectorAll<HTMLElement>("[data-seg-page]")] : [];
      spots.find((el) => Number(el.dataset.segPage) >= wanted)?.scrollIntoView?.({ block: "start" });
      landing.current = null;
    }
    if (landingPosition.current !== null) {
      const spot = body?.querySelector<HTMLElement>(`[data-seg-position="${landingPosition.current}"]`);
      // Show the chapter or section heading that precedes the text, too.
      const before = spot?.previousElementSibling;
      (before?.hasAttribute("data-section-marker") ? before : spot)?.scrollIntoView?.({ block: "start" });
      spot?.setAttribute("tabindex", "-1");
      spot?.focus({ preventScroll: true });
      landingPosition.current = null;
    }
  }, [mode, window]);

  /** The contents entry the reader is in now: by page for a PDF, by segment position otherwise. */
  const currentEntryNow = (): string | null => {
    if (hasOriginal) return currentEntry(contents, "page", showOriginal ? (originalPage.current ?? startPage) : readingPage());
    const body = bodyRef.current;
    const area = body?.getBoundingClientRect();
    const top = body ? [...body.querySelectorAll<HTMLElement>("[data-seg-position]")].find((el) => area && el.getBoundingClientRect().bottom > area.top) : undefined;
    return currentEntry(contents, "segment", Number(top?.dataset.segPosition ?? window?.offset ?? 0));
  };

  const openContents = () => setPanel({ currentId: currentEntryNow() });
  const closeContents = () => {
    setPanel(null);
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
  };

  /** Reading, at a physical page: stay in Reading and show that page's text. */
  const goToPage = async (page: number) => {
    landing.current = page;
    if (window?.segments.some((x) => x.pageNumber === page)) {
      setWindow({ ...window });
      return;
    }
    try {
      const w = await api.sourceGetSegments({ sourceId, aroundPage: page });
      setWindow({ ...w, targetSegmentId: null });
    } catch (e) {
      landing.current = null;
      setError(toApiError(e).message);
    }
  };

  /** Reading, at a segment of the extracted text (EPUB). */
  const goToPosition = async (position: number) => {
    landingPosition.current = position;
    if (window && position >= window.offset && position < window.offset + window.segments.length) {
      setWindow({ ...window });
      return;
    }
    try {
      const w = await api.sourceGetSegments({ sourceId, offset: Math.max(0, position - 20), limit: 150 });
      setWindow({ ...w, targetSegmentId: null });
    } catch (e) {
      landingPosition.current = null;
      setError(toApiError(e).message);
    }
  };

  const chooseEntry = (item: ContentsItem) => {
    const target = item.target;
    if (!target) return;
    closeContents();
    if (target.kind === "page") {
      // The mode is kept: Original moves its page (zoom unchanged), Reading shows that page's text.
      if (showOriginal) setJump({ page: target.page, nonce: Date.now() });
      else void goToPage(target.page);
    } else {
      void goToPosition(target.position);
    }
  };

  const more = async (direction: "earlier" | "later") => {
    if (!window) return;
    const limit = 150;
    const offset = direction === "earlier" ? Math.max(0, window.offset - limit) : window.offset + window.segments.length;
    try {
      const next = await api.sourceGetSegments({ sourceId, offset, limit: direction === "earlier" ? window.offset - offset : limit });
      setWindow({
        ...window,
        offset: direction === "earlier" ? next.offset : window.offset,
        segments: direction === "earlier" ? [...next.segments, ...window.segments] : [...window.segments, ...next.segments],
        targetSegmentId: window.targetSegmentId,
      });
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const inPane = variant === "pane";
  const s = source.data;
  const Title = inPane ? "h2" : "h1";
  const body = (
    <>
      {source.error && <Notice tone="error">{source.error.message}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {s && (
        <header className="flex flex-col gap-1 border-b border-border-subtle pb-4">
          {inPane && (
            <Title
              id={`${id}-title`}
              ref={heading}
              tabIndex={-1}
              className="m-0 font-display font-heading text-[1.375rem] leading-snug text-text-strong"
            >
              {s.title}
            </Title>
          )}
          {s.author && <p className="reading m-0">{s.author}</p>}
          <p className="m-0 text-[0.9375rem] text-text-muted">
            {[
              sourceTypeLabel(t, s.sourceType),
              s.format ? formatLabel(t, s.format) : null,
              s.pageCount ? t("library.size.pages", { count: s.pageCount, number: formatNumber(s.pageCount) }) : null,
              s.language,
              s.publisher,
              s.isbn ? t("library.metadata.isbn", { isbn: s.isbn }) : null,
            ]
              .filter(Boolean)
              .join(t("common.listSeparator"))}
          </p>
          <p className="m-0 text-[0.9375rem] text-text-muted">
            {[licenceLabel(t, s.licenceStatus), s.originalFilename ? t("library.metadata.fromFile", { fileName: s.originalFilename }) : null]
              .filter(Boolean)
              .join(t("common.listSeparator"))}
          </p>
        </header>
      )}
      {window && (
        <div className="flex flex-col gap-3">
          {window.offset > 0 && <Button className="self-start" onClick={() => more("earlier")}>{t("library.reader.showEarlier")}</Button>}
          <div className="reading flex flex-col gap-3">
            {window.segments.map((segment, index) => (
              <SegmentView
                key={segment.id}
                segment={segment}
                previous={window.segments[index - 1]}
                isTarget={segment.id === window.targetSegmentId}
                targetRef={segment.id === window.targetSegmentId ? target : undefined}
              />
            ))}
          </div>
          {window.offset + window.segments.length < window.total && (
            <Button className="self-start" onClick={() => more("later")}>{t("library.reader.showMore")}</Button>
          )}
        </div>
      )}
    </>
  );

  // The original, as its own view under the (never scrolling) header. It
  // mounts as soon as the page to open at is known.
  const original = showOriginal ? (
    !window && !error && openPage === null && initialPage === null ? null : (
      <PdfViewer
        key={`${sourceId}-${startPage}`}
        sourceId={sourceId}
        initialPage={startPage}
        onPageChange={(page) => {
          originalPage.current = page;
        }}
        jumpTo={jump}
      />
    )
  ) : null;

  const modeSwitch = hasOriginal ? <ModeSwitch mode={mode} onChange={(m) => void choose(m)} /> : null;
  const contentsButton =
    contents.length > 0 ? (
      <Button ref={opener} variant="quiet" aria-expanded={panel !== null} title={t("library.contents.show")} onClick={() => (panel ? closeContents() : openContents())}>
        <List className="size-4" aria-hidden="true" /> {t("library.contents.title")}
      </Button>
    ) : null;
  const contentsPanel = panel ? (
    <ContentsPanel title={s?.title ?? ""} items={contents} currentId={panel.currentId} layout={contentsLayout} onSelect={chooseEntry} onClose={closeContents} />
  ) : null;

  if (inPane) {
    // A column: controls that never scroll away, then Reading (which scrolls
    // inside its own body) or the original (which has its own toolbar and scroller).
    return (
      <section aria-label={s?.title} className="flex min-h-0 flex-1 flex-col">
        <div data-testid="reader-header" className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border-subtle px-3 py-2">
          <Button variant="quiet" onClick={() => onClose(positionNow())}>
            <ArrowLeft className="size-4" aria-hidden="true" /> {t("library.reader.backToSources")}
          </Button>
          {onExpand && (
            <Button variant="quiet" onClick={() => onExpand(positionNow())} title={t("library.reader.openFullTitle")}>
              <Maximize2 className="size-4" aria-hidden="true" /> {t("library.reader.openFull")}
            </Button>
          )}
        </div>
        {(modeSwitch || contentsButton) && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-1.5">
            {modeSwitch}
            {contentsButton}
          </div>
        )}
        <div ref={stage} className="relative flex min-h-0 flex-1 flex-col">
          {showOriginal ? (
            original
          ) : (
            <div ref={bodyRef} data-testid="reader-body" className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex flex-col gap-5 px-5 pb-16 pt-5">{body}</div>
            </div>
          )}
          {contentsPanel}
        </div>
      </section>
    );
  }

  // The full reader is a column too: a header that never scrolls (Back stays
  // reachable however far the text is scrolled) above the content.
  return (
    <main aria-labelledby={`${id}-title`} className="flex min-h-0 flex-1 flex-col bg-bg">
      <div data-testid="reader-header" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-bg px-4 py-2">
        <Button variant="quiet" className="shrink-0" onClick={() => onClose(positionNow())}>
          <ArrowLeft className="size-4" aria-hidden="true" /> {t("common.back")}
        </Button>
        <h1
          id={`${id}-title`}
          ref={heading}
          tabIndex={-1}
          title={s?.title}
          className="m-0 min-w-0 flex-1 truncate font-display text-[1.125rem] font-heading text-text-strong"
        >
          {s?.title}
        </h1>
        {modeSwitch}
        {contentsButton}
      </div>
      <div ref={stage} className="relative flex min-h-0 flex-1 flex-col">
        {showOriginal ? (
          original
        ) : (
          <div ref={bodyRef} data-testid="reader-body" className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-[46rem] flex-col gap-6 px-8 pb-24 pt-6">{body}</div>
          </div>
        )}
        {contentsPanel}
      </div>
    </main>
  );
}

/** Reading | Original, one control for both readers. */
function ModeSwitch({ mode, onChange }: { mode: ReaderMode; onChange: (mode: ReaderMode) => void }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t("library.original.modesLabel")} className="flex shrink-0 rounded-aw border border-border p-0.5">
      {(["reading", "original"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          className="min-h-9 rounded-[4px] px-3 font-ui text-[0.9375rem] text-text-strong hover:bg-bg-secondary aria-pressed:bg-primary aria-pressed:text-on-primary"
        >
          {t(`library.original.${m}`)}
        </button>
      ))}
    </div>
  );
}

function SegmentView({ segment, previous, isTarget, targetRef }: { segment: SourceSegment; previous?: SourceSegment; isTarget: boolean; targetRef?: React.MutableRefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const page = segment.pageLabel ?? segment.pageNumber;
  const newPage = segment.pageNumber !== null && segment.pageNumber !== previous?.pageNumber;
  const newSection = segment.pageNumber === null && segment.sectionPath && segment.sectionPath !== previous?.sectionPath;
  return (
    <>
      {newPage && (
        <p className="m-0 mt-2 border-t border-border-subtle pt-2 font-ui text-[0.875rem] font-medium text-text-muted" aria-label={t("library.reader.pageMarker", { page: String(page) })}>
          {locatorLabel(t, segment.locator, page)}
        </p>
      )}
      {newSection && (
        <p data-section-marker className="m-0 mt-3 font-display text-[1.125rem] font-heading text-text-strong">
          {segment.sectionPath}
        </p>
      )}
      <p
        ref={targetRef as React.RefObject<HTMLParagraphElement> | undefined}
        tabIndex={isTarget ? -1 : undefined}
        data-target={isTarget || undefined}
        data-seg-page={segment.pageNumber ?? undefined}
        data-seg-position={segment.position}
        className={`m-0 ${isTarget ? "border-l-[3px] border-accent bg-note px-3 py-1" : ""}`}
      >
        {segment.text}
      </p>
    </>
  );
}
