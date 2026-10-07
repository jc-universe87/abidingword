import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { Notice } from "@/design-system/Notice";
import { referenceLabel } from "@/i18n/scripture";
import { useLoad } from "@/hooks/useLoad";
import { useApi } from "@/lib/ApiContext";
import type { Project } from "@/types/domain";
import { STUDY_STATUSES, STUDY_TYPES, type StudyStatus, type StudySummary, type StudyType } from "@/types/studies";
import { formatDate } from "./format";
import { statusLabel, studyTypeLabel } from "./labels";

interface StudyListProps {
  /** Limit to one project; otherwise all studies with a project filter. */
  projectId?: string;
  projects?: Project[];
  onOpen: (study: StudySummary) => void;
  /** Bump to reload after a change elsewhere. */
  version?: number;
}

const select = "h-11 rounded-aw border border-border bg-bg px-2 text-[0.9375rem]";

/** A list shorter than this has no filters to offer: they would be more noise than help. */
export const LIST_FILTER_MIN = 6;

/** A filterable list of studies: title, type, main passage, status, date. */
export function StudyList({ projectId, projects, onOpen, version = 0 }: StudyListProps) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const [studyType, setStudyType] = useState<StudyType | "">("");
  const [status, setStatus] = useState<StudyStatus | "">("");
  const [project, setProject] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const scope = projectId ?? (project || undefined);
  const studies = useLoad(
    useCallback(
      () =>
        api.studyList({
          projectId: scope,
          studyType: studyType || undefined,
          status: status || undefined,
        }),
      // `version` forces a reload after changes made elsewhere.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [api, scope, studyType, status, version],
    ),
  );

  const loaded = studies.data ?? [];
  const filtering = Boolean(studyType || status || project);
  // Archived studies stay out of the way unless asked for (or chosen as the status filter).
  const archived = loaded.filter((s) => s.status === "archived");
  const archivedShown = showArchived || status === "archived";
  const visible = archivedShown ? loaded : loaded.filter((s) => s.status !== "archived");
  const showFilters = filtering || loaded.length >= LIST_FILTER_MIN;

  return (
    <div className="flex flex-col gap-3">
      {showFilters && (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.9375rem]" role="group" aria-label={t("studies.list.filters")}>
        {!projectId && projects && (
          <label className="flex items-center gap-2">
            <span>{t("studies.list.project")}</span>
            <select value={project} onChange={(e) => setProject(e.target.value)} className={select}>
              <option value="">{t("studies.list.allProjects")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2">
          <span>{t("studies.list.type")}</span>
          <select value={studyType} onChange={(e) => setStudyType(e.target.value as StudyType | "")} className={select}>
            <option value="">{t("studies.list.allTypes")}</option>
            {STUDY_TYPES.map((type) => (
              <option key={type} value={type}>{studyTypeLabel(t, type)}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span>{t("studies.list.status")}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as StudyStatus | "")} className={select}>
            <option value="">{t("studies.list.anyStatus")}</option>
            {STUDY_STATUSES.map((s) => (
              <option key={s} value={s}>{statusLabel(t, s)}</option>
            ))}
          </select>
        </label>
      </div>
      )}

      {studies.error && <Notice tone="error">{studies.error.message}</Notice>}
      {studies.loading && <p className="m-0 text-text-muted">{t("studies.list.loading")}</p>}
      {studies.data && visible.length === 0 && (
        <p className="m-0 text-text-muted">
          {filtering || archived.length > 0 ? t("studies.list.noMatch") : t("studies.list.empty")}
        </p>
      )}
      {studies.data && visible.length > 0 && (
        <ul id={id} aria-label={t("studies.list.listLabel")} className="m-0 list-none border-t border-border-subtle p-0">
          {visible.map((study) => (
            <li key={study.id} className="border-b border-border-subtle">
              <button
                type="button"
                onClick={() => onOpen(study)}
                className="flex w-full items-center gap-4 px-2 py-3 text-left hover:bg-bg-secondary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[1.25rem] font-heading text-text-strong">{study.title}</span>
                  <span className="mt-1 block text-[0.9375rem] text-text-muted">
                    {[
                      studyTypeLabel(t, study.studyType),
                      study.primaryPassage && referenceLabel(study.primaryPassage),
                      !projectId && study.projectTitle,
                    ]
                      .filter(Boolean)
                      .join(t("common.listSeparator"))}
                  </span>
                  <span className="block text-[0.9375rem] text-text-muted">
                    {[
                      // "Active" is what a study is; only a different state is worth saying
                      study.status !== "active" && statusLabel(t, study.status),
                      study.findingCount > 0 && t("studies.findingCount", { count: study.findingCount }),
                      t("studies.list.changed", { date: formatDate(study.updatedAt) }),
                    ]
                      .filter(Boolean)
                      .join(t("common.listSeparator"))}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-text-muted" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {archived.length > 0 && status !== "archived" && (
        <div>
          <button
            type="button"
            aria-pressed={showArchived}
            onClick={() => setShowArchived(!showArchived)}
            className="inline-flex min-h-11 items-center rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-bg-secondary hover:text-text-strong"
          >
            {showArchived ? t("studies.list.hideArchived") : t("studies.list.showArchived", { count: archived.length })}
          </button>
        </div>
      )}
    </div>
  );
}
