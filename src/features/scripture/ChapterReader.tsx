import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Highlighter, Layers, StickyNote } from "lucide-react";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { useApi } from "@/lib/ApiContext";
import { PHRASE_CLASS, VERSE_CLASS, highlightPaint, phraseSegments, verseMarks } from "@/lib/annotationRender";
import { contains } from "@/lib/scripture";
import { referenceLabel } from "@/i18n/scripture";
import type { Annotation, BibleTranslation, ScriptureRef, VerseText } from "@/types/scripture";
import { SelectionToolbar } from "./SelectionToolbar";
import { SELECTION_SPIKE, SelectionSpike } from "./SelectionSpike";
import { useScripture } from "./ScriptureContext";
import { AnnotationInspector } from "./AnnotationInspector";
import { usePaneLayout } from "./usePaneLayout";

/** A whole chapter as a reference, for its label ("John 15", "Jude"). */
function chapterOf(book: string, chapter: number): ScriptureRef {
  return { canonical: `${book}.${chapter}`, display: "", book, startChapter: chapter, startVerse: null, endChapter: chapter, endVerse: null };
}

/** One chapter of one translation, with the user's annotations. */
export function ChapterReader({ translation }: { translation: BibleTranslation }) {
  const { t } = useTranslation();
  const api = useApi();
  const { location, selection, navigationId, selectedVerse, selectVerse, bookByCode } = useScripture();
  const { book, chapter } = location;
  const text = useLoad(
    useCallback(
      () => api.scriptureGetChapter({ translationId: translation.id, book, chapter }),
      [api, translation.id, book, chapter],
    ),
  );
  const notes = useLoad(
    useCallback(() => api.annotationList(`${book}.${chapter}`, translation.id), [api, book, chapter, translation.id]),
  );
  const selected =
    selectedVerse && selectedVerse.book === book && selectedVerse.startChapter === chapter
      ? selectedVerse.startVerse
      : null;
  const container = useRef<HTMLDivElement>(null);
  const inspectorId = `${useId()}-annotations`;
  // The one open annotation inspector: which verse, what opened it (focus goes
  // back there), and where it was opened. It counts as closed once the chapter
  // or translation on screen is no longer that one, so it is never stale.
  // Any navigation (even within this chapter) starts afresh: nothing stays open for a verse the reader has left.
  const scope = `${translation.id}:${book}.${chapter}:${navigationId}`;
  const [opened, setOpened] = useState<{ verse: string; opener: HTMLElement | null; scope: string } | null>(null);
  // Moving to another chapter or translation drops it for good (it must not
  // come back if the reader returns to the same place).
  if (opened && opened.scope !== scope) setOpened(null);
  const inspector = opened && opened.scope === scope ? opened : null;

  // After navigating: show the marked passage if it is out of view,
  // otherwise return to the top so the navigation stays in sight.
  const loaded = text.data?.book === book && text.data?.chapter === chapter;
  useEffect(() => {
    if (!loaded) return;
    const first = container.current?.querySelector<HTMLElement>("[data-current='true']");
    if (first) first.scrollIntoView?.({ block: "nearest" });
    else container.current?.closest("[data-scroll-root]")?.scrollTo?.({ top: 0 });
  }, [loaded, navigationId]);

  const layout = usePaneLayout(container, loaded);

  const closeInspector = () => {
    if (!inspector) return;
    const { verse, opener } = inspector;
    setOpened(null);
    selectVerse(null);
    // Back to what opened it; if that is gone (the last mark was removed), the verse number.
    requestAnimationFrame(() => {
      const target = opener?.isConnected ? opener : container.current?.querySelector<HTMLElement>(`[data-verse-button="${verse}"]`);
      target?.focus();
    });
  };

  // The panel sits at the foot of the reader; if it would cover the verse
  // being worked on, scroll just enough to bring that verse clear above it.
  const keepVerseVisible = (canonical: string) =>
    requestAnimationFrame(() => {
      const root = container.current?.closest<HTMLElement>("[data-scroll-root]");
      const verseBox = container.current?.querySelector(`[data-verse-button="${canonical}"]`)?.closest("div");
      const panel = document.getElementById(inspectorId);
      if (!root || !verseBox || !panel) return;
      const verseRect = verseBox.getBoundingClientRect();
      if (verseRect.bottom > panel.getBoundingClientRect().top - 8) {
        root.scrollBy?.({ top: verseRect.top - root.getBoundingClientRect().top - 12 });
      }
    });

  const toggleInspector = (canonical: string, opener: HTMLElement) => {
    if (inspector?.verse === canonical) return closeInspector();
    setOpened({ verse: canonical, opener, scope });
    selectVerse(canonical);
    keepVerseVisible(canonical);
  };

  if (text.error) return <Notice tone="error">{text.error.message}</Notice>;
  const chapterCount = bookByCode.get(book)?.chapterCount;
  if (!text.data) {
    return <p className="text-text-muted">{t("scripture.reader.opening", { passage: referenceLabel(chapterOf(book, chapter), chapterCount) })}</p>;
  }
  const data = text.data;
  const passage = referenceLabel(chapterOf(data.book, data.chapter), data.chapterCount);
  const annotations = notes.data ?? [];
  const on = (verse: number) =>
    annotations.filter((a) => contains(a.reference, book, chapter, verse));

  return (
    <div ref={container} className="flex flex-col gap-4">
      <header>
        <h2 className="type-title m-0">
          {passage}
        </h2>
        <p className="type-meta m-0 mt-0.5">
          {translation.name}
          {selection && selection.book === book ? (
            <>
              {t("common.listSeparator")}
              {t("scripture.reader.showing", { passage: referenceLabel(selection, data.chapterCount) })}
            </>
          ) : null}
        </p>
      </header>

      {data.verses.length === 0 ? (
        <p className="text-text-muted">
          {t("scripture.reader.noText", { name: translation.name, passage })}
        </p>
      ) : (
        <div className="reading flex flex-col gap-1">
          {data.superscription && <p className="m-0 mb-1 italic text-text-muted">{data.superscription}</p>}
          {data.verses.map((verse) => (
            <Verse
              key={verse.canonical}
              verse={verse}
              annotations={on(verse.verse)}
              current={!!selection && contains(selection, book, chapter, verse.verse)}
              selected={selected === verse.verse}
              inspectorOpen={inspector?.verse === verse.canonical}
              inspectorId={inspectorId}
              onToggleInspector={(opener) => toggleInspector(verse.canonical, opener)}
            />
          ))}
        </div>
      )}
      {data.verses.length > 0 && (
        <div className="sticky bottom-2 z-10 flex flex-col gap-2">
          {inspector && (
            <AnnotationInspector
              key={inspector.verse}
              id={inspectorId}
              canonical={inspector.verse}
              verse={Number(inspector.verse.split(".")[2])}
              annotations={on(Number(inspector.verse.split(".")[2]))}
              layout={layout}
              onClose={closeInspector}
              onChanged={notes.reload}
            />
          )}
          <SelectionToolbar key={scope} root={container} translationId={translation.id} onSaved={notes.reload} annotated={Boolean(translation.words)} />
        </div>
      )}
      {SELECTION_SPIKE && data.verses.length > 0 && <SelectionSpike root={container} translationId={translation.id} />}
    </div>
  );
}

interface VerseProps {
  verse: VerseText;
  annotations: Annotation[];
  current: boolean;
  selected: boolean;
  inspectorOpen: boolean;
  inspectorId: string;
  onToggleInspector: (opener: HTMLElement) => void;
}

function Verse({ verse, annotations, current, selected, inspectorOpen, inspectorId, onToggleInspector }: VerseProps) {
  const { t } = useTranslation();
  const marks = verseMarks(verse.canonical, annotations);
  const verseColor = highlightPaint(marks.verseColors);
  const { bookmarked, notes: noted } = marks;
  const states = [
    noted.length > 0 ? t("scripture.reader.state.note") : null,
    bookmarked ? t("scripture.reader.state.bookmarked") : null,
    marks.verseColors.length > 0 ? t("scripture.reader.state.highlighted") : null,
    marks.wordsHighlighted ? t("scripture.reader.state.highlightedWords") : null,
  ].filter((state): state is string => state !== null);
  const label =
    states.length > 0
      ? t("scripture.reader.verseButtonWithState", { verse: verse.verse, states: states.join(t("scripture.reader.stateSeparator")) })
      : t("scripture.reader.verseButton", { verse: verse.verse });

  // One marker for the verse, whatever is on it. Its name says what is there
  // (counts and colour included), never by icon or colour alone.
  const phraseMarks = annotations.filter((a) => a.anchor && a.kind === "highlight");
  const summary = [
    noted.length > 0 ? t("scripture.reader.marker.notes", { count: noted.length }) : null,
    bookmarked ? t("scripture.reader.state.bookmarked") : null,
    marks.verseColors.length === 1
      ? t("scripture.reader.marker.highlightedColor", { color: t(`scripture.colors.${marks.verseColors[0]!}`) })
      : marks.verseColors.length > 1
        ? t("scripture.reader.state.highlighted")
        : null,
    phraseMarks.length > 0 ? t("scripture.reader.state.highlightedWords") : null,
  ].filter((state): state is string => state !== null);
  const kinds = [noted.length > 0, bookmarked, marks.verseColors.length > 0 || phraseMarks.length > 0].filter(Boolean).length;
  const MarkIcon = kinds > 1 ? Layers : noted.length > 0 ? StickyNote : bookmarked ? Bookmark : Highlighter;
  const markerLabel = t("scripture.reader.marker.label", { verse: verse.verse, states: summary.join(t("scripture.reader.stateSeparator")) });

  const tone = selected ? "bg-selection" : verseColor ? VERSE_CLASS[verseColor] : "";
  const segments = phraseSegments(verse.canonical, verse.text.length, annotations);
  return (
    <div
      data-current={current || undefined}
      data-verse-highlight={marks.verseColors.length > 0 ? marks.verseColors.join(" ") : undefined}
      className={`scroll-my-3 border-l-[3px] px-2 py-0.5 ${current ? "border-accent" : "border-transparent"} ${tone}`}
    >
      <p className="m-0">
        <button
          type="button"
          data-verse-button={verse.canonical}
          onClick={(e) => onToggleInspector(e.currentTarget)}
          aria-expanded={inspectorOpen}
          aria-controls={inspectorOpen ? inspectorId : undefined}
          aria-label={label}
          className="-my-1.5 mr-1 inline-flex min-h-8 min-w-8 select-none items-center justify-center rounded px-1 align-baseline font-ui text-[0.8125rem] font-semibold text-text-muted hover:bg-hover hover:text-text-strong"
        >
          {verse.verse}
        </button>
        {/* Only this element holds Scripture text: selections are measured in it.
            Drawn phrases only wrap parts of the text; they never change it. */}
        <span data-verse-text={verse.canonical}>
          {segments.map((segment) => {
            const text = verse.text.slice(segment.start, segment.end);
            const paint = highlightPaint(segment.colors);
            if (!paint && !segment.noted) return <Fragment key={segment.start}>{text}</Fragment>;
            return (
              <mark
                key={segment.start}
                data-phrase-color={paint ?? undefined}
                data-phrase-note={segment.noted || undefined}
                className={`rounded-sm text-inherit ${paint ? PHRASE_CLASS[paint] : "bg-transparent"} ${
                  segment.noted ? "underline decoration-accent decoration-dotted decoration-2 underline-offset-4" : ""
                }`}
              >
                {text}
              </mark>
            );
          })}
        </span>
        {annotations.length > 0 && (
          <button
            type="button"
            data-verse-marker
            onClick={(e) => onToggleInspector(e.currentTarget)}
            aria-expanded={inspectorOpen}
            aria-controls={inspectorOpen ? inspectorId : undefined}
            aria-label={markerLabel}
            title={markerLabel}
            className="-my-1.5 ml-1 inline-flex size-8 select-none items-center justify-center rounded align-middle text-accent hover:bg-hover"
          >
            <MarkIcon className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </p>
    </div>
  );
}
