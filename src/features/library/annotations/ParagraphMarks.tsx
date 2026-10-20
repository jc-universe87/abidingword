import { useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Bookmark, BookPlus, Highlighter, Layers, StickyNote, X } from "lucide-react";
import { ActionMenu } from "@/design-system/ActionMenu";
import { Button } from "@/design-system/Button";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { SWATCH_CLASS } from "@/lib/annotationRender";
import { HighlightColors } from "@/features/scripture/HighlightColors";
import type { SourceAnnotation, SourceAnnotationKind } from "@/types/library";

const KIND_ORDER: SourceAnnotationKind[] = ["highlight", "note", "bookmark"];
const ICON = { highlight: Highlighter, note: StickyNote, bookmark: Bookmark } as const;

/** The kinds present, in a fixed order, named for people. */
export function kindsLabel(t: TFunction, marks: SourceAnnotation[]): string {
  return KIND_ORDER.filter((k) => marks.some((m) => m.kind === k))
    .map((k) => t(`library.marks.kind.${k}`))
    .join(t("common.listSeparator"));
}

/**
 * The quiet button at the end of a paragraph that has marks: one icon (or a
 * stack for several kinds) and a full spoken summary, so a mark is never
 * colour alone. Not part of the source's text (never counted in a selection).
 */
export function MarksMarker({ marks, open, controls, onToggle }: { marks: SourceAnnotation[]; open: boolean; controls: string; onToggle: (button: HTMLButtonElement) => void }) {
  const { t } = useTranslation();
  const kinds = new Set(marks.map((m) => m.kind));
  const only = kinds.size === 1 ? [...kinds][0]! : null;
  const Icon = only ? ICON[only] : Layers;
  const label = t("library.marks.marker", { count: marks.length, kinds: kindsLabel(t, marks) });
  return (
    <button
      type="button"
      data-aw-skip=""
      data-source-marker=""
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      aria-label={label}
      title={label}
      onClick={(e) => onToggle(e.currentTarget)}
      className="-my-1.5 ml-1 inline-flex size-8 select-none items-center justify-center rounded align-middle text-accent hover:bg-hover"
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  );
}

/** What can be done with a mark besides editing it (v0.15). */
export interface MarkActions {
  /** "Add to Study" for a highlight or a note; told the button, so focus can come back to it. */
  onAddToStudy?: (mark: SourceAnnotation, from: HTMLElement | null) => void;
  /** "Copy quotation with citation" for marked words. */
  onCopy?: (mark: SourceAnnotation) => void;
}

interface InspectorProps extends MarkActions {
  id: string;
  marks: SourceAnnotation[];
  onChanged: () => void;
  onClose: () => void;
}

/**
 * The marks of one paragraph, below it: each highlight (colour, remove),
 * note (read, edit, delete) and bookmark (remove). Escape closes the
 * innermost open thing first, then the panel.
 */
export function MarksInspector({ id, marks, onChanged, onClose, onAddToStudy, onCopy }: InspectorProps) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-aw-skip=""
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
      className="flex select-none flex-col gap-3 rounded-aw border border-border border-l-[3px] border-l-accent bg-bg-secondary px-4 py-3 font-ui text-[0.9375rem]"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={`${id}-title`} ref={heading} tabIndex={-1} className="type-group m-0">
          {t("library.marks.here")}
        </h3>
        <Button variant="quiet" aria-label={t("common.close")} title={t("common.close")} onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {marks.map((mark) => (
          <li key={mark.id}>
            <MarkItem mark={mark} onChanged={onChanged} onAddToStudy={onAddToStudy} onCopy={onCopy} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function MarkItem({ mark, onChanged, onAddToStudy, onCopy }: { mark: SourceAnnotation; onChanged: () => void } & MarkActions) {
  const { t } = useTranslation();
  const api = useApi();
  const [mode, setMode] = useState<"view" | "colour" | "edit">("view");
  const [text, setText] = useState(mark.content);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const Icon = ICON[mark.kind];

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setMode("view");
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  // Escape leaves an open step before it closes the panel.
  const leaveStep = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && mode !== "view") {
      e.preventDefault();
      setMode("view");
      setText(mark.content);
    }
  };

  return (
    <div className="flex flex-col gap-2" onKeyDown={leaveStep}>
      <p className="type-group m-0 flex items-center gap-2">
        <Icon className="size-4 text-accent" aria-hidden="true" />
        {t(`library.marks.kind.${mark.kind}`)}
        {mark.color && (
          <>
            <span aria-hidden="true" className={`inline-block size-3.5 rounded-full border border-text-muted ${SWATCH_CLASS[mark.color]}`} />
            <span className="font-normal text-text-muted">{t("library.marks.colourIs", { color: t(`scripture.colors.${mark.color}`) })}</span>
          </>
        )}
      </p>
      {mark.quote !== null ? (
        <q className="reading m-0 line-clamp-4 whitespace-pre-line break-words border-l-[3px] border-border bg-bg px-3 py-1 text-[1rem] text-text [quotes:none]">{mark.quote}</q>
      ) : mark.kind === "note" ? (
        <p className="m-0 text-text-muted">{t("library.marks.wholeParagraph")}</p>
      ) : null}
      {mark.kind === "note" && mode !== "edit" && <p className="reading m-0 whitespace-pre-wrap break-words text-[1rem] text-text-strong">{mark.content}</p>}

      {mode === "edit" && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="sr-only">{t("library.marks.noteField")}</span>
            <textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} className="reading select-text rounded-aw border-2 border-border bg-bg px-3 py-2 text-[1rem]" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy || !text.trim()} onClick={() => void run(() => api.sourceAnnotationUpdate({ id: mark.id, content: text.trim() }))}>
              {t("library.marks.saveNote")}
            </Button>
            <Button
              onClick={() => {
                setMode("view");
                setText(mark.content);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      {mode === "colour" && (
        <div className="flex flex-wrap items-center gap-3">
          <HighlightColors current={mark.color} onPick={(color) => !busy && void run(() => api.sourceAnnotationUpdate({ id: mark.id, color }))} />
          <Button onClick={() => setMode("view")}>{t("common.cancel")}</Button>
        </div>
      )}
      {mode === "view" && (
        <div className="flex flex-wrap gap-2">
          {mark.kind !== "bookmark" && onAddToStudy && (
            <Button onClick={(e) => onAddToStudy(mark, e.currentTarget)}>
              <BookPlus className="size-4" aria-hidden="true" /> {t("library.toStudy.add")}
            </Button>
          )}
          {mark.kind === "highlight" && (
            <>
              <Button aria-expanded={false} onClick={() => setMode("colour")}>
                {t("library.marks.changeColour")}
              </Button>
              <Button disabled={busy} onClick={() => void run(() => api.sourceAnnotationDelete(mark.id))}>
                {t("library.marks.removeHighlight")}
              </Button>
            </>
          )}
          {mark.kind === "note" && (
            <>
              <Button onClick={() => setMode("edit")}>{t("library.marks.editNote")}</Button>
              <Button disabled={busy} onClick={() => void run(() => api.sourceAnnotationDelete(mark.id))}>
                {t("library.marks.deleteNote")}
              </Button>
            </>
          )}
          {mark.kind === "bookmark" && (
            <Button disabled={busy} onClick={() => void run(() => api.sourceAnnotationDelete(mark.id))}>
              {t("library.marks.removeBookmark")}
            </Button>
          )}
          {mark.quote !== null && onCopy && <ActionMenu label={t("library.more")} actions={[{ label: t("library.copy.action"), onSelect: () => onCopy(mark) }]} />}
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
