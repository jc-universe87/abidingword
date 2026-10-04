import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { formatNumber } from "@/i18n/format";
import { useApi } from "@/lib/ApiContext";
import type { EpubItem, EpubStructureItem } from "@/types/library";
import { EpubDocument, type EpubLinkTarget } from "./epubDocument";
import type { EpubPlace } from "./epubLocation";

/** Pages kept after being read, so going back to one is immediate. */
const KEPT = 6;

interface EpubViewerProps {
  sourceId: string;
  structure: EpubStructureItem[];
  /** Where to open. */
  start: EpubPlace;
  /** Go here without reopening. A new `nonce` is a new request. */
  jumpTo?: (EpubPlace & { nonce: number }) | null;
  /** A link in the page was followed. */
  onLink: (target: EpubLinkTarget, from: EpubPlace) => void;
  /** Filled with a way to ask where the view is now, for the reader's history. */
  locationRef: React.MutableRefObject<(() => EpubPlace) | null>;
}

/**
 * The book as its publication lays it out: one reading-order document at a
 * time, continuously scrolled, in a light sheet (like a PDF page), under the
 * reader's own toolbar. Moving between documents, following a link or
 * choosing Contents keeps the reader's state: only the page changes. This is
 * a place to read the source as published; search, citations and Scripture
 * links stay with the extracted text.
 */
export function EpubViewer({ sourceId, structure, start, jumpTo, onLink, locationRef }: EpubViewerProps) {
  const { t } = useTranslation();
  const api = useApi();
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<ShadowRoot | null>(null);
  const cache = useRef(new Map<string, EpubItem>());
  const [request, setRequest] = useState<{ place: EpubPlace; nonce: number }>({ place: start, nonce: 0 });
  const [current, setCurrent] = useState<EpubItem | null>(null);
  const [failed, setFailed] = useState(false);
  const [seen, setSeen] = useState(jumpTo?.nonce ?? 0);
  const applied = useRef(-1);
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
    api.libraryEpubItem(sourceId, wantedItem).then(
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
        void api.logError(`Formatted EPUB page could not be shown: ${error instanceof Error ? error.message : String(error)} (source ${sourceId}, page ${wantedItem})`).catch(() => undefined);
        setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [api, sourceId, wantedItem]);

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
    setRequest((r) => ({ place: { item: target.id, fragment: null, offset: 0 }, nonce: r.nonce + 1 }));
  };

  // Kept in a ref so a long page is not redrawn each time the reader around it changes.
  const onLinkRef = useRef(onLink);
  useEffect(() => {
    onLinkRef.current = onLink;
  });
  const follow = useCallback(
    (target: EpubLinkTarget) => {
      const from = locationRef.current?.() ?? { item: wantedItem, fragment: null, offset: 0 };
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
            <Notice tone="error">{t("library.formatted.failed")}</Notice>
          </div>
        )}
        {!failed && !current && <p className="m-0 p-6 text-text-muted">{t("library.original.loading")}</p>}
        {current && (
          <>
            {current.missingImages > 0 && (
              <p className="m-0 mx-auto max-w-[46rem] px-6 pt-3 text-[0.875rem] text-text-muted">{t("library.formatted.missingImages", { count: current.missingImages })}</p>
            )}
            <EpubDocument key={current.id} item={current} onLink={follow} tableLabel={t("library.formatted.table")} onRoot={onRoot} onDrawn={onDrawn} />
          </>
        )}
      </div>
    </div>
  );
}
