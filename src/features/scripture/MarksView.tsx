import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Highlighter, StickyNote } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { bookName, referenceLabel } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { SWATCH_CLASS } from "@/lib/annotationRender";
import { HIGHLIGHT_COLORS, type Annotation, type AnnotationKind, type BibleTranslation, type HighlightColor } from "@/types/scripture";
import { useScripture } from "./ScriptureContext";

type KindFilter = "all" | AnnotationKind;
const KINDS: KindFilter[] = ["all", "note", "highlight", "bookmark"];
const PAGE = 30;

interface MarksViewProps {
  translation: BibleTranslation;
  /** Show this mark in the Bible. */
  onOpen: (mark: Annotation) => void;
}

/**
 * Everything the reader has marked, in Scripture order: notes, highlights
 * and bookmarks together, with a few plain ways to narrow it. A mark is a
 * way back to its passage; richer editing stays where the passage is.
 * Nothing here depends on the translation shown, except that a phrase mark
 * says whether it fits that wording.
 */
export function MarksView({ translation, onOpen }: MarksViewProps) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const { books } = useScripture();
  const [kind, setKind] = useState<KindFilter>("all");
  const [book, setBook] = useState("");
  const [color, setColor] = useState<HighlightColor | "">("");
  const [text, setText] = useState("");
  const [page, setPage] = useState<{ marks: Annotation[]; hasMore: boolean; ready: boolean }>({ marks: [], hasMore: false, ready: false });
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);
  const list = useRef<HTMLUListElement>(null);
  // After "Load more", focus moves to the first new mark: the button may be gone
  // (nothing more to load), and a screen-reader user should land on what arrived.
  const focusFrom = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (focusFrom.current === null) return;
    list.current?.querySelectorAll<HTMLElement>("button")[focusFrom.current]?.focus();
    focusFrom.current = null;
  }, [page.marks.length]);

  const query = text.trim();
  const filters = { kind: kind === "all" ? undefined : kind, book: book || undefined, color: kind === "highlight" && color ? color : undefined, query: query || undefined, translationId: translation.id };

  // A new choice starts a new list; an answer to an old choice is ignored.
  const key = JSON.stringify(filters);
  useEffect(() => {
    const mine = ++request.current;
    api.annotationMarksList({ ...JSON.parse(key), limit: PAGE }).then(
      (result) => {
        if (mine !== request.current) return;
        setError(null);
        setPage({ marks: result.marks, hasMore: result.hasMore, ready: true });
      },
      (e) => mine === request.current && setError(toApiError(e).message),
    );
  }, [api, key]);

  const loadMore = useCallback(async () => {
    const mine = request.current;
    setLoadingMore(true);
    try {
      const result = await api.annotationMarksList({ ...JSON.parse(key), limit: PAGE, offset: page.marks.length });
      if (mine !== request.current) return;
      focusFrom.current = page.marks.length;
      setPage((p) => ({ marks: [...p.marks, ...result.marks], hasMore: result.hasMore, ready: true }));
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setLoadingMore(false);
    }
  }, [api, key, page.marks.length]);

  const empty =
    page.ready && page.marks.length === 0
      ? query
        ? t("scripture.marks.empty.noSearch")
        : kind !== "all" || book || color
          ? t("scripture.marks.empty.noMatch")
          : null
      : null;
  const none = page.ready && page.marks.length === 0 && !empty;

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <h2 id={`${id}-title`} className="m-0 font-display text-[1.5rem] font-heading text-text-strong">
        {t("scripture.marks.title")}
      </h2>

      <div className="flex flex-col gap-3">
        <div role="group" aria-label={t("scripture.marks.kindLabel")} className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className="min-h-9 rounded-full border border-border px-3 font-ui text-[0.9375rem] text-text-strong hover:bg-bg-secondary aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-on-primary"
            >
              {t(`scripture.marks.kind.${k}`)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-2">
          <label className="flex min-w-0 items-center gap-2 text-[0.9375rem]">
            <span>{t("scripture.marks.book")}</span>
            <select value={book} onChange={(e) => setBook(e.target.value)} className="h-9 min-w-0 max-w-full rounded-aw border border-border bg-bg px-2">
              <option value="">{t("scripture.marks.allBooks")}</option>
              {books.map((b) => (
                <option key={b.code} value={b.code}>{bookName(b.code, b.name)}</option>
              ))}
            </select>
          </label>
          {kind === "highlight" && (
            <label className="flex min-w-0 items-center gap-2 text-[0.9375rem]">
              <span>{t("scripture.marks.color")}</span>
              <select value={color} onChange={(e) => setColor(e.target.value as HighlightColor | "")} className="h-9 min-w-0 max-w-full rounded-aw border border-border bg-bg px-2">
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

      {error && <Notice tone="error">{error}</Notice>}
      {!page.ready && !error && <p role="status" className="m-0 text-text-muted">{t("scripture.marks.loading")}</p>}
      <p role="status" className="sr-only">{page.ready ? t("scripture.marks.count", { count: page.marks.length }) : ""}</p>

      {none && (
        <div className="flex flex-col gap-1">
          <p className="reading m-0 text-text-strong">{t("scripture.marks.empty.none")}</p>
          <p className="m-0 text-[0.9375rem] text-text-muted">{t("scripture.marks.empty.noneBody")}</p>
        </div>
      )}
      {empty && <p className="reading m-0 text-text-muted">{empty}</p>}

      {page.marks.length > 0 && (
        <ul ref={list} className="m-0 flex list-none flex-col gap-2 p-0">
          {page.marks.map((mark) => (
            <li key={mark.id}>
              <MarkCard mark={mark} chapterCount={books.find((b) => b.code === mark.reference.book)?.chapterCount} onOpen={() => onOpen(mark)} />
            </li>
          ))}
        </ul>
      )}
      {page.hasMore && (
        <Button className="self-start" onClick={() => void loadMore()} disabled={loadingMore}>
          {t("scripture.marks.loadMore")}
        </Button>
      )}
    </section>
  );
}

const KIND_ICON = { note: StickyNote, highlight: Highlighter, bookmark: Bookmark } as const;

function MarkCard({ mark, chapterCount, onOpen }: { mark: Annotation; chapterCount?: number; onOpen: () => void }) {
  const { t } = useTranslation();
  const Icon = KIND_ICON[mark.kind];
  const quote = mark.anchor?.quote;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={t("scripture.marks.result.show")}
      className="flex w-full flex-col gap-1 rounded-aw border border-border-subtle bg-bg p-3 text-left font-ui hover:bg-bg-secondary"
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium text-text-strong">{referenceLabel(mark.reference, chapterCount)}</span>
        <span className="inline-flex items-center gap-1.5 text-[0.875rem] text-text-muted">
          <Icon className="size-3.5" aria-hidden="true" />
          {t(`scripture.marks.result.${mark.kind}`)}
          {mark.kind === "highlight" && mark.color && (
            <>
              {t("common.listSeparator")}
              <span aria-hidden="true" className={`inline-block size-3 rounded-full border border-text-muted ${SWATCH_CLASS[mark.color]}`} />
              {t(`scripture.colors.${mark.color}`)}
            </>
          )}
        </span>
      </span>
      {quote && <span className="reading text-[0.9375rem] italic text-text">“{quote}”</span>}
      {mark.kind === "highlight" && !quote && <span className="text-[0.875rem] text-text-muted">{t("scripture.marks.result.wholeVerse")}</span>}
      {mark.kind === "note" && mark.content && <span className="line-clamp-4 whitespace-pre-wrap text-[0.9375rem] text-text">{mark.content}</span>}
      {mark.anchor && !mark.anchor.shown && <span className="text-[0.875rem] text-text-muted">{t("scripture.verseTools.notShown")}</span>}
    </button>
  );
}
