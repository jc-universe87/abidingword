import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Highlighter, StickyNote } from "lucide-react";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { referenceLabel } from "@/i18n/scripture";
import { SWATCH_CLASS } from "@/lib/annotationRender";
import type { Annotation, AnnotationKind, HighlightColor } from "@/types/scripture";
import { HighlightColors } from "./HighlightColors";

interface VerseToolsProps {
  canonical: string;
  /** The verse number, for the tools' labels ("Tools for verse 1"). */
  verse: number;
  annotations: Annotation[];
  onChanged: () => void;
}

const tool =
  "inline-flex min-h-9 items-center gap-1.5 rounded-aw border border-border bg-bg px-3 font-ui text-[0.875rem] " +
  "text-text-strong hover:bg-bg-secondary aria-pressed:border-accent aria-pressed:bg-note";

/**
 * Notes, highlight and bookmark for one verse. Annotations belong to the
 * canonical verse, not the translation, so they stay when the reader
 * switches translation.
 */
export function VerseTools({ canonical, verse, annotations, onChanged }: VerseToolsProps) {
  const { t } = useTranslation();
  const api = useApi();
  const [draft, setDraft] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whole-verse marks only: a highlighted phrase inside this verse is not a verse highlight.
  const exact = annotations.filter((a) => a.reference.canonical === canonical && !a.anchor);
  const find = (kind: AnnotationKind) => exact.find((a) => a.kind === kind);
  const notes = annotations.filter((a) => a.kind === "note");
  const phrases = annotations.filter((a) => a.kind === "highlight" && a.anchor);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const toggleBookmark = () => {
    const existing = find("bookmark");
    return run(() => (existing ? api.annotationDelete(existing.id) : api.annotationCreate({ reference: canonical, kind: "bookmark" })));
  };

  // Picking a colour highlights the verse, or recolours its existing highlight.
  const pickColor = (color: HighlightColor) =>
    run(async () => {
      await api.annotationCreate({ reference: canonical, kind: "highlight", color });
      setPicking(false);
    });

  const removeHighlight = () => {
    const existing = find("highlight");
    return run(async () => {
      if (existing) await api.annotationDelete(existing.id);
      setPicking(false);
    });
  };

  const saveNote = () =>
    run(async () => {
      if (draft?.trim()) await api.annotationCreate({ reference: canonical, kind: "note", content: draft.trim() });
      setDraft(null);
    });

  return (
    <div className="mt-2 mb-1 flex flex-col gap-2 font-ui text-[0.9375rem]" role="group" aria-label={t("scripture.verseTools.toolsFor", { verse })}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={tool} onClick={() => setDraft(draft === null ? "" : null)} aria-expanded={draft !== null}>
          <StickyNote className="size-4" aria-hidden="true" /> {t("scripture.verseTools.addNote")}
        </button>
        <button type="button" className={tool} aria-pressed={!!find("highlight")} aria-expanded={picking} onClick={() => setPicking(!picking)}>
          <Highlighter className="size-4" aria-hidden="true" /> {t("scripture.verseTools.highlight")}
        </button>
        <button type="button" className={tool} aria-pressed={!!find("bookmark")} onClick={toggleBookmark}>
          <Bookmark className="size-4" aria-hidden="true" /> {t("scripture.verseTools.bookmark")}
        </button>
      </div>

      {picking && (
        <div className="flex flex-wrap items-center gap-3">
          <HighlightColors current={find("highlight")?.color ?? (find("highlight") ? "amber" : null)} onPick={pickColor} />
          {find("highlight") && (
            <button type="button" className={tool} onClick={removeHighlight}>
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
              className="reading rounded-aw border border-border bg-bg px-3 py-2 text-[1rem]"
            />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={saveNote} className="min-h-9 rounded-aw bg-primary px-4 font-medium text-on-primary hover:bg-primary-hover">
              {t("scripture.verseTools.saveNote")}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="min-h-9 rounded-aw border border-border px-4 hover:bg-bg-secondary">
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {phrases.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={t("scripture.verseTools.markedWords", { verse })}>
          {phrases.map((mark) => (
            <PhraseHighlight key={mark.id} mark={mark} onChanged={onChanged} />
          ))}
        </ul>
      )}

      {notes.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t("scripture.verseTools.notesOn", { verse })}>
          {notes.map((note) => (
            <SavedNote key={note.id} note={note} onChanged={onChanged} />
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function PhraseHighlight({ mark, onChanged }: { mark: Annotation; onChanged: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const quote = mark.anchor?.quote ?? "";
  const remove = async () => {
    setError(null);
    try {
      await api.annotationDelete(mark.id);
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-[0.875rem]" data-testid="phrase-highlight">
      <span aria-hidden="true" className={`inline-block size-3 shrink-0 self-center rounded-full border border-border ${SWATCH_CLASS[mark.color ?? "amber"]}`} />
      <span className="text-text-muted">{t(`scripture.colors.${mark.color ?? "amber"}`)}</span>
      <q className="reading text-[1rem]">{quote}</q>
      {mark.anchor && !mark.anchor.shown && <span className="text-text-muted">{t("scripture.verseTools.notShown")}</span>}
      <button type="button" className="underline underline-offset-2" onClick={remove} aria-label={t("scripture.verseTools.removeHighlightOn", { quote })}>
        {t("scripture.verseTools.removeHighlight")}
      </button>
      {error && <span role="alert" className="text-danger">{error}</span>}
    </li>
  );
}

function SavedNote({ note, onChanged }: { note: Annotation; onChanged: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.content);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <li className="border-l-[3px] border-accent bg-note px-3 py-2">
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            aria-label={t("scripture.verseTools.editNote")}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="reading rounded-aw border border-border bg-bg px-3 py-2 text-[1rem]"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => act(() => api.annotationUpdate({ id: note.id, content: text }))} className="min-h-9 rounded-aw bg-primary px-3 text-on-primary">
              {t("common.save")}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="min-h-9 rounded-aw border border-border px-3">
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <>
          {note.anchor && <q className="reading m-0 mb-1 block text-[0.9375rem] text-text-muted">{note.anchor.quote}</q>}
          <p className="reading m-0 whitespace-pre-wrap text-[1rem]">{note.content}</p>
          <p className="m-0 mt-1 text-[0.875rem] text-text-muted">
            {t("scripture.verseTools.on", { passage: referenceLabel(note.reference) })}
            {note.anchor && !note.anchor.shown && (
              <>
                {t("common.listSeparator")}
                {t("scripture.verseTools.notShown")}
              </>
            )}
            {t("common.listSeparator")}
            <button type="button" className="underline underline-offset-2" onClick={() => setEditing(true)}>
              {t("common.edit")}
            </button>
            {t("common.listSeparator")}
            <button type="button" className="underline underline-offset-2" onClick={() => act(() => api.annotationDelete(note.id))}>
              {t("common.delete")}
            </button>
          </p>
        </>
      )}
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
    </li>
  );
}
