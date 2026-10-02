import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Highlighter, StickyNote } from "lucide-react";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { coveredReference } from "@/lib/annotationRender";
import { anchorFromSelection, type SelectionAnchor } from "@/lib/selectionAnchor";
import type { HighlightColor } from "@/types/scripture";
import { HighlightColors } from "./HighlightColors";

const button =
  "inline-flex min-h-9 items-center gap-1.5 rounded-aw border border-border bg-bg px-3 font-ui text-[0.875rem] " +
  "text-text-strong hover:bg-bg-secondary";

type Step = { kind: "actions" } | { kind: "color" } | { kind: "note"; text: string };

interface Props {
  /** The element holding the verse texts; selections are read inside it. */
  root: RefObject<HTMLElement | null>;
  translationId: string;
  onSaved: () => void;
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
export function SelectionToolbar({ root, translationId, onSaved }: Props) {
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

  if (!anchor) return null;

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
      className="sticky bottom-2 z-10 flex flex-col gap-2 rounded-aw border border-border bg-surface p-3 font-ui text-[0.9375rem] shadow-md"
    >
      <p className="m-0 text-[0.8125rem] text-text-muted">{t("scripture.selection.selectedWords")}</p>
      <q className="reading m-0 line-clamp-3 break-words text-[1rem] text-text-strong" data-testid="selection-quote">
        {anchor.quote}
      </q>

      {step.kind === "actions" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => setStep({ kind: "note", text: "" })}>
            <StickyNote className="size-4" aria-hidden="true" /> {t("scripture.verseTools.addNote")}
          </button>
          <button type="button" className={button} onClick={() => setStep({ kind: "color" })}>
            <Highlighter className="size-4" aria-hidden="true" /> {t("scripture.verseTools.highlight")}
          </button>
        </div>
      )}

      {step.kind === "color" && (
        <div className="flex flex-wrap items-center gap-3">
          <HighlightColors onPick={(color) => !busy && save({ kind: "highlight", color })} />
          <button type="button" className={button} onClick={cancel}>
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
              className="reading rounded-aw border border-border bg-bg px-3 py-2 text-[1rem]"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !step.text.trim()}
              onClick={() => save({ kind: "note", content: step.text.trim() })}
              className="min-h-9 rounded-aw bg-primary px-4 font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50"
            >
              {t("scripture.verseTools.saveNote")}
            </button>
            <button type="button" onClick={cancel} className="min-h-9 rounded-aw border border-border px-4 hover:bg-bg-secondary">
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
