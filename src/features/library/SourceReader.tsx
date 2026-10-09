import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, List, Maximize2, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { formatNumber } from "@/i18n/format";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { hostOf } from "@/lib/externalLink";
import type { PdfPlace } from "@/lib/pdfEngine";
import type { ContentsItem, SegmentWindow, SourceLink, SourceReference, SourceSegment } from "@/types/library";
import type { ScriptureRef } from "@/types/scripture";
import { formatLabel, licenceLabel, locatorLabel, sourceTypeLabel } from "./labels";
import { useLibraryNav } from "./LibraryNav";
import { PassageLinkNote } from "./PassageLinkNote";
import { ScriptureReference } from "./ScriptureReference";
import { ContentsPanel, useContentsLayout } from "./ContentsPanel";
import { EpubViewer } from "./formatted/EpubViewer";
import { placeOfPosition, positionOfPlace, type EpubPlace } from "./formatted/epubLocation";
import { useEpubStructure } from "./formatted/useEpubStructure";
import { PdfViewer } from "./PdfViewer";
import { canGoBack, canGoForward, NO_HISTORY, stepBack, stepForward, visit, type ReaderHistory, type SourceLocation } from "./readerHistory";
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
  /** The Back / Forward history of this reading session, kept while moving between the pane and the full reader. */
  history?: ReaderHistory;
  /** An EPUB's formatted view: where it is (document and element), to continue there. */
  place?: SourceLocation;
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
  // A web link the system could not open: shown above the formatted view, which has no body to show `error` in.
  const [linkFailed, setLinkFailed] = useState(false);
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
  const { items: contents, adopt: adoptContents } = useSourceContents(source.data);
  const stage = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const contentsLayout = useContentsLayout(stage, contents.length > 0);
  const [panel, setPanel] = useState<{ currentId: string | null } | null>(null);
  const [jump, setJump] = useState<{ page: number; nonce: number; fraction?: number } | null>(null);
  // A segment position Reading should scroll to after a contents entry or link was chosen.
  // With an `offset`, the segment is put exactly that far from the top of the view (returning by Back / Forward).
  const landingPosition = useRef<{ position: number; offset: number | null } | null>(null);
  const jumps = useRef(0);

  // Back / Forward: deliberate jumps only. Kept in a ref as well as state, so a handler always sees the latest.
  const [history, setHistory] = useState<ReaderHistory>(initialPosition?.history ?? NO_HISTORY);
  const historyRef = useRef(history);
  // Closing the panel gives focus back to its button, a frame later. A jump that lands
  // on a paragraph cancels that, so the place chosen keeps focus whatever the timing.
  const refocusOpener = useRef<number | null>(null);
  const commit = (next: ReaderHistory) => {
    historyRef.current = next;
    setHistory(next);
  };
  // Where the original is, on request (page and how far down it).
  const pdfNow = useRef<(() => PdfPlace) | null>(null);
  // The links in an EPUB's text, by the segment they are in.
  const links = useSourceLinks(source.data);
  // The Scripture references written in the text, by segment (from the stored index).
  const references = useSourceReferences(source.data?.id);
  const { openInBible } = useLibraryNav();
  // An EPUB's formatted view: its reading order, where it was told to open, and where it is on request.
  const epub = useEpubStructure(source.data);
  const [epubStart] = useState<EpubPlace | null>(
    initialPosition?.place?.item ? { item: initialPosition.place.item, fragment: initialPosition.place.fragment, offset: initialPosition.place.itemOffset } : null,
  );
  const [epubOpen, setEpubOpen] = useState<EpubPlace | null>(null);
  const [epubJump, setEpubJump] = useState<(EpubPlace & { nonce: number }) | null>(null);
  const epubNow = useRef<(() => EpubPlace) | null>(null);

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

  const viewKind = source.data?.originalView?.kind;
  const isPdf = viewKind === "pdf";
  // An EPUB has an Original view unless its structure could not be read or it has no text.
  const isEpubView = (viewKind === "epub" || viewKind === "docx") && epub.status !== "failed" && !(epub.status === "ready" && epub.items.length === 0);
  const hasOriginal = isPdf || isEpubView;
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
    showOriginal && isEpubView
      ? { mode: "original", page: null, history: historyRef.current, place: placeNow() }
      : showOriginal
        ? { mode: "original", page: originalPage.current ?? startPage, history: historyRef.current }
        : { mode: "reading", page: isPdf && window ? readingPage() : null, history: historyRef.current };

  const choose = async (next: ReaderMode) => {
    if (next === mode) return;
    // A request made in the other view, and a panel that named a place there, are finished.
    setPanel(null);
    setJump(null);
    setEpubJump(null);
    if (isEpubView) {
      // Same place in the other view: the document and element for the text on top, and the other way round.
      if (next === "original") {
        const at = topSegment();
        setEpubOpen(at ? placeOfPosition(epub.items, at.position) : null);
        setMode("original");
      } else {
        const position = (() => {
          const here = epubNow.current?.();
          return here ? positionOfPlace(epub.items, here) : null;
        })();
        setMode("reading");
        if (position !== null) void goToPosition(position);
      }
      return;
    }
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
      const { position, offset } = landingPosition.current;
      const spot = body?.querySelector<HTMLElement>(`[data-seg-position="${position}"]`);
      if (offset !== null) {
        // Back / Forward: the very place, as far from the top of the view as it was.
        spot?.scrollIntoView?.({ block: "start" });
        if (body) body.scrollTop -= offset;
      } else {
        // Show the chapter or section heading that precedes the text, too.
        const before = spot?.previousElementSibling;
        (before?.hasAttribute("data-section-marker") ? before : spot)?.scrollIntoView?.({ block: "start" });
      }
      spot?.setAttribute("tabindex", "-1");
      if (spot && refocusOpener.current !== null) {
        cancelAnimationFrame(refocusOpener.current);
        refocusOpener.current = null;
      }
      spot?.focus({ preventScroll: true });
      landingPosition.current = null;
    }
  }, [mode, window]);

  /** The contents entry the reader is in now: by page for a PDF, by segment position otherwise. */
  const currentEntryNow = (): string | null => {
    if (isPdf) return currentEntry(contents, "page", showOriginal ? (originalPage.current ?? startPage) : readingPage());
    if (showOriginal && isEpubView) {
      const here = epubNow.current?.();
      return currentEntry(contents, "segment", (here ? positionOfPlace(epub.items, here) : null) ?? 0);
    }
    const body = bodyRef.current;
    const area = body?.getBoundingClientRect();
    const top = body ? [...body.querySelectorAll<HTMLElement>("[data-seg-position]")].find((el) => area && el.getBoundingClientRect().bottom > area.top) : undefined;
    return currentEntry(contents, "segment", Number(top?.dataset.segPosition ?? window?.offset ?? 0));
  };

  const openContents = () => setPanel({ currentId: currentEntryNow() });
  const closeContents = () => {
    setPanel(null);
    if (refocusOpener.current !== null) cancelAnimationFrame(refocusOpener.current);
    refocusOpener.current = requestAnimationFrame(() => {
      refocusOpener.current = null;
      opener.current?.focus({ preventScroll: true });
    });
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
  const goToPosition = async (position: number, offset: number | null = null) => {
    landingPosition.current = { position, offset };
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

  /** The segment on top of the Reading view (or the one a link was followed from), and how far its top is from the top of the view. */
  const topSegment = (anchor?: number): { position: number; offset: number } | null => {
    const body = bodyRef.current;
    const area = body?.getBoundingClientRect();
    const all = body ? [...body.querySelectorAll<HTMLElement>("[data-seg-position]")] : [];
    // The paragraph a link was followed from, if there is one: Back returns to exactly that. Otherwise the top of the view.
    const top =
      (anchor !== undefined ? all.find((el) => el.dataset.segPosition === String(anchor)) : undefined) ??
      all.find((el) => area && el.getBoundingClientRect().bottom > area.top) ??
      all[0];
    if (!top) return null;
    return { position: Number(top.dataset.segPosition), offset: area ? Math.round(top.getBoundingClientRect().top - area.top) : 0 };
  };

  /** A formatted EPUB place with both of its faces: document and element, and the matching segment of the text. */
  const epubPlace = (at: EpubPlace | null, offsetOfText = 0, position?: number | null): SourceLocation => ({
    page: null,
    fraction: 0,
    position: position ?? (at ? positionOfPlace(epub.items, at) : null),
    offset: offsetOfText,
    item: at?.item ?? null,
    fragment: at?.fragment ?? null,
    itemOffset: at?.offset ?? 0,
  });

  /** Where the reader is now, as a place Back and Forward can return to. */
  const placeNow = (anchor?: number | EpubPlace): SourceLocation => {
    if (showOriginal && isEpubView) {
      const first = epub.items[0] ? { item: epub.items[0].id, fragment: null, offset: 0 } : null;
      return epubPlace(typeof anchor === "object" ? anchor : (epubNow.current?.() ?? epubOpen ?? epubStart ?? first));
    }
    if (showOriginal) {
      const at = pdfNow.current?.() ?? { page: originalPage.current ?? startPage, fraction: 0 };
      return { page: at.page, fraction: at.fraction, position: null, offset: 0, item: null, fragment: null, itemOffset: 0 };
    }
    const top = topSegment(typeof anchor === "number" ? anchor : undefined);
    const text = isEpubView && top ? placeOfPosition(epub.items, top.position) : null;
    return {
      page: isPdf && window ? readingPage() : null,
      fraction: 0,
      position: top?.position ?? null,
      offset: top?.offset ?? 0,
      item: text?.item ?? null,
      fragment: text?.fragment ?? null,
      itemOffset: 0,
    };
  };

  /** Moves the view to a place, in the mode the reader is in (the mode is never changed by a jump). */
  const goTo = (place: SourceLocation) => {
    if (showOriginal && isEpubView) {
      const at: EpubPlace | null =
        place.item !== null
          ? { item: place.item, fragment: place.fragment, offset: place.itemOffset }
          : place.position !== null
            ? placeOfPosition(epub.items, place.position)
            : null;
      if (at) setEpubJump({ ...at, nonce: ++jumps.current });
    } else if (showOriginal) {
      if (place.page !== null) setJump({ page: place.page, fraction: place.fraction, nonce: ++jumps.current });
    } else if (place.position !== null) {
      void goToPosition(place.position, place.offset);
    } else if (place.item !== null) {
      const position = positionOfPlace(epub.items, { item: place.item, fragment: place.fragment });
      if (position !== null) void goToPosition(position);
    } else if (place.page !== null) {
      void goToPage(place.page);
    }
  };

  /** A deliberate jump (a link, a contents entry): Back returns to where the reader was. */
  const jumpTo = (target: { page?: number; fraction?: number; position?: number; item?: string; fragment?: string | null }, from?: number | EpubPlace) => {
    // A link that leads outside the text leaves the reader where it is.
    if (target.position !== undefined && window && (target.position < 0 || target.position >= window.total)) {
      void api.logError("A link in the source could not be followed: it leads outside the text").catch(() => undefined);
      return;
    }
    let place: SourceLocation;
    if (isEpubView && target.item !== undefined) {
      place = epubPlace({ item: target.item, fragment: target.fragment ?? null, offset: 0 });
    } else if (isEpubView && target.position !== undefined) {
      place = epubPlace(placeOfPosition(epub.items, target.position), 0, target.position);
    } else {
      place = { page: target.page ?? null, fraction: target.fraction ?? 0, position: target.position ?? null, offset: 0, item: null, fragment: null, itemOffset: 0 };
    }
    commit(visit(historyRef.current, placeNow(from), place));
    if (!showOriginal && place.position !== null) void goToPosition(place.position);
    else goTo(place);
  };

  const goBack = () => {
    const step = stepBack(historyRef.current, placeNow());
    if (!step) return;
    commit(step.history);
    goTo(step.to);
  };
  const goForward = () => {
    const step = stepForward(historyRef.current, placeNow());
    if (!step) return;
    commit(step.history);
    goTo(step.to);
  };

  const chooseEntry = (item: ContentsItem) => {
    const target = item.target;
    if (!target) return;
    closeContents();
    // The mode is kept: Original moves its page (zoom unchanged), Reading shows that page's text.
    if (target.kind === "page") jumpTo({ page: target.page });
    else jumpTo({ position: target.position });
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
                links={links.get(segment.position)}
                references={references.get(segment.position)}
                onFollow={(position) => jumpTo({ position }, segment.position)}
                onOpenInBible={(reference) => openInBible(reference, positionNow())}
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
  const original = showOriginal && isPdf ? (
    !window && !error && openPage === null && initialPage === null ? null : (
      <PdfViewer
        key={`${sourceId}-${startPage}`}
        sourceId={sourceId}
        initialPage={startPage}
        onPageChange={(page) => {
          originalPage.current = page;
        }}
        jumpTo={jump}
        onOutline={adoptContents}
        onLink={(place) => jumpTo({ page: place.page, fraction: place.fraction })}
        locationRef={pdfNow}
      />
    )
  ) : null;

  // A web link in the formatted view: opened outside the app, on the click. It is neither a jump nor history.
  const openExternal = (url: string) => {
    setLinkFailed(false);
    api.openExternalLink(url).catch((e: unknown) => {
      // Technical detail goes to the log (the host only, never the path or query); the person sees a plain notice.
      void api.logError(`A web link could not be opened (${hostOf(url)}): ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
      setLinkFailed(true);
    });
  };

  const historyButtons = <HistoryButtons history={history} onBack={goBack} onForward={goForward} />;
  const epubViewer =
    showOriginal && isEpubView ? (
      epub.status === "ready" && epub.items.length > 0 ? (
        <>
          {linkFailed && (
            <div className="shrink-0 px-3 pt-2">
              <Notice tone="error">{t("library.formatted.linkFailed")}</Notice>
            </div>
          )}
          <EpubViewer
            key={sourceId}
            sourceId={sourceId}
            kind={viewKind === "docx" ? "docx" : "epub"}
            structure={epub.items}
            start={epubOpen ?? epubStart ?? { item: epub.items[0]!.id, fragment: null, offset: 0 }}
            jumpTo={epubJump}
            onLink={(target, from) => jumpTo({ item: target.item, fragment: target.id }, from)}
            onExternal={openExternal}
            locationRef={epubNow}
            onOpenInBible={(reference) => openInBible(reference, positionNow())}
          />
        </>
      ) : (
        <p className="m-0 p-6 text-text-muted">{t("library.original.loading")}</p>
      )
    ) : null;

  const modeSwitch = hasOriginal ? <ModeSwitch mode={mode} onChange={(m) => void choose(m)} /> : null;
  const contentsButton =
    contents.length > 0 ? (
      <Button ref={opener} variant="quiet" aria-expanded={panel !== null} aria-controls={panel ? `${id}-contents` : undefined} title={t("library.contents.show")} onClick={() => (panel ? closeContents() : openContents())}>
        <List className="size-4" aria-hidden="true" /> {t("library.contents.title")}
      </Button>
    ) : null;
  const contentsPanel = panel ? (
    <ContentsPanel id={`${id}-contents`} title={s?.title ?? ""} items={contents} currentId={panel.currentId} layout={contentsLayout} onSelect={chooseEntry} onClose={closeContents} />
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
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border-subtle px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-x-2">
            {historyButtons}
            {modeSwitch}
          </div>
          {contentsButton}
        </div>
        <div ref={stage} className="relative flex min-h-0 flex-1 flex-col">
          {showOriginal ? (
            (epubViewer ?? original)
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
        {historyButtons}
        {modeSwitch}
        {contentsButton}
      </div>
      <div ref={stage} className="relative flex min-h-0 flex-1 flex-col">
        {showOriginal ? (
          (epubViewer ?? original)
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

interface SegmentViewProps {
  segment: SourceSegment;
  previous?: SourceSegment;
  isTarget: boolean;
  targetRef?: React.MutableRefObject<HTMLElement | null>;
  /** The links in this segment's text, in order (internal ones only). */
  links?: SourceLink[];
  /** The Scripture references in this segment's text, in order. */
  references?: SourceReference[];
  onFollow: (position: number) => void;
  onOpenInBible: (reference: ScriptureRef) => void;
}

/**
 * The segment's text with its links as ordinary inline links (calm, plainly links, wrapping with the
 * text, reachable by keyboard) and its Scripture references as quiet "Open in Bible" actions. Text
 * between them is kept exactly. A span that overlaps one before it, or runs past the text, is shown as
 * plain text; a reference inside a link is left to the link (no control inside another).
 */
function linked(
  text: string,
  links: SourceLink[] | undefined,
  references: SourceReference[] | undefined,
  title: string,
  onFollow: (position: number) => void,
  onOpenInBible: (reference: ScriptureRef) => void,
): React.ReactNode {
  if ((!links || links.length === 0) && (!references || references.length === 0)) return text;
  type Span = { start: number; end: number; link?: SourceLink; reference?: SourceReference };
  const spans: Span[] = [
    ...(links ?? []).map((link): Span => ({ start: link.start, end: link.end, link })),
    ...(references ?? []).map((reference): Span => ({ start: reference.start, end: reference.end, reference })),
  ].sort((a, b) => a.start - b.start || (a.link ? -1 : 1) - (b.link ? -1 : 1));
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.start < at || span.end > text.length || span.start >= span.end) continue;
    if (span.start > at) out.push(text.slice(at, span.start));
    const written = text.slice(span.start, span.end);
    if (span.link) {
      const target = span.link.target;
      out.push(
        <a
          key={`l${span.start}-${span.end}`}
          href="#"
          title={title}
          onClick={(event) => {
            event.preventDefault();
            onFollow(target);
          }}
          className="cursor-pointer text-link underline underline-offset-2 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          {written}
        </a>,
      );
    } else if (span.reference) {
      out.push(
        <ScriptureReference key={`r${span.start}-${span.end}`} reference={span.reference.reference} onOpen={onOpenInBible}>
          {written}
        </ScriptureReference>,
      );
    }
    at = span.end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function SegmentView({ segment, previous, isTarget, targetRef, links, references, onFollow, onOpenInBible }: SegmentViewProps) {
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
        {linked(segment.text, links, references, t("library.links.follow"), onFollow, onOpenInBible)}
      </p>
      {isTarget && <PassageLinkNote segmentId={segment.id} />}
    </>
  );
}

/** Back / Forward through the places a reader has jumped between: small, never dominant. */
function HistoryButtons({ history, onBack, onForward }: { history: ReaderHistory; onBack: () => void; onForward: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t("library.history.group")} className="flex shrink-0 items-center">
      <Button variant="quiet" aria-label={t("library.history.back")} title={t("library.history.back")} disabled={!canGoBack(history)} onClick={onBack}>
        <Undo2 className="size-4" aria-hidden="true" />
      </Button>
      <Button variant="quiet" aria-label={t("library.history.forward")} title={t("library.history.forward")} disabled={!canGoForward(history)} onClick={onForward}>
        <Redo2 className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

const NO_LINKS = new Map<number, SourceLink[]>();
const NO_REFERENCES = new Map<number, SourceReference[]>();

/**
 * The Scripture references written in a source's text, grouped by segment
 * (in order along it): read once per source from the stored index, never by
 * parsing the text again. A read that fails gives none, and the text reads as before.
 */
function useSourceReferences(sourceId: string | undefined): Map<number, SourceReference[]> {
  const api = useApi();
  const [found, setFound] = useState<{ id: string; references: Map<number, SourceReference[]> } | null>(null);
  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    api.librarySourceReferences(sourceId).then(
      (all) => {
        if (!active) return;
        const by = new Map<number, SourceReference[]>();
        for (const r of all) by.set(r.position, [...(by.get(r.position) ?? []), r]);
        setFound({ id: sourceId, references: by });
      },
      (e) => void api.logError(`Scripture references in the source could not be read: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined),
    );
    return () => {
      active = false;
    };
  }, [api, sourceId]);
  return found && found.id === sourceId ? found.references : NO_REFERENCES;
}

/**
 * The links in an EPUB's extracted text, grouped by the segment they are in
 * (in order along it). Read once per source; a source without links, another
 * format, or a read that fails gives none, and the text reads as before.
 */
function useSourceLinks(source: { id: string; format: string | null } | null | undefined): Map<number, SourceLink[]> {
  const api = useApi();
  const [found, setFound] = useState<{ id: string; links: Map<number, SourceLink[]> } | null>(null);
  const id = source?.id;
  const isEpub = source?.format === "epub";
  useEffect(() => {
    if (!id || !isEpub) return;
    let active = true;
    api.librarySourceLinks(id).then(
      (all) => {
        if (!active) return;
        const by = new Map<number, SourceLink[]>();
        for (const link of all) by.set(link.position, [...(by.get(link.position) ?? []), link]);
        for (const list of by.values()) list.sort((a, b) => a.start - b.start);
        setFound({ id, links: by });
      },
      (e) => void api.logError(`Links in the source could not be read: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined),
    );
    return () => {
      active = false;
    };
  }, [api, id, isEpub]);
  return found && found.id === id ? found.links : NO_LINKS;
}
