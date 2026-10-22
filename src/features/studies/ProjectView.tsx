import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/design-system/Button";
import { InfoControl } from "@/design-system/InfoControl";
import { ProjectExport } from "@/features/portability/ProjectExport";
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
          <div className="-ml-2 mt-1 flex flex-wrap items-center gap-x-2 text-[0.9375rem] text-text-muted">
            <ProjectInfo project={project} onChanged={onProjectChanged} />
            <span className="px-2">{studyCountLabel(t, project.studyCount)}</span>
          </div>
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

/**
 * Project information (v0.19): the project's description as a draft saved
 * only with Save. Its studies are the page itself; the title is edited where
 * it stands.
 */
function ProjectInfo({ project, onChanged }: { project: Project; onChanged: (project: Project) => void }) {
  const { t } = useTranslation();
  const api = useApi();
  return (
    <InfoControl<{ description: string }>
      title={t("studies.info.project")}
      buttonLabel={t("common.info.button")}
      initial={() => ({ description: project.description ?? "" })}
      current={async () => ({ description: (await api.projectGet(project.id)).description ?? "" })}
      save={async (draft) => onChanged(await api.projectUpdate({ id: project.id, description: draft.description }))}
      fields={(draft, setDraft) => (
        <label className="flex flex-col gap-1">
          <span className="text-[0.9375rem] font-medium text-text-muted">{t("studies.info.projectDescription")}</span>
          <textarea
            rows={3}
            value={draft.description}
            onChange={(e) => setDraft({ description: e.target.value })}
            placeholder={t("studies.info.projectDescriptionHint")}
            className="reading resize-y rounded-aw border border-border-subtle bg-transparent px-3 py-1.5 text-[1rem] placeholder:text-text-muted focus:border-border"
          />
        </label>
      )}
      actions={() => <ProjectExport projectId={project.id} title={project.title} quiet />}
    />
  );
}
