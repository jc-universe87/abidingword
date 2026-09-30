import { useCallback } from "react";
import type { Project } from "@/types/domain";
import type { StudySummary } from "@/types/studies";
import { useApi } from "@/lib/ApiContext";
import { EditableTitle } from "./EditableTitle";
import { NewStudyForm } from "./NewStudyForm";
import { StudyList } from "./StudyList";

interface ProjectViewProps {
  project: Project;
  onProjectChanged: (project: Project) => void;
  onOpenStudy: (study: { id: string; projectId: string }) => void;
}

export function ProjectView({ project, onProjectChanged, onOpenStudy }: ProjectViewProps) {
  const api = useApi();
  const rename = useCallback(
    async (title: string) => onProjectChanged(await api.projectUpdate({ id: project.id, title })),
    [api, project.id, onProjectChanged],
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="caps-label m-0 mb-2">Project</p>
        <EditableTitle key={project.id} label="Project title" value={project.title} onSave={rename} />
        <p className="m-0 mt-1 text-[0.9375rem] text-text-muted">
          {project.studyCount === 1 ? "1 study" : `${project.studyCount} studies`}
        </p>
      </div>

      <NewStudyForm projectId={project.id} onCreated={(id) => onOpenStudy({ id, projectId: project.id })} />

      <section aria-labelledby="studies-heading" className="flex flex-col gap-3">
        <h2 id="studies-heading" className="m-0 text-[1.125rem] font-semibold text-text-strong">
          Studies
        </h2>
        <StudyList projectId={project.id} onOpen={(s: StudySummary) => onOpenStudy(s)} />
      </section>
    </div>
  );
}
