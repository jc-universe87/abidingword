import { useCallback, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Notice } from "@/design-system/Notice";
import { PaneHeader } from "@/design-system/PaneHeader";
import { SaveTrackerProvider } from "@/hooks/SaveTracker";
import { useLoad } from "@/hooks/useLoad";
import { useApi } from "@/lib/ApiContext";
import { readLocal, writeLocal } from "@/lib/storage";
import type { Project, Workspace } from "@/types/domain";
import { ProjectList } from "./ProjectList";
import { ProjectView } from "./ProjectView";
import { StudyEditor } from "./StudyEditor";

export type StudyLocation =
  | { kind: "projects" }
  | { kind: "project"; projectId: string }
  | { kind: "study"; projectId: string; studyId: string };

const LOCATION_KEY = "studyPane.location";

/**
 * The centre pane: browse projects, open a project's studies, edit a study.
 * The last place is remembered, so reopening the app returns to it.
 */
export function StudyPane({ workspace, onRevealScripture }: { workspace: Workspace; onRevealScripture: () => void }) {
  const [location, setLocation] = useState<StudyLocation>(() =>
    readLocal<StudyLocation>(LOCATION_KEY, { kind: "projects" }),
  );
  useEffect(() => writeLocal(LOCATION_KEY, location), [location]);

  const goToProjects = useCallback(() => setLocation({ kind: "projects" }), []);
  const projectId = location.kind === "projects" ? null : location.projectId;

  return (
    <>
      <PaneHeader id="pane-study-title" title="Study" />
      <SaveTrackerProvider>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[46rem] flex-col gap-6 px-8 pb-24 pt-6">
            {projectId === null ? (
              <ProjectList
                workspace={workspace}
                onOpenProject={(id) => setLocation({ kind: "project", projectId: id })}
              />
            ) : (
              <ProjectScope
                projectId={projectId}
                location={location}
                setLocation={setLocation}
                onMissing={goToProjects}
                onRevealScripture={onRevealScripture}
              />
            )}
          </div>
        </div>
      </SaveTrackerProvider>
    </>
  );
}

interface ProjectScopeProps {
  projectId: string;
  location: StudyLocation;
  setLocation: (location: StudyLocation) => void;
  onMissing: () => void;
  onRevealScripture: () => void;
}

function ProjectScope({ projectId, location, setLocation, onMissing, onRevealScripture }: ProjectScopeProps) {
  const api = useApi();
  const project = useLoad(useCallback(() => api.projectGet(projectId), [api, projectId]));
  const missing = project.error?.kind === "notFound";
  const openProject = useCallback(() => setLocation({ kind: "project", projectId }), [setLocation, projectId]);

  useEffect(() => {
    if (missing) onMissing();
  }, [missing, onMissing]);

  if (missing) return null;
  if (project.error) return <Notice tone="error">{project.error.message}</Notice>;
  if (!project.data) return <p className="text-text-muted">Opening project…</p>;

  const inStudy = location.kind === "study";
  return (
    <>
      <Breadcrumb
        project={project.data}
        inStudy={inStudy}
        onProjects={() => setLocation({ kind: "projects" })}
        onProject={openProject}
      />
      {location.kind === "study" ? (
        <StudyEditor
          key={location.studyId}
          studyId={location.studyId}
          onMissing={openProject}
          onRevealScripture={onRevealScripture}
        />
      ) : (
        <ProjectView
          project={project.data}
          onProjectChanged={project.setData}
          onOpenStudy={(studyId) => setLocation({ kind: "study", projectId, studyId })}
        />
      )}
    </>
  );
}

function Breadcrumb(props: { project: Project; inStudy: boolean; onProjects: () => void; onProject: () => void }) {
  const link = "rounded px-1 text-link underline-offset-4 hover:underline";
  return (
    <nav aria-label="Breadcrumb">
      <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-[0.9375rem]">
        <li>
          <button type="button" className={link} onClick={props.onProjects}>
            Projects
          </button>
        </li>
        <li aria-hidden="true">
          <ChevronRight className="size-4 text-text-muted" />
        </li>
        <li>
          {props.inStudy ? (
            <button type="button" className={link} onClick={props.onProject}>
              {props.project.title}
            </button>
          ) : (
            <span aria-current="page" className="px-1 text-text-muted">
              {props.project.title}
            </span>
          )}
        </li>
      </ol>
    </nav>
  );
}
