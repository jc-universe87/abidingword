import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/design-system/Button";
import type { Project } from "@/types/domain";
import type { StudySummary } from "@/types/studies";
import { useApi } from "@/lib/ApiContext";
import { EditableTitle } from "./EditableTitle";
import { studyCountLabel } from "./format";
import { NewStudyForm } from "./NewStudyForm";
import { StudyList } from "./StudyList";

interface ProjectViewProps {
  project: Project;
  /** The only project: shown as "Studies", with nothing about projects at all. */
  plain?: boolean;
  /** A way to the project list, for someone who wants to organise (plain view only). */
  onProjects?: () => void;
  onProjectChanged: (project: Project) => void;
  onOpenStudy: (study: { id: string; projectId: string }) => void;
}

export function ProjectView({ project, plain = false, onProjects, onProjectChanged, onOpenStudy }: ProjectViewProps) {
  const { t } = useTranslation();
  const api = useApi();
  const rename = useCallback(
    async (title: string) => onProjectChanged(await api.projectUpdate({ id: project.id, title })),
    [api, project.id, onProjectChanged],
  );
  // The creation form is the main thing in an empty project; otherwise it
  // is put away until it is asked for, and the studies come first.
  const empty = project.studyCount === 0;
  const [asked, setAsked] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const putAway = () => {
    setAsked(false);
    requestAnimationFrame(() => opener.current?.focus());
  };

  return (
    <div className="flex flex-col gap-8">
      {plain ? (
        <h1 className="type-title m-0">{t("studies.home.title")}</h1>
      ) : (
        <div>
          <p className="caps-label m-0 mb-2">{t("studies.projects.project")}</p>
          <EditableTitle key={project.id} label={t("studies.projects.titleLabel")} value={project.title} onSave={rename} />
          <p className="m-0 mt-1 text-[0.9375rem] text-text-muted">
            {studyCountLabel(t, project.studyCount)}
          </p>
        </div>
      )}

      {empty || asked ? (
        <NewStudyForm
          projectId={project.id}
          autoFocus={asked}
          onCancel={empty ? undefined : putAway}
          onCreated={onOpenStudy}
        />
      ) : (
        <div>
          <Button ref={opener} variant="primary" onClick={() => setAsked(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("studies.newStudy.formLabel")}
          </Button>
        </div>
      )}

      {!empty && (
        <section aria-labelledby="studies-heading" className="flex flex-col gap-3">
          <h2 id="studies-heading" className="type-section m-0">
            {t("studies.projects.studies")}
          </h2>
          <StudyList projectId={project.id} onOpen={(s: StudySummary) => onOpenStudy(s)} />
        </section>
      )}

      {plain && onProjects && (
        <div>
          <Button variant="quiet" onClick={onProjects}>
            {t("studies.home.organise")}
          </Button>
        </div>
      )}
    </div>
  );
}
