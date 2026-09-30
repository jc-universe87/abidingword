import { useCallback, useEffect, useRef } from "react";
import { Bookmark, StickyNote } from "lucide-react";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { useApi } from "@/lib/ApiContext";
import { bookLabel, contains } from "@/lib/scripture";
import type { Annotation, BibleTranslation, VerseText } from "@/types/scripture";
import { useScripture } from "./ScriptureContext";
import { VerseTools } from "./VerseTools";

/** One chapter of one translation, with the user's annotations. */
export function ChapterReader({ translation }: { translation: BibleTranslation }) {
  const api = useApi();
  const { location, selection, navigationId, selectedVerse, selectVerse } = useScripture();
  const { book, chapter } = location;
  const text = useLoad(
    useCallback(
      () => api.scriptureGetChapter({ translationId: translation.id, book, chapter }),
      [api, translation.id, book, chapter],
    ),
  );
  const notes = useLoad(useCallback(() => api.annotationList(`${book}.${chapter}`), [api, book, chapter]));
  const selected =
    selectedVerse && selectedVerse.book === book && selectedVerse.startChapter === chapter
      ? selectedVerse.startVerse
      : null;
  const container = useRef<HTMLDivElement>(null);

  // After navigating: show the marked passage if it is out of view,
  // otherwise return to the top so the navigation stays in sight.
  const loaded = text.data?.book === book && text.data?.chapter === chapter;
  useEffect(() => {
    if (!loaded) return;
    const first = container.current?.querySelector<HTMLElement>("[data-current='true']");
    if (first) first.scrollIntoView?.({ block: "nearest" });
    else container.current?.closest("[data-scroll-root]")?.scrollTo?.({ top: 0 });
  }, [loaded, navigationId]);

  if (text.error) return <Notice tone="error">{text.error.message}</Notice>;
  if (!text.data) return <p className="text-text-muted">Opening {book} {chapter}…</p>;
  const data = text.data;
  const annotations = notes.data ?? [];
  const on = (verse: number) =>
    annotations.filter((a) => contains(a.reference, book, chapter, verse));

  return (
    <div ref={container} className="flex flex-col gap-4">
      <header>
        <h2 className="m-0 font-display text-[1.5rem] font-semibold text-text-strong">
          {data.chapterCount === 1 ? data.bookName : `${bookLabel(data.book, data.bookName, true)} ${data.chapter}`}
        </h2>
        <p className="m-0 text-[0.9375rem] text-text-muted">
          {translation.name}
          {selection && selection.book === book ? <> · showing {selection.display}</> : null}
        </p>
      </header>

      {data.verses.length === 0 ? (
        <p className="text-text-muted">
          {translation.name} has no text for {data.chapterCount === 1 ? data.bookName : `${bookLabel(data.book, data.bookName, true)} ${data.chapter}`}.
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
              onSelect={() => selectVerse(selected === verse.verse ? null : verse.canonical)}
              onChanged={notes.reload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface VerseProps {
  verse: VerseText;
  annotations: Annotation[];
  current: boolean;
  selected: boolean;
  onSelect: () => void;
  onChanged: () => void;
}

function Verse({ verse, annotations, current, selected, onSelect, onChanged }: VerseProps) {
  const highlighted = annotations.some((a) => a.kind === "highlight");
  const bookmarked = annotations.some((a) => a.kind === "bookmark");
  const noted = annotations.filter((a) => a.kind === "note");
  const tone = selected ? "bg-selection" : highlighted ? "bg-note" : "";
  return (
    <div
      data-current={current || undefined}
      className={`scroll-my-3 border-l-[3px] px-2 py-0.5 ${current ? "border-accent" : "border-transparent"} ${tone}`}
    >
      <p className="m-0">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={`Verse ${verse.verse}${noted.length ? ", has a note" : ""}${bookmarked ? ", bookmarked" : ""}${highlighted ? ", highlighted" : ""}. Show verse tools`}
          className="mr-1.5 inline-flex min-w-6 items-baseline justify-center rounded px-0.5 align-baseline font-ui text-[0.8125rem] font-semibold text-text-muted hover:text-text-strong"
        >
          {verse.verse}
        </button>
        {verse.text}
        {(bookmarked || noted.length > 0) && (
          <span className="ml-1.5 inline-flex gap-1 align-middle text-accent" aria-hidden="true">
            {bookmarked && <Bookmark className="size-3.5" />}
            {noted.length > 0 && <StickyNote className="size-3.5" />}
          </span>
        )}
      </p>
      {selected && (
        <VerseTools
          canonical={verse.canonical}
          label={`verse ${verse.verse}`}
          annotations={annotations}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
