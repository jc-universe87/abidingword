import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { useApi } from "@/lib/ApiContext";
import type { Workspace } from "@/types/domain";
import { CreateForm } from "./CreateForm";
import { StudyList } from "./StudyList";
import { studyCountLabel } from "./format";

interface ProjectListProps {
  workspace: Workspace;
  onOpenProject: (projectId: string) => void;
  onOpenStudy: (study: { id: string; projectId: string }) => void;
}

export function ProjectList({ workspace, onOpenProject, onOpenStudy }: ProjectListProps) {
  const { t } = useTranslation();
  const api = useApi();
  const projects = useLoad(useCallback(() => api.projectList(workspace.id), [api, workspace.id]));

  const create = async (title: string) => {
    const project = await api.projectCreate({ workspaceId: workspace.id, title });
    onOpenProject(project.id);
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="m-0 font-display text-[1.875rem] font-heading text-text-strong">{t("studies.projects.title")}</h1>
        <p className="mt-2 mb-0 text-text-muted">
          {t("studies.projects.intro")}
        </p>
      </div>

      <CreateForm
        label={t("studies.projects.newLabel")}
        placeholder={t("studies.projects.newPlaceholder")}
        submitLabel={t("studies.projects.create")}
        onCreate={create}
      />

      {projects.error && <Notice tone="error">{projects.error.message}</Notice>}
      {projects.loading && <p className="text-text-muted">{t("studies.projects.loading")}</p>}
      {projects.data?.length === 0 && (
        <p className="text-text-muted">{t("studies.projects.empty")}</p>
      )}
      {projects.data && projects.data.length > 0 && (
        <ul aria-label={t("studies.projects.listLabel")} className="m-0 list-none border-t border-border-subtle p-0">
          {projects.data.map((project) => (
            <li key={project.id} className="border-b border-border-subtle">
              <button
                type="button"
                onClick={() => onOpenProject(project.id)}
                className="flex w-full items-center gap-4 px-2 py-4 text-left hover:bg-bg-secondary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[1.25rem] font-heading text-text-strong">
                    {project.title}
                  </span>
                  <span className="mt-1 block text-[0.9375rem] text-text-muted">
                    {studyCountLabel(t, project.studyCount)}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-text-muted" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {projects.data && projects.data.length > 0 && (
        <section aria-labelledby="all-studies-heading" className="flex flex-col gap-3">
          <h2 id="all-studies-heading" className="m-0 text-[1.125rem] font-semibold text-text-strong">
            {t("studies.projects.allStudies")}
          </h2>
          <StudyList projects={projects.data} onOpen={onOpenStudy} />
        </section>
      )}
    </div>
  );
}
