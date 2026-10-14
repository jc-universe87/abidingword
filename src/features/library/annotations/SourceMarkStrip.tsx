import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { BookPlus, Highlighter, StickyNote } from "lucide-react";
import { ActionMenu } from "@/design-system/ActionMenu";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { HighlightColors } from "@/features/scripture/HighlightColors";
import type { HighlightColor } from "@/types/scripture";
import { wholeParagraph, type SourceSelection, type StoredText } from "./sourceSelection";

// The same weight as the Bible's selection bar: when text is selected the
// reader should see at once that a choice is waiting.
const action = "inline-flex min-h-11 items-center gap-2 rounded-aw px-4 font-ui text-[1rem] font-semibold ";
const primary = action + "bg-primary text-on-primary hover:bg-primary-hover";
const outlined = action + "border-2 border-text-strong bg-bg text-text-strong hover:bg-bg-secondary";

type Step = { kind: "actions" } | { kind: "color" } | { kind: "note"; text: string };

/**
 * A place the person asked to write a note on without selecting words: a
 * paragraph (Reading), or a page and how far down it (Original PDF), with the
 * paragraph that begins there when there is one.
 */
export interface PlaceRequest {
  segmentId?: string;
  page?: number;
  fraction?: number;
  nonce: number;
}

interface Props {
  /** The element holding the view's text; only selections inside it are read. */
  root: RefObject<HTMLElement | null>;
  sourceId: string;
  /** Reads a selection inside `root` as an anchor in the stored text, or null when it cannot be anchored exactly. */
  read: (selection: Selection, root: HTMLElement) => SourceSelection | null;
  /** Said when text is selected that cannot be anchored exactly (Original PDF); otherwise such a selection is ignored. */
  cannotPlace?: string;
  /** The stored text of a paragraph on screen (for "Highlight this paragraph"); absent where it is not known. */
  stored?: (segmentId: string) => StoredText | undefined;
  /** "Add note here": a paragraph to write a note on, with no words selected. */
  place: PlaceRequest | null;
  /** The place request is finished (saved or cancelled); focus goes back where it came from. */
  onPlaceDone: () => void;
  onSaved: () => void;
  /** "Add to Study" for the selected words (v0.15); the strip closes and the reader asks where. */
  onAddToStudy?: (words: SourceSelection) => void;
  /** "Copy quotation with citation" for the selected words (v0.15). */
  onCopy?: (words: SourceSelection) => void;
}

/**
 * The small contextual bar for marking a source: Highlight and Add note for
 * selected text, or a note (or a highlight of the whole paragraph) for "Add
 * note here". It sits at the foot of the Reading view, in normal flow and
 * sticky, never floating over the text. The anchor is captured when the
 * selection settles and kept while a colour is chosen or a note is written.
 */
export function SourceMarkStrip({ root, sourceId, read: readSelection, cannotPlace, stored, place, onPlaceDone, onSaved, onAddToStudy, onCopy }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const bar = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<SourceSelection | null>(null);
  const [step, setStep] = useState<Step>({ kind: "actions" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Text is selected, but it cannot be anchored exactly (said only where `cannotPlace` is given).
  const [missed, setMissed] = useState(false);
  const frozen = step.kind !== "actions" || place !== null;
  const readRef = useRef(readSelection);
  useEffect(() => {
    readRef.current = readSelection;
  });

  const finish = useCallback(() => {
    // Focus was in the bar (keyboard): it goes back to the text the words were in, not lost with the bar.
    const hadFocus = !!bar.current?.contains(document.activeElement);
    const words = anchor;
    document.getSelection()?.removeAllRanges();
    setAnchor(null);
    setStep({ kind: "actions" });
    setError(null);
    if (!hadFocus || !words) return;
    requestAnimationFrame(() => {
      const element = root.current;
      const target =
        element?.querySelector<HTMLElement>(`[data-seg-position="${words.firstPosition}"]`) ??
        element?.querySelector<HTMLElement>("[role='region'][tabindex]") ??
        null;
      if (!target) return;
      if (!target.hasAttribute("tabindex")) {
        target.setAttribute("tabindex", "-1");
        target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
      }
      target.focus({ preventScroll: true });
    });
  }, [anchor, root]);

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
        const inside = selection && !selection.isCollapsed && selection.rangeCount > 0 && selection.getRangeAt(0).intersectsNode(element);
        const found = inside ? readRef.current(selection, element) : null;
        setAnchor(found);
        setMissed(!!inside && !found && !!selection.toString().trim());
        setError(null);
      }, 120);
    };
    document.addEventListener("selectionchange", read);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", read);
    };
  }, [root, frozen]);

  const placeText = place?.segmentId ? stored?.(place.segmentId) : undefined;
  if (!anchor && !place) {
    return missed && cannotPlace ? (
      <p role="status" data-aw-skip="" className="m-0 rounded-aw border border-border bg-bg-secondary px-4 py-2 font-ui text-[0.9375rem] text-text">
        {cannotPlace}
      </p>
    ) : null;
  }

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
        await api.sourceAnnotationCreate({ sourceId, kind: "note", content: input.content, place: { segmentId: place.segmentId, page: place.page, fraction: place.fraction } });
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
  const paragraph = !anchor && place?.segmentId && placeText ? wholeParagraph(place.segmentId, placeText) : null;

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
      <p className="m-0 text-[0.875rem] font-semibold text-text-strong">{quote !== null ? t("library.marks.selectedText") : place?.segmentId ? t("library.marks.noteHere") : t("library.marks.notePage")}</p>
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
          {anchor && onAddToStudy && (
            <button
              type="button"
              className={outlined}
              onClick={() => {
                const words = anchor;
                finish();
                onAddToStudy(words);
              }}
            >
              <BookPlus className="size-5" aria-hidden="true" /> {t("library.toStudy.add")}
            </button>
          )}
          {anchor && onCopy && <ActionMenu label={t("library.more")} actions={[{ label: t("library.copy.action"), onSelect: () => onCopy(anchor) }]} className="self-center" />}
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
