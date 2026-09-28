import { useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { useApi } from "@/lib/ApiContext";
import type { Project } from "@/types/domain";
import { CreateForm } from "./CreateForm";
import { EditableTitle } from "./EditableTitle";
import { formatDate } from "./format";

interface ProjectViewProps {
  project: Project;
  onProjectChanged: (project: Project) => void;
  onOpenStudy: (studyId: string) => void;
}

export function ProjectView({ project, onProjectChanged, onOpenStudy }: ProjectViewProps) {
  const api = useApi();
  const studies = useLoad(useCallback(() => api.studyList(project.id), [api, project.id]));

  const rename = useCallback(
    async (title: string) => onProjectChanged(await api.projectUpdate({ id: project.id, title })),
    [api, project.id, onProjectChanged],
  );

  const create = async (title: string) => {
    const detail = await api.studyCreate({ projectId: project.id, title });
    onOpenStudy(detail.study.id);
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="caps-label m-0 mb-2">Project</p>
        <EditableTitle key={project.id} label="Project title" value={project.title} onSave={rename} />
      </div>

      <CreateForm
        label="New study"
        placeholder="e.g. Romans 8:1–17"
        submitLabel="Create study"
        onCreate={create}
      />

      <section aria-labelledby="studies-heading" className="flex flex-col gap-3">
        <h2 id="studies-heading" className="m-0 text-[1.125rem] font-semibold text-text-strong">
          Studies
        </h2>
        {studies.error && <Notice tone="error">{studies.error.message}</Notice>}
        {studies.loading && <p className="text-text-muted">Loading studies…</p>}
        {studies.data?.length === 0 && (
          <p className="m-0 text-text-muted">No studies in this project yet. Create one above.</p>
        )}
        {studies.data && studies.data.length > 0 && (
          <ul aria-label="Studies" className="m-0 list-none border-t border-border-subtle p-0">
            {studies.data.map((study) => (
              <li key={study.id} className="border-b border-border-subtle">
                <button
                  type="button"
                  onClick={() => onOpenStudy(study.id)}
                  className="flex w-full items-center gap-4 px-2 py-4 text-left hover:bg-bg-secondary"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[1.25rem] font-semibold text-text-strong">
                      {study.title}
                    </span>
                    <span className="mt-1 block text-[0.9375rem] text-text-muted">
                      Last changed {formatDate(study.updatedAt)}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-text-muted" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
