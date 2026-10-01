import { useCallback, useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { useApi } from "@/lib/ApiContext";
import type { Project } from "@/types/domain";
import { STUDY_STATUSES, STUDY_TYPES, type StudyStatus, type StudySummary, type StudyType } from "@/types/studies";
import { formatDate } from "./format";
import { STATUS_LABELS, STUDY_TYPE_LABELS } from "./labels";

interface StudyListProps {
  /** Limit to one project; otherwise all studies with a project filter. */
  projectId?: string;
  projects?: Project[];
  onOpen: (study: StudySummary) => void;
  /** Bump to reload after a change elsewhere. */
  version?: number;
}

const select = "h-9 rounded-aw border border-border bg-bg px-2 text-[0.9375rem]";

/** A filterable list of studies: title, type, main passage, status, date. */
export function StudyList({ projectId, projects, onOpen, version = 0 }: StudyListProps) {
  const api = useApi();
  const id = useId();
  const [studyType, setStudyType] = useState<StudyType | "">("");
  const [status, setStatus] = useState<StudyStatus | "">("");
  const [project, setProject] = useState("");
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.9375rem]" role="group" aria-label="Filter studies">
        {!projectId && projects && (
          <label className="flex items-center gap-2">
            <span>Project</span>
            <select value={project} onChange={(e) => setProject(e.target.value)} className={select}>
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2">
          <span>Type</span>
          <select value={studyType} onChange={(e) => setStudyType(e.target.value as StudyType | "")} className={select}>
            <option value="">All types</option>
            {STUDY_TYPES.map((t) => (
              <option key={t} value={t}>{STUDY_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as StudyStatus | "")} className={select}>
            <option value="">Any status</option>
            {STUDY_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
      </div>

      {studies.error && <Notice tone="error">{studies.error.message}</Notice>}
      {studies.loading && <p className="m-0 text-text-muted">Loading studies…</p>}
      {studies.data?.length === 0 && (
        <p className="m-0 text-text-muted">
          {studyType || status || project ? "No studies match these filters." : "No studies here yet."}
        </p>
      )}
      {studies.data && studies.data.length > 0 && (
        <ul id={id} aria-label="Studies" className="m-0 list-none border-t border-border-subtle p-0">
          {studies.data.map((study) => (
            <li key={study.id} className="border-b border-border-subtle">
              <button
                type="button"
                onClick={() => onOpen(study)}
                className="flex w-full items-center gap-4 px-2 py-3 text-left hover:bg-bg-secondary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[1.25rem] font-heading text-text-strong">{study.title}</span>
                  <span className="mt-1 block text-[0.9375rem] text-text-muted">
                    {STUDY_TYPE_LABELS[study.studyType]}
                    {study.primaryPassage && <> · {study.primaryPassage.display}</>}
                    {!projectId && <> · {study.projectTitle}</>}
                  </span>
                  <span className="block text-[0.875rem] text-text-muted">
                    {STATUS_LABELS[study.status]}
                    {study.findingCount > 0 && <> · {study.findingCount} finding{study.findingCount === 1 ? "" : "s"}</>}
                    {" · "}changed {formatDate(study.updatedAt)}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-text-muted" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
