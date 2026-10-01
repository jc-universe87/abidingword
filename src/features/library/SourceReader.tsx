import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Maximize2 } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { SegmentWindow, SourceSegment } from "@/types/library";
import { FORMAT_LABELS, LICENCE_LABELS, SOURCE_TYPE_LABELS } from "./labels";

interface SourceReaderProps {
  sourceId: string;
  segmentId?: string;
  onClose: () => void;
  /**
   * "page" (default): the full-width reader that replaces the workspace.
   * "pane": inside the Sources pane, beside Scripture and the Study, with
   * "Open full reader" to switch to the page.
   */
  variant?: "page" | "pane";
  /** Pane only: open this source in the full-width reader. */
  onExpand?: () => void;
}

/**
 * A plain reader for a library source, for context and checking citations:
 * extracted text with page markers (PDF) or section headings (EPUB,
 * Markdown). Opens at an exact segment and loads more around it on demand.
 */
export function SourceReader({ sourceId, segmentId, onClose, variant = "page", onExpand }: SourceReaderProps) {
  const api = useApi();
  const id = useId();
  const source = useLoad(useCallback(() => api.libraryGetSource(sourceId), [api, sourceId]));
  const [window, setWindow] = useState<SegmentWindow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    const load = segmentId ? api.libraryOpenSegment(segmentId) : api.sourceGetSegments({ sourceId });
    load.then((w) => active && setWindow(w), (e) => active && setError(toApiError(e).message));
    return () => {
      active = false;
    };
  }, [api, sourceId, segmentId]);

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
          <Title
            id={`${id}-title`}
            ref={heading}
            tabIndex={-1}
            className={`m-0 font-display font-heading text-text-strong ${inPane ? "text-[1.375rem] leading-snug" : "text-[1.875rem]"}`}
          >
            {s.title}
          </Title>
          {s.author && <p className="reading m-0">{s.author}</p>}
          <p className="m-0 text-[0.9375rem] text-text-muted">
            {[SOURCE_TYPE_LABELS[s.sourceType], s.format ? FORMAT_LABELS[s.format] : null, s.pageCount ? `${s.pageCount} pages` : null, s.language, s.publisher, s.isbn ? `ISBN ${s.isbn}` : null].filter(Boolean).join(" · ")}
          </p>
          <p className="m-0 text-[0.9375rem] text-text-muted">{LICENCE_LABELS[s.licenceStatus]}{s.originalFilename ? ` · from “${s.originalFilename}”` : ""}</p>
        </header>
      )}
      {window && (
        <div className="flex flex-col gap-3">
          {window.offset > 0 && <Button className="self-start" onClick={() => more("earlier")}>Show earlier text</Button>}
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
            <Button className="self-start" onClick={() => more("later")}>Show more text</Button>
          )}
        </div>
      )}
    </>
  );

  if (inPane) {
    return (
      <section aria-labelledby={`${id}-title`} className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
          <Button variant="quiet" onClick={onClose}>
            <ArrowLeft className="size-4" aria-hidden="true" /> Back to Sources
          </Button>
          {onExpand && (
            <Button variant="quiet" onClick={onExpand} title="Read this source at full width">
              <Maximize2 className="size-4" aria-hidden="true" /> Open full reader
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 px-5 pb-16 pt-5">{body}</div>
        </div>
      </section>
    );
  }

  return (
    <main aria-labelledby={`${id}-title`} className="min-h-0 flex-1 overflow-y-auto bg-bg">
      <div className="mx-auto flex max-w-[46rem] flex-col gap-6 px-8 pb-24 pt-8">
        <Button variant="quiet" className="self-start" onClick={onClose}>
          <ArrowLeft className="size-4" aria-hidden="true" /> Back
        </Button>
        {body}
      </div>
    </main>
  );
}

function SegmentView({ segment, previous, isTarget, targetRef }: { segment: SourceSegment; previous?: SourceSegment; isTarget: boolean; targetRef?: React.MutableRefObject<HTMLElement | null> }) {
  const newPage = segment.pageNumber !== null && segment.pageNumber !== previous?.pageNumber;
  const newSection = segment.pageNumber === null && segment.sectionPath && segment.sectionPath !== previous?.sectionPath;
  return (
    <>
      {newPage && (
        <p className="m-0 mt-2 border-t border-border-subtle pt-2 font-ui text-[0.875rem] font-medium text-text-muted" aria-label={`Page ${segment.pageLabel ?? segment.pageNumber}`}>
          p. {segment.pageLabel ?? segment.pageNumber}
        </p>
      )}
      {newSection && <p className="m-0 mt-3 font-display text-[1.125rem] font-heading text-text-strong">{segment.sectionPath}</p>}
      <p
        ref={targetRef as React.RefObject<HTMLParagraphElement> | undefined}
        tabIndex={isTarget ? -1 : undefined}
        data-target={isTarget || undefined}
        className={`m-0 ${isTarget ? "border-l-[3px] border-accent bg-note px-3 py-1" : ""}`}
      >
        {segment.text}
      </p>
    </>
  );
}
