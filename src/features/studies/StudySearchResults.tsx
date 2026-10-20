import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowLeft } from "lucide-react";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { useApi } from "@/lib/ApiContext";
import { highlighted } from "@/lib/highlight";
import type { StudySearchHit } from "@/types/studies";
import { sectionTitle } from "./builtinText";
import { findingLabel } from "./labels";

interface Props {
  query: string;
  onOpen: (study: { id: string; projectId: string }) => void;
  onClose: () => void;
}

/** Where a match is, in the interface language. */
function locationLabel(t: TFunction, hit: StudySearchHit): string {
  switch (hit.kind) {
    case "study":
      return t("studies.search.location.study");
    case "section":
      return t("studies.search.location.section");
    case "block":
      return hit.sectionTitle !== null
        ? sectionTitle({ key: hit.sectionKey, title: hit.sectionTitle })
        : t("studies.search.location.studyText");
    case "finding":
      return hit.findingType
        ? t("studies.search.location.findingType", { type: findingLabel(t, hit.findingType) })
        : t("studies.search.location.finding");
    default:
      return hit.location;
  }
}

/** Results of a search across the user's studies (not Scripture). */
export function StudySearchResults({ query, onOpen, onClose }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const hits = useLoad(useCallback(() => api.studySearch(query), [api, query]));
  return (
    <section aria-labelledby="study-search-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="study-search-title" className="type-title m-0">
          {t("studies.search.heading", { query })}
        </h1>
        <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-strong hover:bg-hover">
          <ArrowLeft className="size-4" aria-hidden="true" /> {t("common.back")}
        </button>
      </div>
      {hits.error && <Notice tone="error">{hits.error.message}</Notice>}
      {hits.loading && <p role="status" className="m-0 text-text-muted">{t("studies.search.searching")}</p>}
      {hits.data && (
        <>
          <p role="status" className="m-0 text-[0.9375rem] text-text-muted">
            {hits.data.length === 0 ? t("studies.search.none") : t("studies.search.count", { count: hits.data.length })}
          </p>
          <ol aria-label={t("studies.search.results")} className="m-0 flex list-none flex-col p-0">
            {hits.data.map((hit, index) => (
              <li key={`${hit.studyId}-${index}`} className="border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => onOpen({ id: hit.studyId, projectId: hit.projectId })}
                  className="flex w-full flex-col items-start gap-1 px-1 py-3 text-left hover:bg-hover"
                >
                  <span className="type-item">{hit.studyTitle}</span>
                  <span className="text-[0.9375rem] text-text-muted">{locationLabel(t, hit)}</span>
                  <span className="reading text-[1rem]">{highlighted(hit.snippet)}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
