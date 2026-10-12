import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { formatNumber } from "@/i18n/format";
import { useApi } from "@/lib/ApiContext";
import type { EpubItem, EpubStructureItem, SourceAnnotation } from "@/types/library";
import { placeSegments, storedToPage, type PageSegment } from "@/lib/pdfTextMatch";
import type { DetectedReference, ScriptureRef } from "@/types/scripture";
import { drawnStrings, EpubDocument, pageTexts, type EpubLinkTarget, type TextMark } from "./epubDocument";
import type { EpubPlace } from "./epubLocation";

/** Pages kept after being read, so going back to one is immediate. */
const KEPT = 6;

interface EpubViewerProps {
  sourceId: string;
  /** Which core builds the pages. */
  kind?: "epub" | "docx";
  structure: EpubStructureItem[];
  /** Where to open. */
  start: EpubPlace;
  /** Go here without reopening. A new `nonce` is a new request. */
  jumpTo?: (EpubPlace & { nonce: number }) | null;
  /** A link in the page was followed. */
  onLink: (target: EpubLinkTarget, from: EpubPlace) => void;
  /** A link to the web was clicked: open it outside the app. Not history, not a jump. Absent: web links are plain text. */
  onExternal?: (url: string) => void;
  /** Filled with a way to ask where the view is now, for the reader's history. */
  locationRef: React.MutableRefObject<(() => EpubPlace) | null>;
  /** "Open in Bible" on a Scripture reference in the page. Absent: references are plain text. */
  onOpenInBible?: (reference: ScriptureRef) => void;
  /**
   * The source's marks (v0.14): drawn where their stored words are placed exactly on the page's
   * text (the same placement as an original PDF's), never elsewhere. Absent: none are drawn.
   */
  marks?: SourceAnnotation[];
  /** Bring this mark into view once its page is drawn. A new `nonce` is a new request. */
  revealMark?: { id: string; nonce: number } | null;
}

/** Reads `count` stored paragraphs from `from`, in pages the core allows. */
async function readParagraphs(read: (offset: number, limit: number) => Promise<PageSegment[]>, from: number, count: number): Promise<PageSegment[]> {
  const out: PageSegment[] = [];
  for (let at = from; at < from + count; at += 500) out.push(...(await read(at, Math.min(500, from + count - at))));
  return out;
}

/**
 * The book as its publication lays it out: one reading-order document at a
 * time, continuously scrolled, in a light sheet (like a PDF page), under the
 * reader's own toolbar. Moving between documents, following a link or
 * choosing Contents keeps the reader's state: only the page changes. This is
 * a place to read the source as published; search and citations stay with the
 * extracted text. Scripture references in the page's text are found by the core,
 * in the source's language, one page at a time, and drawn as "Open in Bible".
 */
export function EpubViewer({ sourceId, kind = "epub", structure, start, jumpTo, onLink, onExternal, locationRef, onOpenInBible, marks, revealMark }: EpubViewerProps) {
  const { t } = useTranslation();
  const api = useApi();
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<ShadowRoot | null>(null);
  const cache = useRef(new Map<string, EpubItem>());
  // The Scripture references in each kept page's text, by text; found once per page.
  const referenceCache = useRef(new Map<string, Map<string, DetectedReference[]>>());
  const [pageReferences, setPageReferences] = useState<{ id: string; found: Map<string, DetectedReference[]> } | null>(null);
  const linksScripture = onOpenInBible !== undefined;
  const [request, setRequest] = useState<{ place: EpubPlace; nonce: number }>({ place: start, nonce: 0 });
  const [current, setCurrent] = useState<EpubItem | null>(null);
  const [failed, setFailed] = useState(false);
  const [seen, setSeen] = useState(jumpTo?.nonce ?? 0);
  const applied = useRef(-1);
  // Set when a link was followed from the keyboard: the place it leads to takes focus if the page it was in is gone.
  const focusArrival = useRef(false);
  // Bumped when a page's content has been drawn, so a wanted place is looked for again (see below).
  const [, setDrawn] = useState(0);
  const onDrawn = useCallback(() => setDrawn((n) => n + 1), []);
  const wantedItem = request.place.item;

  // A request from outside (Contents, Back / Forward): adjust during rendering, not in an effect.
  if (jumpTo && jumpTo.nonce !== seen) {
    setSeen(jumpTo.nonce);
    setRequest({ place: { item: jumpTo.item, fragment: jumpTo.fragment, offset: jumpTo.offset }, nonce: jumpTo.nonce + 1 });
  }

  // Bring in the document that is wanted (from the pages kept, or from the core).
  useEffect(() => {
    let active = true;
    const kept = cache.current.get(wantedItem);
    if (kept) {
      queueMicrotask(() => active && (setFailed(false), setCurrent(kept)));
      return () => {
        active = false;
      };
    }
    (kind === "docx" ? api.libraryDocxItem(sourceId, wantedItem) : api.libraryEpubItem(sourceId, wantedItem)).then(
      (item) => {
        if (!active) return;
        cache.current.set(item.id, item);
        while (cache.current.size > KEPT) cache.current.delete(cache.current.keys().next().value as string);
        setFailed(false);
        setCurrent(item);
      },
      (error: unknown) => {
        if (!active) return;
        // Technical detail goes to the log (the document's id only, never its text); the interface shows its own wording.
        void api.logError(`Formatted ${kind === "docx" ? "DOCX" : "EPUB"} page could not be shown: ${error instanceof Error ? error.message : String(error)} (source ${sourceId}, page ${wantedItem})`).catch(() => undefined);
        setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [api, kind, sourceId, wantedItem]);

  const structureRef = useRef(structure);
  useEffect(() => {
    structureRef.current = structure;
  }, [structure]);
  // Find the Scripture references in the page shown (once per page; a failure leaves the text plain).
  const currentId = current?.id;
  const currentNodes = current?.nodes;
  useEffect(() => {
    if (!linksScripture || !currentId || !currentNodes) return;
    let active = true;
    const kept = referenceCache.current.get(currentId);
    if (kept) {
      queueMicrotask(() => active && setPageReferences({ id: currentId, found: kept }));
      return () => {
        active = false;
      };
    }
    const texts = pageTexts(currentNodes);
    if (texts.length === 0) return;
    // The document's place among the imported segments: bookless references ("15:4") are linked as the imported text resolved them there.
    const part = structureRef.current.find((s) => s.id === currentId);
    const scope = part ? { from: part.startSegment, to: part.startSegment + part.segmentCount } : undefined;
    api.libraryDetectReferences(sourceId, texts, scope).then(
      (lists) => {
        const found = new Map<string, DetectedReference[]>();
        lists.forEach((list, i) => {
          const text = texts[i];
          if (text !== undefined && list.length > 0) found.set(text, list);
        });
        referenceCache.current.set(currentId, found);
        while (referenceCache.current.size > KEPT) referenceCache.current.delete(referenceCache.current.keys().next().value as string);
        if (active) setPageReferences({ id: currentId, found });
      },
      (error: unknown) => void api.logError(`Scripture references in a formatted page could not be found: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined),
    );
    return () => {
      active = false;
    };
  }, [api, sourceId, linksScripture, currentId, currentNodes]);

  // The stored paragraphs of each page (v0.14), read once per page while marks are shown.
  const paragraphCache = useRef(new Map<string, Promise<PageSegment[]>>());
  const [pageParagraphs, setPageParagraphs] = useState<{ id: string; list: PageSegment[] } | null>(null);
  const showsMarks = marks !== undefined;
  useEffect(() => {
    if (!showsMarks || !currentId) return;
    const part = structureRef.current.find((s) => s.id === currentId);
    if (!part || part.segmentCount === 0) return;
    let active = true;
    let load = paragraphCache.current.get(currentId);
    if (!load) {
      load = readParagraphs(
        (offset, limit) => api.sourceGetSegments({ sourceId, offset, limit }).then((w) => w.segments.map((x) => ({ segmentId: x.id, position: x.position, text: x.text }))),
        part.startSegment,
        part.segmentCount,
      ).catch((error: unknown) => {
        paragraphCache.current.delete(currentId);
        void api.logError(`Marks could not be placed on a formatted page: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined);
        return [];
      });
      paragraphCache.current.set(currentId, load);
    }
    void load.then((list) => active && setPageParagraphs({ id: currentId, list }));
    return () => {
      active = false;
    };
  }, [api, sourceId, showsMarks, currentId]);

  // The marks on this page, by the text piece they are on: only words placed exactly are drawn.
  const textMarks = useMemo(() => {
    if (!marks || !current || pageParagraphs?.id !== current.id) return undefined;
    const strings = drawnStrings(current.nodes);
    const starts: number[] = [];
    let total = 0;
    for (const piece of strings) {
      starts.push(total);
      total += piece.length;
    }
    const placement = placeSegments(strings.join(""), pageParagraphs.list);
    const out = new Map<number, TextMark[]>();
    for (const mark of marks) {
      const { start, end } = mark;
      if (mark.state === "unresolved" || mark.kind === "bookmark" || mark.quote === null || !start || !end || start.offset === null || end.offset === null) continue;
      for (const p of pageParagraphs.list) {
        if (p.position < start.position || p.position > end.position) continue;
        const range = storedToPage(placement, p.segmentId, p.position === start.position ? start.offset : 0, p.position === end.position ? end.offset : p.text.length);
        if (!range) continue;
        strings.forEach((piece, i) => {
          const from = Math.max(range[0], starts[i]!);
          const to = Math.min(range[1], starts[i]! + piece.length);
          if (from >= to) return;
          const list = out.get(i) ?? [];
          list.push({ id: mark.id, start: from - starts[i]!, end: to - starts[i]!, color: mark.kind === "highlight" ? mark.color : null, note: mark.kind === "note" });
          out.set(i, list);
        });
      }
    }
    return out;
  }, [marks, current, pageParagraphs]);

  const onRoot = useCallback((shadow: ShadowRoot | null) => {
    root.current = shadow;
  }, []);

  // Once the wanted page is drawn: put the wanted element where the request says (or the top).
  useLayoutEffect(() => {
    const view = scroller.current;
    if (!view || !current || current.id !== request.place.item || applied.current === request.nonce) return;
    const shadow = root.current;
    // A new page's content is drawn one render after its shadow root exists: wait for it, or the place is not found.
    if (!shadow || !shadow.querySelector(".aw-doc")) return;
    applied.current = request.nonce;
    const { fragment, offset } = request.place;
    const target = fragment !== null ? shadow.getElementById(fragment) : null;
    if (target) {
      target.scrollIntoView?.({ block: "start" });
      const gap = target.getBoundingClientRect().top - view.getBoundingClientRect().top;
      view.scrollTop += gap - offset;
    } else {
      view.scrollTop = Math.max(0, -offset);
    }
    if (focusArrival.current) {
      focusArrival.current = false;
      // Only when focus was lost with the old page (a link in the same page keeps it).
      if (!document.activeElement || document.activeElement === document.body) {
        // An empty marker (a bookmark) is not a place to stand: the block around it, or after it, is.
        const doc = shadow.querySelector(".aw-doc");
        let spot: HTMLElement = target ?? view;
        if (target && target.childNodes.length === 0) {
          const around = target.parentElement;
          spot = (around && around !== doc ? around : (target.nextElementSibling as HTMLElement | null)) ?? view;
        }
        // A temporary stop, not a permanent one: ordinary text does not become a tab stop.
        if (spot !== view && !spot.hasAttribute("tabindex")) {
          spot.setAttribute("tabindex", "-1");
          spot.addEventListener("blur", () => spot.removeAttribute("tabindex"), { once: true });
        }
        spot.focus({ preventScroll: true });
      }
    }
  });

  // A mark chosen elsewhere (the Marks list): into view once its page has drawn it.
  const revealed = useRef(-1);
  useLayoutEffect(() => {
    // After the jump that goes with it has put the page in place (the effect above).
    if (!revealMark || revealed.current === revealMark.nonce || applied.current !== request.nonce) return;
    const spot = root.current?.querySelector<HTMLElement>(`mark[data-mark-id="${revealMark.id.replace(/["\\]/g, "")}"]`);
    if (!spot) return;
    revealed.current = revealMark.nonce;
    spot.scrollIntoView?.({ block: "center" });
  });

  // Where the view is, on request: the last element with an id at or above the top of the view, and how far it is from it.
  useEffect(() => {
    locationRef.current = () => {
      const view = scroller.current;
      const shadow = root.current;
      const item = current?.id ?? wantedItem;
      if (!view || !shadow) return { item, fragment: null, offset: 0 };
      const top = view.getBoundingClientRect().top;
      let fragment: string | null = null;
      let offset = -view.scrollTop;
      for (const el of shadow.querySelectorAll<HTMLElement>("[id]")) {
        const gap = el.getBoundingClientRect().top - top;
        if (gap > 1) break;
        fragment = el.id;
        offset = Math.round(gap);
      }
      return { item, fragment, offset };
    };
    return () => {
      locationRef.current = null;
    };
  }, [locationRef, current, wantedItem]);

  const index = Math.max(0, structure.findIndex((s) => s.id === (current?.id ?? wantedItem)));
  const go = (to: number) => {
    const target = structure[to];
    if (!target) return;
    focusArrival.current = false;
    setRequest((r) => ({ place: { item: target.id, fragment: null, offset: 0 }, nonce: r.nonce + 1 }));
  };

  // Kept in a ref so a long page is not redrawn each time the reader around it changes.
  const onLinkRef = useRef(onLink);
  useEffect(() => {
    onLinkRef.current = onLink;
  });
  const onExternalRef = useRef(onExternal);
  useEffect(() => {
    onExternalRef.current = onExternal;
  });
  const external = useCallback((url: string) => onExternalRef.current?.(url), []);
  const onOpenInBibleRef = useRef(onOpenInBible);
  useEffect(() => {
    onOpenInBibleRef.current = onOpenInBible;
  });
  const scripture = useCallback((reference: ScriptureRef) => onOpenInBibleRef.current?.(reference), []);
  const follow = useCallback(
    (target: EpubLinkTarget) => {
      const from = locationRef.current?.() ?? { item: wantedItem, fragment: null, offset: 0 };
      focusArrival.current = target.keyboard === true;
      onLinkRef.current(target, from);
    },
    [locationRef, wantedItem],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="epub-viewer">
      <div
        role="toolbar"
        aria-label={t("library.original.toolbar")}
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle bg-bg px-3 py-1.5 font-ui text-[0.9375rem]"
      >
        <div className="flex items-center gap-1">
          <Button variant="quiet" aria-label={t("library.formatted.previousPart")} title={t("library.formatted.previousPart")} disabled={index <= 0} onClick={() => go(index - 1)}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <span role="status" className="min-w-24 text-center tabular-nums">
            {t("library.formatted.partOf", { part: formatNumber(index + 1), total: formatNumber(structure.length) })}
          </span>
          <Button variant="quiet" aria-label={t("library.formatted.nextPart")} title={t("library.formatted.nextPart")} disabled={index >= structure.length - 1} onClick={() => go(index + 1)}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div ref={scroller} role="region" aria-label={t("library.original.viewerLabel")} tabIndex={0} className="relative min-h-0 flex-1 overflow-auto bg-bg-secondary">
        {failed && (
          <div className="p-6">
            <Notice tone="error">{kind === "docx" ? t("library.formatted.failedDocument") : t("library.formatted.failed")}</Notice>
          </div>
        )}
        {!failed && !current && <p className="m-0 p-6 text-text-muted">{t("library.original.loading")}</p>}
        {current && (
          <>
            {current.missingImages > 0 && (
              <p className="m-0 mx-auto max-w-[46rem] px-6 pt-3 text-[0.875rem] text-text-muted">{t("library.formatted.missingImages", { count: current.missingImages })}</p>
            )}
            <EpubDocument key={current.id} item={current} onLink={follow} onExternal={onExternal ? external : undefined} tableLabel={t("library.formatted.table")} onRoot={onRoot}
              onDrawn={onDrawn}
              references={pageReferences?.id === current.id ? pageReferences.found : undefined}
              onScripture={linksScripture ? scripture : undefined}
              marks={textMarks}
            />
          </>
        )}
      </div>
    </div>
  );
}
