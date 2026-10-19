import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Highlighter, StickyNote } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { bookName, referenceLabel } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { SWATCH_CLASS } from "@/lib/annotationRender";
import { locatorLabel, quotationWithCitation } from "@/features/library/labels";
import { ActionMenu } from "@/design-system/ActionMenu";
import { AddToStudyPanel } from "@/features/studies/AddToStudyPanel";
import { copyText } from "@/lib/clipboard";
import { HIGHLIGHT_COLORS, type Annotation, type AnnotationKind, type BibleTranslation, type HighlightColor } from "@/types/scripture";
import type { MarkedSource, SourceMark } from "@/types/library";
import { useScripture } from "./ScriptureContext";

type KindFilter = "all" | AnnotationKind;
const KINDS: KindFilter[] = ["all", "note", "highlight", "bookmark"];
/** Where marks come from: the Bible (v0.5), the person's sources (v0.14), or both. */
type Scope = "all" | "bible" | "sources";
const SCOPES: Scope[] = ["all", "bible", "sources"];
const PAGE = 30;

interface MarksViewProps {
  translation: BibleTranslation;
  /** Show this mark in the Bible. */
  onOpen: (mark: Annotation) => void;
  /** Open a source at this mark. */
  onOpenSource: (mark: SourceMark) => void;
}

const pill =
  "min-h-9 rounded-full border border-border px-3 font-ui text-[0.9375rem] text-text-strong hover:bg-bg-secondary aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-on-primary";
const select = "h-9 min-w-0 max-w-full rounded-aw border border-border bg-bg px-2";

/**
 * Everything the reader has marked: notes, highlights and bookmarks in the
 * Bible and in their sources, with a few plain ways to narrow it. A mark is a
 * way back to its place; richer editing stays where the place is. Bible marks
 * are in Scripture order; source marks by source, then in reading order.
 */
export function MarksView({ translation, onOpen, onOpenSource }: MarksViewProps) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const { books } = useScripture();
  const [scope, setScope] = useState<Scope>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [book, setBook] = useState("");
  const [source, setSource] = useState("");
  const [color, setColor] = useState<HighlightColor | "">("");
  const [text, setText] = useState("");
  const [sources, setSources] = useState<MarkedSource[]>([]);

  useEffect(() => {
    if (scope !== "sources") return;
    let active = true;
    api.sourceMarksSources().then(
      (list) => active && setSources(list),
      () => active && setSources([]),
    );
    return () => {
      active = false;
    };
  }, [api, scope]);

  const query = text.trim() || undefined;
  const chosenColor = kind === "highlight" && color ? color : undefined;
  const chosenKind = kind === "all" ? undefined : kind;
  const both = scope === "all";
  // Both lists together: an empty one is left out, and when both are empty one message says so.
  const [counts, setCounts] = useState<{ bible: number | null; sources: number | null }>({ bible: null, sources: null });
  const reportBible = useCallback((n: number | null) => setCounts((c) => (c.bible === n ? c : { ...c, bible: n })), []);
  const reportSources = useCallback((n: number | null) => setCounts((c) => (c.sources === n ? c : { ...c, sources: n })), []);
  const bothEmpty = both && counts.bible === 0 && counts.sources === 0;

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <h2 id={`${id}-title`} className="m-0 font-display text-[1.5rem] font-heading text-text-strong">
        {t("scripture.marks.title")}
      </h2>

      <div className="flex flex-col gap-3">
        <div role="group" aria-label={t("scripture.marks.scope.label")} className="flex flex-wrap gap-1.5">
          {SCOPES.map((s) => (
            <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)} className={pill}>
              {t(`scripture.marks.scope.${s}`)}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t("scripture.marks.kindLabel")} className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={pill}>
              {t(`scripture.marks.kind.${k}`)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-2">
          {scope === "bible" && (
            <label className="flex min-w-0 items-center gap-2 text-[0.9375rem]">
              <span>{t("scripture.marks.book")}</span>
              <select value={book} onChange={(e) => setBook(e.target.value)} className={select}>
                <option value="">{t("scripture.marks.allBooks")}</option>
                {books.map((b) => (
                  <option key={b.code} value={b.code}>{bookName(b.code, b.name)}</option>
                ))}
              </select>
            </label>
          )}
          {scope === "sources" && sources.length > 0 && (
            <label className="flex min-w-0 items-center gap-2 text-[0.9375rem]">
              <span>{t("scripture.marks.source")}</span>
              <select value={source} onChange={(e) => setSource(e.target.value)} className={select}>
                <option value="">{t("scripture.marks.allSources")}</option>
                {sources.map((s) => (
                  <option key={s.sourceId} value={s.sourceId}>{s.title}</option>
                ))}
              </select>
            </label>
          )}
          {kind === "highlight" && (
            <label className="flex min-w-0 items-center gap-2 text-[0.9375rem]">
              <span>{t("scripture.marks.color")}</span>
              <select value={color} onChange={(e) => setColor(e.target.value as HighlightColor | "")} className={select}>
                <option value="">{t("scripture.marks.anyColor")}</option>
                {HIGHLIGHT_COLORS.map((c) => (
                  <option key={c} value={c}>{t(`scripture.colors.${c}`)}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {(kind === "all" || kind === "note") && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-search`} className="sr-only">{t("scripture.marks.search")}</label>
            <input
              id={`${id}-search`}
              type="search"
              value={text}
              placeholder={t("scripture.marks.searchPlaceholder")}
              onChange={(e) => setText(e.target.value)}
              className="h-10 w-full min-w-0 rounded-aw border border-border bg-bg px-3 text-[0.9375rem]"
            />
          </div>
        )}
      </div>

      {bothEmpty &&
        (query ? (
          <p className="reading m-0 text-text-muted">{t("scripture.marks.empty.noSearch")}</p>
        ) : chosenKind || chosenColor ? (
          <p className="reading m-0 text-text-muted">{t("scripture.marks.empty.noMatch")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="reading m-0 text-text-strong">{t("scripture.marks.empty.none")}</p>
            <p className="m-0 text-[0.9375rem] text-text-muted">{t("scripture.marks.empty.noneBody")}</p>
          </div>
        ))}
      {scope !== "sources" && (
        <BibleMarks
          heading={both ? t("scripture.marks.sectionBible") : null}
          together={both}
          filters={{ kind: chosenKind, book: scope === "bible" ? book || undefined : undefined, color: chosenColor, query, translationId: translation.id }}
          filtered={!!(chosenKind || (scope === "bible" && book) || chosenColor)}
          onOpen={onOpen}
          onCount={reportBible}
        />
      )}
      {scope !== "bible" && (
        <SourceMarks
          heading={both ? t("scripture.marks.sectionSources") : null}
          together={both}
          filters={{ kind: chosenKind, sourceId: scope === "sources" ? source || undefined : undefined, color: chosenColor, query }}
          filtered={!!(chosenKind || (scope === "sources" && source) || chosenColor)}
          onOpen={onOpenSource}
          onCount={reportSources}
        />
      )}
    </section>
  );
}

/** A paged list kept by request number: an answer to an older choice is ignored. "Load more" focuses what arrived. */
function usePagedMarks<T>(key: string, load: (offset: number) => Promise<{ marks: T[]; hasMore: boolean }>) {
  const [page, setPage] = useState<{ marks: T[]; hasMore: boolean; ready: boolean }>({ marks: [], hasMore: false, ready: false });
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);
  const list = useRef<HTMLUListElement>(null);
  const focusFrom = useRef<number | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useLayoutEffect(() => {
    if (focusFrom.current === null) return;
    list.current?.querySelectorAll<HTMLElement>(":scope > li > button")[focusFrom.current]?.focus();
    focusFrom.current = null;
  }, [page.marks.length]);
  useEffect(() => {
    const mine = ++request.current;
    loadRef.current(0).then(
      (result) => {
        if (mine !== request.current) return;
        setError(null);
        setPage({ marks: result.marks, hasMore: result.hasMore, ready: true });
      },
      (e) => mine === request.current && setError(toApiError(e).message),
    );
  }, [key]);
  const loadMore = useCallback(async () => {
    const mine = request.current;
    setLoadingMore(true);
    try {
      const result = await loadRef.current(page.marks.length);
      if (mine !== request.current) return;
      focusFrom.current = page.marks.length;
      setPage((p) => ({ marks: [...p.marks, ...result.marks], hasMore: result.hasMore, ready: true }));
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setLoadingMore(false);
    }
  }, [page.marks.length]);
  return { page, error, loadingMore, loadMore, list };
}

interface ListFrameProps {
  heading: string | null;
  /** Shown with the other list: nothing at all when empty (the view says it once for both). */
  together: boolean;
  ready: boolean;
  count: number;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  empty: React.ReactNode;
  children: React.ReactNode;
}

function ListFrame({ heading, together, ready, count, error, hasMore, loadingMore, onLoadMore, empty, children }: ListFrameProps) {
  const { t } = useTranslation();
  if (together && ready && count === 0 && !error) return null;
  return (
    <div className="flex flex-col gap-3">
      {heading && <h3 className="m-0 font-display text-[1.125rem] font-heading text-text-strong">{heading}</h3>}
      {error && <Notice tone="error">{error}</Notice>}
      {!ready && !error && <p role="status" className="m-0 text-text-muted">{t("scripture.marks.loading")}</p>}
      <p role="status" className="sr-only">{ready ? t("scripture.marks.count", { count }) : ""}</p>
      {ready && count === 0 && !together && empty}
      {children}
      {hasMore && (
        <Button className="self-start" onClick={onLoadMore} disabled={loadingMore}>
          {t("scripture.marks.loadMore")}
        </Button>
      )}
    </div>
  );
}

interface BibleMarksProps {
  heading: string | null;
  together: boolean;
  onCount: (count: number | null) => void;
  filters: { kind?: AnnotationKind; book?: string; color?: HighlightColor; query?: string; translationId: string };
  filtered: boolean;
  onOpen: (mark: Annotation) => void;
}

function BibleMarks({ heading, together, filters, filtered, onOpen, onCount }: BibleMarksProps) {
  const { t } = useTranslation();
  const api = useApi();
  const { books } = useScripture();
  const key = JSON.stringify(filters);
  const { page, error, loadingMore, loadMore, list } = usePagedMarks(key, (offset) => api.annotationMarksList({ ...filters, limit: PAGE, offset }));
  useEffect(() => onCount(page.ready ? page.marks.length : null), [onCount, page.ready, page.marks.length]);
  const empty = filters.query ? (
    <p className="reading m-0 text-text-muted">{t("scripture.marks.empty.noSearch")}</p>
  ) : filtered ? (
    <p className="reading m-0 text-text-muted">{t("scripture.marks.empty.noMatch")}</p>
  ) : (
    <div className="flex flex-col gap-1">
      <p className="reading m-0 text-text-strong">{t("scripture.marks.empty.none")}</p>
      <p className="m-0 text-[0.9375rem] text-text-muted">{t("scripture.marks.empty.noneBody")}</p>
    </div>
  );
  return (
    <ListFrame heading={heading} together={together} ready={page.ready} count={page.marks.length} error={error} hasMore={page.hasMore} loadingMore={loadingMore} onLoadMore={() => void loadMore()} empty={empty}>
      {page.marks.length > 0 && (
        <ul ref={list} className="m-0 flex list-none flex-col gap-2 p-0">
          {page.marks.map((mark) => (
            <li key={mark.id}>
              <MarkCard mark={mark} chapterCount={books.find((b) => b.code === mark.reference.book)?.chapterCount} onOpen={() => onOpen(mark)} />
            </li>
          ))}
        </ul>
      )}
    </ListFrame>
  );
}

interface SourceMarksProps {
  heading: string | null;
  together: boolean;
  onCount: (count: number | null) => void;
  filters: { kind?: AnnotationKind; sourceId?: string; color?: HighlightColor; query?: string };
  filtered: boolean;
  onOpen: (mark: SourceMark) => void;
}

function SourceMarks({ heading, together, filters, filtered, onOpen, onCount }: SourceMarksProps) {
  const { t } = useTranslation();
  const api = useApi();
  const key = JSON.stringify(filters);
  const { page, error, loadingMore, loadMore, list } = usePagedMarks(key, (offset) => api.sourceMarksList({ ...filters, limit: PAGE, offset }));
  // A mark being added to a Study (v0.15), with the menu button focus returns to; and a short confirmation.
  const [adding, setAdding] = useState<{ mark: SourceMark; opener: HTMLButtonElement | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const copy = async (mark: SourceMark) => {
    if (mark.quote === null) return;
    const done = await copyText(quotationWithCitation(t, mark.quote, { title: mark.sourceTitle, author: mark.sourceAuthor, locator: mark.locator, section: mark.sectionPath }));
    setNotice(done ? t("library.copy.done") : t("library.copy.failed"));
  };
  useEffect(() => onCount(page.ready ? page.marks.length : null), [onCount, page.ready, page.marks.length]);
  const empty = filters.query ? (
    <p className="reading m-0 text-text-muted">{t("scripture.marks.empty.noSearch")}</p>
  ) : filtered ? (
    <p className="reading m-0 text-text-muted">{t("scripture.marks.empty.noMatchSources")}</p>
  ) : (
    <div className="flex flex-col gap-1">
      <p className="reading m-0 text-text-strong">{t("scripture.marks.empty.noneSources")}</p>
      <p className="m-0 text-[0.9375rem] text-text-muted">{t("scripture.marks.empty.noneSourcesBody")}</p>
    </div>
  );
  return (
    <ListFrame heading={heading} together={together} ready={page.ready} count={page.marks.length} error={error} hasMore={page.hasMore} loadingMore={loadingMore} onLoadMore={() => void loadMore()} empty={empty}>
      {page.marks.length > 0 && (
        <ul ref={list} className="m-0 flex list-none flex-col gap-2 p-0">
          {page.marks.map((mark) => (
            <li key={mark.id} className="flex flex-wrap items-start gap-1">
              <SourceMarkCard mark={mark} onOpen={() => onOpen(mark)} />
              {mark.kind !== "bookmark" && (
                <ActionMenu
                  label={t("library.more")}
                  actions={[
                    { label: t("library.toStudy.add"), onSelect: (opener) => setAdding({ mark, opener }) },
                    ...(mark.quote !== null ? [{ label: t("library.copy.action"), onSelect: () => void copy(mark) }] : []),
                    { label: t("library.citations.open"), onSelect: () => onOpen(mark) },
                  ]}
                  className="shrink-0"
                />
              )}
              {adding?.mark.id === mark.id && (
                <div className="basis-full">
                  <AddToStudyPanel
                    from={{
                      cited: { annotationId: mark.id },
                      quote: mark.quote,
                      note: mark.kind === "note" ? mark.content : "",
                      title: mark.sourceTitle,
                      author: mark.sourceAuthor,
                      locator: mark.locator,
                      section: mark.sectionPath,
                    }}
                    onCancel={() => {
                      const opener = adding.opener;
                      setAdding(null);
                      requestAnimationFrame(() => opener?.focus());
                    }}
                    onAdded={(where) => {
                      const opener = adding.opener;
                      setAdding(null);
                      setNotice(t("studies.fromSource.added", where));
                      requestAnimationFrame(() => opener?.focus());
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p aria-live="polite" className={notice ? "m-0 text-[0.9375rem] text-text-muted" : "sr-only"}>{notice ?? ""}</p>
    </ListFrame>
  );
}

const KIND_ICON = { note: StickyNote, highlight: Highlighter, bookmark: Bookmark } as const;

function KindLine({ kind, color }: { kind: AnnotationKind; color: HighlightColor | null }) {
  const { t } = useTranslation();
  const Icon = KIND_ICON[kind];
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.875rem] text-text-muted">
      <Icon className="size-3.5" aria-hidden="true" />
      {t(`scripture.marks.result.${kind}`)}
      {kind === "highlight" && color && (
        <>
          {t("common.listSeparator")}
          <span aria-hidden="true" className={`inline-block size-3 rounded-full border border-text-muted ${SWATCH_CLASS[color]}`} />
          {t(`scripture.colors.${color}`)}
        </>
      )}
    </span>
  );
}

function MarkCard({ mark, chapterCount, onOpen }: { mark: Annotation; chapterCount?: number; onOpen: () => void }) {
  const { t } = useTranslation();
  const quote = mark.anchor?.quote;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={t("scripture.marks.result.show")}
      className="flex w-full flex-col gap-1 rounded-aw border border-border-subtle bg-pane-work p-3 text-left font-ui hover:bg-bg-secondary"
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium text-text-strong">{referenceLabel(mark.reference, chapterCount)}</span>
        <KindLine kind={mark.kind} color={mark.kind === "highlight" ? mark.color : null} />
      </span>
      {quote && <span className="reading text-[0.9375rem] italic text-text">“{quote}”</span>}
      {mark.kind === "highlight" && !quote && <span className="text-[0.875rem] text-text-muted">{t("scripture.marks.result.wholeVerse")}</span>}
      {mark.kind === "note" && mark.content && <span className="line-clamp-4 whitespace-pre-wrap text-[0.9375rem] text-text">{mark.content}</span>}
      {mark.anchor && !mark.anchor.shown && <span className="text-[0.875rem] text-text-muted">{t("scripture.verseTools.notShown")}</span>}
    </button>
  );
}

/** A mark in a source: the source and the place (page or section), what kind it is, the words and the note. */
function SourceMarkCard({ mark, onOpen }: { mark: SourceMark; onOpen: () => void }) {
  // Beside its quiet menu (v0.15): the card takes the rest of the row.
  const { t } = useTranslation();
  const place = mark.locator ? locatorLabel(t, mark.locator, mark.pageNumber ?? undefined) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={t("scripture.marks.result.showSource")}
      className="flex min-w-0 flex-1 flex-col gap-1 rounded-aw border border-border-subtle bg-pane-work p-3 text-left font-ui hover:bg-bg-secondary"
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium text-text-strong">{mark.sourceTitle}</span>
        {place && <span className="text-[0.875rem] text-text-muted">{place}</span>}
        <KindLine kind={mark.kind} color={mark.kind === "highlight" ? mark.color : null} />
      </span>
      {mark.quote && <span className="reading line-clamp-3 whitespace-pre-line text-[0.9375rem] italic text-text">“{mark.quote}”</span>}
      {mark.kind === "note" && mark.content && <span className="line-clamp-4 whitespace-pre-wrap text-[0.9375rem] text-text">{mark.content}</span>}
      {mark.state === "unresolved" && <span className="text-[0.875rem] text-text-muted">{t("library.marks.unresolved")}</span>}
    </button>
  );
}
