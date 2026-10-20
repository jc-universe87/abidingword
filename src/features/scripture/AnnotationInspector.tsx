import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Highlighter, StickyNote, X } from "lucide-react";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { referenceLabel } from "@/i18n/scripture";
import { SWATCH_CLASS } from "@/lib/annotationRender";
import type { Annotation, HighlightColor } from "@/types/scripture";
import { HighlightColors } from "./HighlightColors";
import type { InspectorLayout } from "./usePaneLayout";

interface AnnotationInspectorProps {
  /** Id of the panel, so the controls that open it can point at it. */
  id: string;
  canonical: string;
  /** The verse number, for the labels ("Tools for verse 1"). */
  verse: number;
  /** Everything that covers this verse (whole-verse and phrase marks). */
  annotations: Annotation[];
  layout: InspectorLayout;
  onClose: () => void;
  onChanged: () => void;
}

const base =
  "inline-flex min-h-10 items-center gap-1.5 rounded-aw border border-border bg-bg px-3 font-ui text-[0.9375rem] " +
  "text-text-strong hover:bg-hover aria-pressed:border-accent aria-pressed:bg-note";

/**
 * Everything to do with the marks on one verse, in a panel at the foot of the
 * reader (a compact panel when the pane is wide, a full-width sheet when it is
 * narrow) instead of a block pushed in under the verse. Annotations belong to
 * the canonical verse, not the translation, so they stay when the reader
 * switches translation. Phrase marks that cover the verse are listed too, and
 * a mark whose wording is not in the translation on screen says so.
 *
 * Escape closes the innermost open thing first (colours, a note being
 * written), then the panel; focus goes to the heading when the panel opens.
 */
export function AnnotationInspector({ id, canonical, verse, annotations, layout, onClose, onChanged }: AnnotationInspectorProps) {
  const { t } = useTranslation();
  const api = useApi();
  const heading = useRef<HTMLHeadingElement>(null);
  const noteButton = useRef<HTMLButtonElement>(null);
  const highlightButton = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Whole-verse marks only: a highlighted phrase inside this verse is not a verse highlight.
  const wholeVerse = annotations.filter((a) => a.reference.canonical === canonical && !a.anchor);
  const verseHighlight = wholeVerse.find((a) => a.kind === "highlight");
  const bookmark = wholeVerse.find((a) => a.kind === "bookmark");
  const notes = annotations.filter((a) => a.kind === "note");
  const phrases = annotations.filter((a) => a.kind === "highlight" && a.anchor);

  // Opening says what opened: the heading takes focus.
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
      onChanged();
      return true;
    } catch (e) {
      setError(toApiError(e).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggleBookmark = () =>
    run(() => (bookmark ? api.annotationDelete(bookmark.id) : api.annotationCreate({ reference: canonical, kind: "bookmark" })));

  // Picking a colour highlights the verse, or recolours its existing highlight.
  const pickColor = async (color: HighlightColor) => {
    if (await run(() => api.annotationCreate({ reference: canonical, kind: "highlight", color }))) {
      setPicking(false);
      highlightButton.current?.focus();
    }
  };

  const removeHighlight = async () => {
    if (!verseHighlight) return;
    if (await run(() => api.annotationDelete(verseHighlight.id))) {
      setPicking(false);
      highlightButton.current?.focus();
    }
  };

  const saveNote = async () => {
    const text = draft?.trim();
    if (!text) return;
    // A failed save keeps the editor and what was typed.
    if (await run(() => api.annotationCreate({ reference: canonical, kind: "note", content: text }))) {
      setDraft(null);
      noteButton.current?.focus();
    }
  };

  // Something was deleted, so the button that was clicked is gone: keep focus in the panel.
  const afterRemoval = () => heading.current?.focus({ preventScroll: true });

  // Escape closes the innermost open thing first, then the panel itself.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    if (picking) {
      setPicking(false);
      highlightButton.current?.focus();
    } else if (draft !== null) {
      setDraft(null);
      noteButton.current?.focus();
    } else {
      onClose();
    }
  };

  const sheet = layout === "sheet";
  const actions = sheet ? "grid grid-cols-1 gap-1.5" : "flex flex-wrap gap-2";
  const action = `${base} ${sheet ? "w-full justify-start" : ""}`;

  return (
    <section
      id={id}
      role="region"
      aria-labelledby={`${id}-title`}
      data-layout={layout}
      onKeyDown={onKeyDown}
      className={`flex min-w-0 flex-col gap-3 overflow-y-auto rounded-aw border border-t-[4px] border-border border-t-accent bg-bg-secondary px-4 py-3 font-ui text-[0.9375rem] shadow-[0_-6px_20px_rgba(0,0,0,0.18)] ${
        sheet ? "max-h-[55vh]" : "max-h-[45vh]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={`${id}-title`} ref={heading} tabIndex={-1} className="type-group m-0">
          {t("scripture.verseTools.toolsFor", { verse })}
        </h3>
        <button type="button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")} className={`${base} min-h-10 min-w-10 justify-center px-2`}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className={actions}>
        <button ref={noteButton} type="button" className={action} onClick={() => setDraft(draft === null ? "" : null)} aria-expanded={draft !== null}>
          <StickyNote className="size-4" aria-hidden="true" /> {t("scripture.verseTools.addNote")}
        </button>
        <button
          ref={highlightButton}
          type="button"
          className={action}
          aria-pressed={!!verseHighlight}
          aria-expanded={picking}
          onClick={() => setPicking(!picking)}
        >
          <Highlighter className="size-4" aria-hidden="true" /> {t("scripture.verseTools.highlight")}
        </button>
        <button type="button" className={action} aria-pressed={!!bookmark} disabled={busy} onClick={() => void toggleBookmark()}>
          <Bookmark className={`size-4 ${bookmark ? "fill-current" : ""}`} aria-hidden="true" /> {t("scripture.verseTools.bookmark")}
        </button>
      </div>

      {picking && (
        <div className="flex flex-wrap items-center gap-3">
          <HighlightColors current={verseHighlight ? (verseHighlight.color ?? "amber") : null} onPick={(c) => void pickColor(c)} />
          {verseHighlight && (
            <button type="button" className={base} onClick={() => void removeHighlight()}>
              {t("scripture.verseTools.removeHighlight")}
            </button>
          )}
        </div>
      )}

      {draft !== null && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-text-strong">{t("scripture.verseTools.noteOn", { verse })}</span>
            <textarea
              autoFocus
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="reading w-full min-w-0 rounded-aw border-2 border-border bg-bg px-3 py-2 text-[1rem]"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => void saveNote()}
              className="min-h-10 rounded-aw bg-primary px-4 font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50"
            >
              {t("scripture.verseTools.saveNote")}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                noteButton.current?.focus();
              }}
              className={`${base} px-4`}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {phrases.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t("scripture.verseTools.markedWords", { verse })}>
          {phrases.map((mark) => (
            <PhraseHighlight key={mark.id} mark={mark} onChanged={onChanged} onRemoved={afterRemoval} />
          ))}
        </ul>
      )}

      {notes.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t("scripture.verseTools.notesOn", { verse })}>
          {notes.map((note) => (
            <SavedNote key={note.id} note={note} onChanged={onChanged} onRemoved={afterRemoval} />
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function PhraseHighlight({ mark, onChanged, onRemoved }: { mark: Annotation; onChanged: () => void; onRemoved: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const [recolouring, setRecolouring] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const quote = mark.anchor?.quote ?? "";
  const color = mark.color ?? "amber";

  const act = async (action: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await action();
      onChanged();
      after?.();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <li
      data-testid="phrase-highlight"
      className="flex flex-col gap-1.5 border-l-[3px] border-border-subtle pl-3"
      onKeyDown={(e) => {
        if (e.key === "Escape" && recolouring) {
          e.stopPropagation();
          setRecolouring(false);
          toggle.current?.focus();
        }
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span aria-hidden="true" className={`inline-block size-3 shrink-0 self-center rounded-full border border-border ${SWATCH_CLASS[color]}`} />
        <span className="text-text-muted">{t(`scripture.colors.${color}`)}</span>
        <q className="reading min-w-0 break-words text-[1rem]">{quote}</q>
        {mark.anchor && !mark.anchor.shown && <span className="text-text-muted">{t("scripture.verseTools.notShown")}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button ref={toggle} type="button" className="min-h-9 underline underline-offset-2" aria-expanded={recolouring} onClick={() => setRecolouring(!recolouring)}>
          {t("scripture.colors.label")}
        </button>
        <button
          type="button"
          className="min-h-9 underline underline-offset-2"
          onClick={() => void act(() => api.annotationDelete(mark.id), onRemoved)}
          aria-label={t("scripture.verseTools.removeHighlightOn", { quote })}
        >
          {t("scripture.verseTools.removeHighlight")}
        </button>
      </div>
      {recolouring && <HighlightColors current={color} onPick={(c) => void act(() => api.annotationUpdate({ id: mark.id, color: c }), () => setRecolouring(false))} />}
      {error && (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

function SavedNote({ note, onChanged, onRemoved }: { note: Annotation; onChanged: () => void; onRemoved: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.content);
  const [error, setError] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Leaving the editor puts focus back on Edit, once it is on screen again.
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  const stopEditing = () => {
    returnFocus.current = true;
    setText(note.content);
    setEditing(false);
  };

  const save = async () => {
    setError(null);
    try {
      await api.annotationUpdate({ id: note.id, content: text });
      returnFocus.current = true;
      setEditing(false);
      onChanged();
    } catch (e) {
      // The editor stays open with what was typed.
      setError(toApiError(e).message);
    }
  };

  const remove = async () => {
    setError(null);
    try {
      await api.annotationDelete(note.id);
      onChanged();
      onRemoved();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <li
      className="border-l-[3px] border-accent bg-note px-3 py-2"
      onKeyDown={(e) => {
        if (e.key === "Escape" && editing) {
          e.stopPropagation();
          stopEditing();
        }
      }}
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            aria-label={t("scripture.verseTools.editNote")}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="reading w-full min-w-0 rounded-aw border-2 border-border bg-bg px-3 py-2 text-[1rem]"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} className="min-h-10 rounded-aw bg-primary px-3 text-on-primary hover:bg-primary-hover">
              {t("common.save")}
            </button>
            <button type="button" onClick={stopEditing} className={`${base} px-3`}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <>
          {note.anchor && <q className="reading m-0 mb-1 block break-words text-[0.9375rem] text-text-muted">{note.anchor.quote}</q>}
          <p className="reading m-0 whitespace-pre-wrap break-words text-[1rem]">{note.content}</p>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2 type-meta">
            <span>
              {t("scripture.verseTools.on", { passage: referenceLabel(note.reference) })}
              {note.anchor && !note.anchor.shown && (
                <>
                  {t("common.listSeparator")}
                  {t("scripture.verseTools.notShown")}
                </>
              )}
            </span>
            <button ref={editButton} type="button" className="min-h-9 underline underline-offset-2" onClick={() => setEditing(true)}>
              {t("common.edit")}
            </button>
            <button type="button" className="min-h-9 underline underline-offset-2" onClick={() => void remove()}>
              {t("common.delete")}
            </button>
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
