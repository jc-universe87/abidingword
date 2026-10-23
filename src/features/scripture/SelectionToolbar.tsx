import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { BookOpenText, Highlighter, StickyNote } from "lucide-react";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { coveredReference } from "@/lib/annotationRender";
import { anchorFromSelection, type SelectionAnchor } from "@/lib/selectionAnchor";
import type { HighlightColor, VerseWord } from "@/types/scripture";
import { HighlightColors } from "./HighlightColors";
import { WordDetails } from "./WordDetails";

// Actions are deliberately larger and stronger than the quiet verse tools:
// when words are selected the reader should see at once that a choice is
// waiting. "primary" is the filled brand button; the other is outlined.
const action =
  "inline-flex min-h-11 items-center gap-2 rounded-aw px-4 font-ui text-[0.9375rem] font-medium ";
const primary = action + "bg-primary text-on-primary hover:bg-primary-hover";
const outlined = action + "border-2 border-text-strong bg-bg text-text-strong hover:bg-hover";

type Step = { kind: "actions" } | { kind: "color" } | { kind: "note"; text: string } | { kind: "words" };

/** The annotated words a selection touches, in every verse it covers (v0.21). */
async function selectedWords(load: (verse: string) => Promise<VerseWord[]>, anchor: SelectionAnchor): Promise<VerseWord[]> {
  const { start, end } = anchor;
  if (start.verse === end.verse) {
    return (await load(start.verse)).filter((w) => w.start < end.offset && w.end > start.offset);
  }
  // The verses between, when the selection stays in one chapter.
  const [book, chapter, first] = start.verse.split(".");
  const [endBook, endChapter, last] = end.verse.split(".");
  const middle: string[] = [];
  if (book === endBook && chapter === endChapter) {
    for (let v = Number(first) + 1; v < Number(last); v += 1) middle.push(`${book}.${chapter}.${v}`);
  }
  const [head, ...rest] = await Promise.all([start.verse, ...middle, end.verse].map(load));
  const tail = rest.pop() ?? [];
  return [...(head ?? []).filter((w) => w.end > start.offset), ...rest.flat(), ...tail.filter((w) => w.start < end.offset)];
}

/** The most words listed for one selection. */
const WORDS_SHOWN = 12;

interface Props {
  /** The element holding the verse texts; selections are read inside it. */
  root: RefObject<HTMLElement | null>;
  translationId: string;
  onSaved: () => void;
  /** Whether this Bible's own markup annotates its words (v0.21): only then are word details offered. */
  annotated?: boolean;
}

/**
 * The contextual bar for a phrase selection: Add note and Highlight (never
 * Bookmark, which is verse-level). It sits at the foot of the reader, in
 * normal flow and sticky, rather than floating over the text, so wrapping,
 * scrolling and WebKitGTK selection quirks cannot move it. The anchor is
 * captured when the selection settles and kept while a colour is chosen or a
 * note is written, so focusing the note field cannot lose it. The reader
 * remounts it (by key) for another chapter or translation, which ends any
 * step: the anchor belongs to what was on screen.
 */
export function SelectionToolbar({ root, translationId, onSaved, annotated = false }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const bar = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);
  const [step, setStep] = useState<Step>({ kind: "actions" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // While choosing or writing, the native selection may collapse (focus moves
  // into the bar); the captured anchor is kept until the step ends.
  const frozen = step.kind !== "actions";
  // The selection's annotated words, for the anchor they were read for.
  const [words, setWords] = useState<{ anchor: SelectionAnchor; list: VerseWord[] } | null>(null);

  const finish = useCallback(() => {
    document.getSelection()?.removeAllRanges();
    setAnchor(null);
    setStep({ kind: "actions" });
    setError(null);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const element = root.current;
        if (!element || frozen) return;
        // Tabbing into the bar can empty the selection; the bar stays reachable.
        if (bar.current?.contains(document.activeElement)) return;
        const selection = document.getSelection();
        setAnchor(selection && !selection.isCollapsed ? anchorFromSelection(selection, element) : null);
        setError(null);
      }, 120);
    };
    document.addEventListener("selectionchange", read);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", read);
    };
  }, [root, frozen]);

  useEffect(() => {
    if (!annotated || !anchor) return;
    let active = true;
    selectedWords((verse) => api.scriptureVerseWords({ translationId, verse }), anchor).then(
      (list) => active && setWords({ anchor, list }),
      () => active && setWords({ anchor, list: [] }),
    );
    return () => {
      active = false;
    };
  }, [api, annotated, anchor, translationId]);

  if (!anchor) return null;
  const found = words?.anchor === anchor ? words.list : [];
  const tagged = found.slice(0, WORDS_SHOWN);

  const save = async (input: { kind: "highlight"; color: HighlightColor } | { kind: "note"; content: string }) => {
    setBusy(true);
    setError(null);
    try {
      await api.annotationCreate({
        reference: coveredReference(anchor.start.verse, anchor.end.verse),
        translationId,
        anchor: { translationId, start: anchor.start, end: anchor.end, quote: anchor.quote },
        ...input,
      });
      finish();
      onSaved();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => finish();

  return (
    <div
      ref={bar}
      role="group"
      aria-label={t("scripture.selection.toolbarLabel")}
      // Pressing a button must not collapse the text selection before it is read.
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && step.kind !== "actions") cancel();
      }}
      // A raised panel with a brass rule on top: clearly an active state, not a footer.
      className="sticky bottom-2 z-10 flex flex-col gap-3 aw-action-panel px-4 py-3.5 font-ui text-[0.9375rem]"
    >
      <p className="type-meta m-0 font-medium">{t("scripture.selection.selectedWords")}</p>
      <q
        className="reading m-0 line-clamp-3 break-words border-l-[3px] border-accent bg-bg px-3 py-1.5 text-[1.0625rem] text-text-strong [quotes:none]"
        data-testid="selection-quote"
      >
        {anchor.quote}
      </q>

      {step.kind === "actions" && (
        <div className="flex flex-wrap gap-3">
          <button type="button" className={outlined} onClick={() => setStep({ kind: "note", text: "" })}>
            <StickyNote className="size-5" aria-hidden="true" /> {t("scripture.verseTools.addNote")}
          </button>
          <button type="button" className={primary} onClick={() => setStep({ kind: "color" })}>
            <Highlighter className="size-5" aria-hidden="true" /> {t("scripture.verseTools.highlight")}
          </button>
          {tagged.length > 0 && (
            <button type="button" className={outlined} onClick={() => setStep({ kind: "words" })}>
              <BookOpenText className="size-5" aria-hidden="true" /> {t("scripture.words.details")}
            </button>
          )}
        </div>
      )}

      {step.kind === "words" && (
        <div className="flex flex-col gap-3">
          <WordDetails words={tagged} more={found.length - tagged.length} translationId={translationId} onDone={finish} />
          <button type="button" className={`${outlined} self-start`} onClick={cancel}>
            {t("common.close")}
          </button>
        </div>
      )}

      {step.kind === "color" && (
        <div className="flex flex-wrap items-center gap-3">
          <HighlightColors onPick={(color) => !busy && save({ kind: "highlight", color })} />
          <button type="button" className={outlined} onClick={cancel}>
            {t("common.cancel")}
          </button>
        </div>
      )}

      {step.kind === "note" && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="sr-only">{t("scripture.selection.noteOnWords")}</span>
            <textarea
              autoFocus
              rows={3}
              value={step.text}
              onChange={(e) => setStep({ kind: "note", text: e.target.value })}
              className="aw-writing"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || !step.text.trim()}
              onClick={() => save({ kind: "note", content: step.text.trim() })}
              className={`${primary} disabled:opacity-50`}
            >
              {t("scripture.verseTools.saveNote")}
            </button>
            <button type="button" onClick={cancel} className={outlined}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
