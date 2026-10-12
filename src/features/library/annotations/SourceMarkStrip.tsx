import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Highlighter, StickyNote } from "lucide-react";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { HighlightColors } from "@/features/scripture/HighlightColors";
import type { HighlightColor } from "@/types/scripture";
import { selectionInside, wholeParagraph, type SourceSelection, type StoredText } from "./sourceSelection";

// The same weight as the Bible's selection bar: when text is selected the
// reader should see at once that a choice is waiting.
const action = "inline-flex min-h-11 items-center gap-2 rounded-aw px-4 font-ui text-[1rem] font-semibold ";
const primary = action + "bg-primary text-on-primary hover:bg-primary-hover";
const outlined = action + "border-2 border-text-strong bg-bg text-text-strong hover:bg-bg-secondary";

type Step = { kind: "actions" } | { kind: "color" } | { kind: "note"; text: string };

/** A paragraph the person asked to write a note on (or highlight) without selecting words. */
export interface PlaceRequest {
  segmentId: string;
  nonce: number;
}

interface Props {
  /** The element holding the Reading view's paragraphs; selections are read inside it. */
  root: RefObject<HTMLElement | null>;
  sourceId: string;
  /** The stored text of a paragraph on screen. */
  stored: (segmentId: string) => StoredText | undefined;
  /** "Add note here": a paragraph to write a note on, with no words selected. */
  place: PlaceRequest | null;
  /** The place request is finished (saved or cancelled); focus goes back where it came from. */
  onPlaceDone: () => void;
  onSaved: () => void;
}

/**
 * The small contextual bar for marking a source: Highlight and Add note for
 * selected text, or a note (or a highlight of the whole paragraph) for "Add
 * note here". It sits at the foot of the Reading view, in normal flow and
 * sticky, never floating over the text. The anchor is captured when the
 * selection settles and kept while a colour is chosen or a note is written.
 */
export function SourceMarkStrip({ root, sourceId, stored, place, onPlaceDone, onSaved }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const bar = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<SourceSelection | null>(null);
  const [step, setStep] = useState<Step>({ kind: "actions" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const frozen = step.kind !== "actions" || place !== null;
  const storedRef = useRef(stored);
  useEffect(() => {
    storedRef.current = stored;
  });

  const finish = useCallback(() => {
    document.getSelection()?.removeAllRanges();
    setAnchor(null);
    setStep({ kind: "actions" });
    setError(null);
  }, []);

  // "Add note here": the note field opens at once, on that paragraph (adjusted while rendering, once per request).
  const [seenPlace, setSeenPlace] = useState<PlaceRequest | null>(null);
  if (place !== seenPlace) {
    setSeenPlace(place);
    if (place) {
      setAnchor(null);
      setError(null);
      setStep({ kind: "note", text: "" });
    }
  }

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
        setAnchor(selection && !selection.isCollapsed ? selectionInside(selection, element, storedRef.current) : null);
        setError(null);
      }, 120);
    };
    document.addEventListener("selectionchange", read);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", read);
    };
  }, [root, frozen]);

  const placeText = place ? stored(place.segmentId) : undefined;
  if (!anchor && !(place && placeText)) return null;

  const cancel = () => {
    finish();
    if (place) onPlaceDone();
  };

  const save = async (input: { kind: "highlight"; color: HighlightColor; words?: SourceSelection } | { kind: "note"; content: string }) => {
    setBusy(true);
    setError(null);
    try {
      const words = input.kind === "highlight" ? (input.words ?? anchor) : anchor;
      if (words) {
        await api.sourceAnnotationCreate({
          sourceId,
          kind: input.kind,
          ...(input.kind === "highlight" ? { color: input.color } : { content: input.content }),
          start: words.start,
          end: words.end,
          quote: words.quote,
        });
      } else if (place && input.kind === "note") {
        await api.sourceAnnotationCreate({ sourceId, kind: "note", content: input.content, place: { segmentId: place.segmentId } });
      }
      finish();
      if (place) onPlaceDone();
      onSaved();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const quote = anchor?.quote ?? null;
  const paragraph = !anchor && place && placeText ? wholeParagraph(place.segmentId, placeText) : null;

  return (
    <div
      ref={bar}
      role="group"
      aria-label={t("library.marks.stripLabel")}
      data-aw-skip=""
      // Pressing a button must not collapse the text selection before it is read.
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
      }}
      className="sticky bottom-2 z-10 flex select-none flex-col gap-3 rounded-aw border border-t-[4px] border-border border-t-accent bg-bg-secondary px-4 py-3.5 font-ui text-[0.9375rem] shadow-[0_-6px_20px_rgba(0,0,0,0.22)]"
    >
      <p className="m-0 text-[0.875rem] font-semibold text-text-strong">{quote !== null ? t("library.marks.selectedText") : t("library.marks.noteHere")}</p>
      {quote !== null && (
        <q className="reading m-0 line-clamp-3 whitespace-pre-line break-words border-l-[3px] border-accent bg-bg px-3 py-1.5 text-[1.0625rem] text-text-strong [quotes:none]" data-testid="source-selection-quote">
          {quote}
        </q>
      )}

      {step.kind === "actions" && (
        <div className="flex flex-wrap gap-3">
          <button type="button" className={outlined} onClick={() => setStep({ kind: "note", text: "" })}>
            <StickyNote className="size-5" aria-hidden="true" /> {t("library.marks.addNote")}
          </button>
          <button type="button" className={primary} onClick={() => setStep({ kind: "color" })}>
            <Highlighter className="size-5" aria-hidden="true" /> {t("library.marks.highlight")}
          </button>
        </div>
      )}

      {step.kind === "color" && (
        <div className="flex flex-wrap items-center gap-3">
          <HighlightColors onPick={(color) => !busy && void save({ kind: "highlight", color, words: anchor ?? paragraph ?? undefined })} />
          <button type="button" className={outlined} onClick={cancel}>
            {t("common.cancel")}
          </button>
        </div>
      )}

      {step.kind === "note" && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="sr-only">{t("library.marks.noteField")}</span>
            <textarea
              autoFocus
              rows={3}
              value={step.text}
              onChange={(e) => setStep({ kind: "note", text: e.target.value })}
              className="reading select-text rounded-aw border-2 border-border bg-bg px-3 py-2 text-[1rem]"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={busy || !step.text.trim()} onClick={() => void save({ kind: "note", content: step.text.trim() })} className={`${primary} disabled:opacity-50`}>
              {t("library.marks.saveNote")}
            </button>
            {paragraph && (
              <button type="button" disabled={busy} onClick={() => setStep({ kind: "color" })} className={outlined}>
                <Highlighter className="size-5" aria-hidden="true" /> {t("library.marks.highlightParagraph")}
              </button>
            )}
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
