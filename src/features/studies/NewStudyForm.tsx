import { useCallback, useId, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { STUDY_TYPES, type StudyTemplate, type StudyType } from "@/types/studies";
import { isPassageCentred, STUDY_TYPE_LABELS } from "./labels";

const field = "h-10 min-w-0 rounded-aw border border-border bg-bg px-3 text-base placeholder:text-text-muted";

/** The template suggested for a type: its built-in one, if any. */
function suggested(templates: StudyTemplate[], type: StudyType): string {
  return templates.find((t) => t.isBuiltin && t.studyType === type)?.id ?? "";
}

/**
 * New Study: title, type, template (suggested from the type) and an
 * optional passage. One short form, no wizard.
 */
export function NewStudyForm({ projectId, onCreated }: { projectId: string; onCreated: (studyId: string) => void }) {
  const api = useApi();
  const id = useId();
  const templates = useLoad(useCallback(() => api.templateList(), [api]));
  const [title, setTitle] = useState("");
  const [studyType, setStudyType] = useState<StudyType>("passage");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [passage, setPassage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = templates.data ?? [];
  // Until the user picks a template, follow the type's suggestion.
  const chosenTemplate = templateId ?? suggested(list, studyType);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError("Please enter a title first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const primary = passage.trim() ? (await api.referenceParse(passage)).canonical : undefined;
      const detail = await api.studyCreate({
        projectId,
        title,
        studyType,
        templateId: chosenTemplate || undefined,
        primaryPassage: primary,
      });
      setTitle("");
      setPassage("");
      onCreated(detail.study.id);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="m-0 text-[1.125rem] font-semibold text-text-strong">New study</h2>
      <label className="flex flex-col gap-1">
        <span className="text-[0.9375rem] font-medium text-text-strong">Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. John 15:1–11" className={field} />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[0.9375rem] font-medium text-text-strong">Type</span>
          <select
            value={studyType}
            onChange={(e) => {
              setStudyType(e.target.value as StudyType);
              setTemplateId(null);
            }}
            className={field}
          >
            {STUDY_TYPES.map((t) => (
              <option key={t} value={t}>{STUDY_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[0.9375rem] font-medium text-text-strong">Template</span>
          <select value={chosenTemplate} onChange={(e) => setTemplateId(e.target.value)} className={field}>
            <option value="">No template (one Notes section)</option>
            {list.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.isBuiltin ? "" : " (yours)"}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[0.9375rem] font-medium text-text-strong">
          Passage {isPassageCentred(studyType) ? "" : <span className="font-normal text-text-muted">(optional)</span>}
        </span>
        <input value={passage} onChange={(e) => setPassage(e.target.value)} placeholder="e.g. John 15:1-11" className={field} />
      </label>
      {error && (
        <p role="alert" className="m-0 text-[0.9375rem] text-danger">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          <Plus className="size-4" aria-hidden="true" />
          Create study
        </Button>
      </div>
    </form>
  );
}
