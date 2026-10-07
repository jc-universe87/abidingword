import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { useApi } from "@/lib/ApiContext";
import type { Workspace } from "@/types/domain";
import { NewStudyForm } from "./NewStudyForm";
import { ProjectList } from "./ProjectList";
import { ProjectView } from "./ProjectView";
import { ensureStudyProject } from "./projects";

interface StudyHomeProps {
  workspace: Workspace;
  onOpenProject: (projectId: string) => void;
  onOpenStudy: (study: { id: string; projectId: string }) => void;
  /** The project list, for someone who wants to organise (a way in, never a step). */
  onProjectList: () => void;
}

/**
 * Where the Study pane starts. Projects are a way to organise studies, not
 * something to understand before the first one:
 *
 * - no project yet: just the question "What would you like to study?"; the
 *   default project ("My studies") is made when the first study is;
 * - one project: its studies, shown as "Studies";
 * - several: the project list, with New study that goes into the project last
 *   worked in (see `projects.ts`).
 */
export function StudyHome({ workspace, onOpenProject, onOpenStudy, onProjectList }: StudyHomeProps) {
  const { t } = useTranslation();
  const api = useApi();
  const projects = useLoad(useCallback(() => api.projectList(workspace.id), [api, workspace.id]));

  if (projects.error) return <Notice tone="error">{projects.error.message}</Notice>;
  if (!projects.data) return <p className="text-text-muted">{t("studies.projects.loading")}</p>;

  const list = projects.data;
  if (list.length >= 2) {
    return <ProjectList workspace={workspace} onOpenProject={onOpenProject} onOpenStudy={onOpenStudy} />;
  }
  if (list.length === 1) {
    return (
      <ProjectView
        project={list[0]!}
        plain
        onProjects={onProjectList}
        onProjectChanged={() => projects.reload()}
        onOpenStudy={onOpenStudy}
      />
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <h1 className="m-0 font-display text-[1.875rem] font-heading text-text-strong">{t("studies.home.title")}</h1>
      <NewStudyForm projectId={() => ensureStudyProject(api, workspace.id, t)} onCreated={onOpenStudy} />
      <div>
        <Button variant="quiet" onClick={onProjectList}>
          {t("studies.home.organise")}
        </Button>
      </div>
    </div>
  );
}
