import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { InquiryPanel, type KeepTarget } from "@/features/ai/InquiryPanel";
import { COMPARE_MAX, useComparison } from "@/features/ai/Comparison";
import { useStudyFocus } from "@/features/studies/StudyFocus";
import { useApi } from "@/lib/ApiContext";
import { SOURCE_INQUIRIES, type ExcerptInput, type SourceLink } from "@/types/inquiry";
import { useLibraryNav } from "./LibraryNav";

/** The Bible Study open in the Study pane, if any: where help can be kept, and what can be included. */
function useOpenStudy(): KeepTarget | null {
  const api = useApi();
  const focus = useStudyFocus();
  const [study, setStudy] = useState<KeepTarget | null>(null);
  useEffect(() => {
    let active = true;
    if (!focus.openStudyId) return;
    api.studyGet(focus.openStudyId).then(
      (d) => active && setStudy({ studyId: d.study.id, studyTitle: d.study.title, sectionId: focus.activeSectionId }),
      () => active && setStudy(null),
    );
    return () => {
      active = false;
    };
  }, [api, focus.openStudyId, focus.activeSectionId]);
  return focus.openStudyId ? study : null;
}

/** Opens quoted words in their source, exactly where they are. */
function useOpenQuoted() {
  const { openSource } = useLibraryNav();
  return useCallback(
    (link: SourceLink) =>
      openSource(link.sourceId, link.start.segmentId, undefined, {
        startSegmentId: link.start.segmentId,
        startOffset: link.start.offset,
        endSegmentId: link.end.segmentId,
        endOffset: link.end.offset,
      }),
    [openSource],
  );
}

function IncludeStudy({ study, include, onChange }: { study: KeepTarget | null; include: boolean; onChange: (on: boolean) => void }) {
  const { t } = useTranslation();
  if (!study) return <p className="m-0 type-meta">{t("library.inquiry.noStudy")}</p>;
  return (
    <label className="flex min-h-11 items-start gap-2">
      <input type="checkbox" className="mt-1 size-4" checked={include} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {t("library.inquiry.includeStudy", { study: study.studyTitle })}
        <span className="block type-meta">{t("library.inquiry.includeStudyHint")}</span>
      </span>
    </label>
  );
}

/**
 * Help with words selected in a library source (v0.20): only those words,
 * checked against the source's stored text, with the source's title, author
 * and place; the person's open Bible Study only when they include it.
 */
export function SourceHelp({ excerpt, onClose }: { excerpt: ExcerptInput; onClose: () => void }) {
  const { t } = useTranslation();
  const study = useOpenStudy();
  const openQuoted = useOpenQuoted();
  const [include, setInclude] = useState(false);
  const scope = { kind: "source" as const, excerpt, studyId: include && study ? study.studyId : null };
  const [stable, setStable] = useState(scope);
  if (stable.excerpt !== scope.excerpt || stable.studyId !== scope.studyId) setStable(scope);
  return (
    <InquiryPanel
      title={t("library.inquiry.title")}
      scope={stable}
      actions={SOURCE_INQUIRIES}
      focus={
        <q className="reading m-0 line-clamp-4 whitespace-pre-line break-words border-l-[3px] border-accent bg-bg px-3 py-1.5 text-[1rem] text-text-strong [quotes:none]">
          {excerpt.quote}
        </q>
      }
      extra={<IncludeStudy study={study} include={include} onChange={setInclude} />}
      keep={study}
      keepNote={t("library.inquiry.keepNote")}
      onOpenSource={openQuoted}
      onClose={onClose}
    />
  );
}

/** The passages put aside to compare, shown in the reader while there are any. */
export function ComparisonTray({ onCompare }: { onCompare: () => void }) {
  const { t } = useTranslation();
  const { passages, remove, clear } = useComparison();
  if (passages.length === 0) return null;
  return (
    <section aria-label={t("library.compare.tray")} className="flex shrink-0 flex-col gap-1 border-b border-border-subtle bg-bg-secondary px-4 py-2 font-ui text-[0.9375rem]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-text-strong">{t("library.compare.count", { count: passages.length, max: COMPARE_MAX })}</span>
        <button
          type="button"
          disabled={passages.length < 2}
          onClick={onCompare}
          className="min-h-11 rounded-aw bg-primary px-3 font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50"
        >
          {t("library.compare.compare")}
        </button>
        <button type="button" onClick={clear} className="min-h-11 rounded-aw px-2 text-text-muted hover:bg-hover hover:text-text-strong">
          {t("library.compare.clear")}
        </button>
        {passages.length < 2 && <span className="type-meta">{t("library.compare.needTwo")}</span>}
      </div>
      <ol className="m-0 flex list-decimal flex-col gap-0.5 pl-6">
        {passages.map((p, i) => (
          <li key={i}>
            <span className="flex items-start gap-1">
              <span className="min-w-0 flex-1 break-words">
                <span className="line-clamp-1">“{p.excerpt.quote}”</span>
                <span className="type-meta">
                  {p.title}
                  {p.author ? `, ${p.author}` : ""}
                  {p.locator ? ` · ${p.locator}` : ""}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={t("library.compare.remove", { title: p.title })}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-aw text-text-muted hover:bg-hover hover:text-text-strong"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Comparing the passages in the tray: only those, nothing searched. */
export function CompareHelp({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { passages } = useComparison();
  const study = useOpenStudy();
  const openQuoted = useOpenQuoted();
  const excerpts = passages.map((p) => p.excerpt);
  const [scope] = useState(() => ({ kind: "compare" as const, excerpts, studyId: null }));
  return (
    <InquiryPanel
      title={t("library.compare.title", { count: excerpts.length })}
      scope={scope.excerpts.length >= 2 ? scope : null}
      problem={scope.excerpts.length < 2 ? t("library.compare.needTwo") : null}
      actions={["compare", "free"]}
      keep={study}
      keepNote={t("library.inquiry.keepNote")}
      onOpenSource={openQuoted}
      onClose={onClose}
    />
  );
}
