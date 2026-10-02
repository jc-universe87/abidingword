import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Highlighter, StickyNote } from "lucide-react";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { referenceLabel } from "@/i18n/scripture";
import type { Annotation, AnnotationKind } from "@/types/scripture";

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
  const [error, setError] = useState<string | null>(null);
  const exact = annotations.filter((a) => a.reference.canonical === canonical);
  const find = (kind: AnnotationKind) => exact.find((a) => a.kind === kind);
  const notes = annotations.filter((a) => a.kind === "note");

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const toggle = (kind: "highlight" | "bookmark") => {
    const existing = find(kind);
    return run(() => (existing ? api.annotationDelete(existing.id) : api.annotationCreate({ reference: canonical, kind })));
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
        <button type="button" className={tool} aria-pressed={!!find("highlight")} onClick={() => toggle("highlight")}>
          <Highlighter className="size-4" aria-hidden="true" /> {t("scripture.verseTools.highlight")}
        </button>
        <button type="button" className={tool} aria-pressed={!!find("bookmark")} onClick={() => toggle("bookmark")}>
          <Bookmark className="size-4" aria-hidden="true" /> {t("scripture.verseTools.bookmark")}
        </button>
      </div>

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
          <p className="reading m-0 whitespace-pre-wrap text-[1rem]">{note.content}</p>
          <p className="m-0 mt-1 text-[0.875rem] text-text-muted">
            {t("scripture.verseTools.on", { passage: referenceLabel(note.reference) })}
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
