import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Highlighter, StickyNote, X } from "lucide-react";
import { Button } from "@/design-system/Button";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { SWATCH_CLASS } from "@/lib/annotationRender";
import type { SourceAnnotation } from "@/types/library";
import type { ContentsLayout } from "../ContentsPanel";
import { locatorLabel } from "../labels";

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
}

/**
 * This source's marks in reading order, beside its contents: each one a way
 * back to its place. A mark that can no longer be found in the text is listed
 * last with its words, never moved; it can be deleted here.
 */
export function SourceMarksPanel({ id, title, marks, layout, switcher, onSelect, onChanged, onClose }: Props) {
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
        <h3 ref={heading} tabIndex={-1} className="m-0 font-display text-[1.0625rem] font-heading text-text-strong">
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
                <MarkRow mark={mark} onSelect={() => onSelect(mark)} onChanged={onChanged} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function MarkRow({ mark, onSelect, onChanged }: { mark: SourceAnnotation; onSelect: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const Icon = ICON[mark.kind];
  const place = mark.locator ? locatorLabel(t, mark.locator, mark.pageNumber ?? undefined) : null;
  const body = (
    <>
      <span className="flex flex-wrap items-center gap-x-2 text-[0.875rem] text-text-muted">
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
  if (mark.state !== "unresolved") {
    return (
      <button type="button" onClick={onSelect} className="flex w-full flex-col gap-0.5 rounded-aw px-2 py-1.5 text-left hover:bg-bg-secondary">
        {body}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-aw border border-dashed border-border px-2 py-1.5">
      {body}
      <p className="m-0 text-[0.875rem] text-text-muted">{t("library.marks.unresolved")}</p>
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
