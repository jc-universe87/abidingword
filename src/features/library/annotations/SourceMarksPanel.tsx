import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Highlighter, StickyNote, X } from "lucide-react";
import { ActionMenu, type MenuAction } from "@/design-system/ActionMenu";
import { Button } from "@/design-system/Button";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { SWATCH_CLASS } from "@/lib/annotationRender";
import type { SourceAnnotation } from "@/types/library";
import type { ContentsLayout } from "../ContentsPanel";
import { locatorLabel } from "../labels";
import type { MarkActions } from "./ParagraphMarks";

const ICON = { highlight: Highlighter, note: StickyNote, bookmark: Bookmark } as const;

interface Props {
  id?: string;
  title: string;
  marks: SourceAnnotation[];
  layout: ContentsLayout;
  /** "Contents | Marks", when the source has contents too. */
  switcher?: React.ReactNode;
  onSelect: (mark: SourceAnnotation) => void;
  onChanged: () => void;
  onClose: () => void;
  /** "Add to Study" and "Copy quotation with citation" for a mark (v0.15). */
  actions?: MarkActions;
}

/**
 * This source's marks in reading order, beside its contents: each one a way
 * back to its place. A mark that can no longer be found in the text is listed
 * last with its words, never moved; it can be deleted here.
 */
export function SourceMarksPanel({ id, title, marks, layout, switcher, onSelect, onChanged, onClose, actions }: Props) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  const place = layout === "sheet" ? "absolute inset-0" : "absolute inset-y-0 left-0 w-80 max-w-[85%] border-r border-border shadow-lg";
  return (
    <section
      id={id}
      aria-label={t("library.marks.for", { title })}
      data-testid="marks-panel"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className={`${place} z-20 flex min-h-0 flex-col bg-bg font-ui`}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-1.5">
        <h3 ref={heading} tabIndex={-1} className="type-group m-0">
          {t("library.marks.title")}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          {switcher}
          <Button variant="quiet" aria-label={t("library.marks.close")} title={t("library.marks.close")} onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {marks.length === 0 ? (
          <p className="m-0 px-2 py-3 text-text-muted">{t("library.marks.empty")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {marks.map((mark) => (
              <li key={mark.id}>
                <MarkRow
                  mark={mark}
                  actions={actions}
                  onSelect={() => onSelect(mark)}
                  onChanged={() => {
                    onChanged();
                    // The row (and the button that had focus) is gone: focus stays in the panel.
                    heading.current?.focus({ preventScroll: true });
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function MarkRow({ mark, onSelect, onChanged, actions }: { mark: SourceAnnotation; onSelect: () => void; onChanged: () => void; actions?: MarkActions }) {
  const { t } = useTranslation();
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const Icon = ICON[mark.kind];
  const place = mark.locator ? locatorLabel(t, mark.locator, mark.pageNumber ?? undefined) : null;
  const body = (
    <>
      <span className="flex flex-wrap items-center gap-x-2 type-meta">
        <Icon className="size-3.5 text-accent" aria-hidden="true" />
        <span className="font-medium text-text-strong">{t(`library.marks.kind.${mark.kind}`)}</span>
        {mark.color && <span aria-hidden="true" className={`inline-block size-3 rounded-full border border-text-muted ${SWATCH_CLASS[mark.color]}`} />}
        {mark.color && <span className="sr-only">{t("library.marks.colourIs", { color: t(`scripture.colors.${mark.color}`) })}</span>}
        {place && <span>{place}</span>}
      </span>
      {mark.quote && <span className="reading line-clamp-2 whitespace-pre-line text-[0.9375rem] italic text-text">“{mark.quote}”</span>}
      {mark.kind === "note" && mark.content && <span className="line-clamp-3 whitespace-pre-wrap text-[0.9375rem] text-text">{mark.content}</span>}
    </>
  );
  // Quiet actions beside the row, never instead of going to the mark.
  const more: MenuAction[] = [];
  if (mark.kind !== "bookmark" && actions?.onAddToStudy) {
    const onAdd = actions.onAddToStudy;
    more.push({ label: t("library.toStudy.add"), onSelect: (opener) => onAdd(mark, opener) });
  }
  const onCopy = actions?.onCopy;
  if (mark.quote !== null && onCopy) more.push({ label: t("library.copy.action"), onSelect: () => onCopy(mark) });
  const menu = more.length > 0 ? (
    <span className="shrink-0">
      <ActionMenu label={t("library.more")} actions={more} />
    </span>
  ) : null;
  if (mark.state !== "unresolved") {
    return (
      <div className="flex items-start gap-1">
        <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-aw px-2 py-1.5 text-left hover:bg-hover">
          {body}
        </button>
        {menu}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-aw border border-dashed border-border px-2 py-1.5">
      <div className="flex items-start gap-1">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">{body}</div>
        {menu}
      </div>
      <p className="m-0 type-meta">{t("library.marks.unresolved")}</p>
      <Button
        className="self-start"
        onClick={() =>
          void api.sourceAnnotationDelete(mark.id).then(
            () => onChanged(),
            (e: unknown) => setError(toApiError(e).message),
          )
        }
      >
        {t("library.marks.delete")}
      </Button>
      {error && (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
