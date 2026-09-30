import { useCallback, useState } from "react";
import { Button } from "@/design-system/Button";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { STUDY_TYPE_LABELS } from "@/features/studies/labels";
import type { StudyTemplate } from "@/types/studies";

/** Settings → Study Templates: built-in and user templates. */
export function StudyTemplates({ onEdit }: { onEdit: (templateId: string | null) => void }) {
  const api = useApi();
  const templates = useLoad(useCallback(() => api.templateList(), [api]));
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      templates.reload();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const row = (t: StudyTemplate) => (
    <li key={t.id} className="flex flex-col gap-2 border-b border-border-subtle py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="m-0 font-semibold text-text-strong">{t.name}</p>
          <p className="m-0 text-[0.9375rem] text-text-muted">
            {STUDY_TYPE_LABELS[t.studyType]} · {t.sections.length} sections{t.isBuiltin ? " · Built-in" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {t.isBuiltin ? (
            <Button variant="quiet" onClick={() => act(async () => onEdit((await api.templateDuplicate(t.id)).id))}>
              Duplicate and customise
            </Button>
          ) : (
            <>
              <Button variant="quiet" onClick={() => onEdit(t.id)} aria-label={`Edit ${t.name}`}>Edit</Button>
              <Button variant="quiet" onClick={() => act(() => api.templateDuplicate(t.id))} aria-label={`Duplicate ${t.name}`}>Duplicate</Button>
              <Button variant="quiet" onClick={() => setConfirming(t.id)} aria-label={`Delete ${t.name}`}>Delete…</Button>
            </>
          )}
        </div>
      </div>
      {confirming === t.id && (
        <div role="alertdialog" aria-label={`Delete ${t.name}?`} className="flex flex-wrap items-center gap-2 border-l-[3px] border-danger bg-bg-secondary px-4 py-3">
          <span>Delete the template “{t.name}”? Studies already made from it are not affected.</span>
          <Button variant="primary" onClick={() => act(async () => { await api.templateDelete(t.id); setConfirming(null); })}>Delete template</Button>
          <Button autoFocus onClick={() => setConfirming(null)}>Keep it</Button>
        </div>
      )}
    </li>
  );

  const list = templates.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[0.9375rem] text-text-muted">
        A template gives a new study its sections. Changing a template never changes studies already made from it.
      </p>
      <ul aria-label="Study templates" className="m-0 list-none border-t border-border-subtle p-0">
        {list.map(row)}
      </ul>
      <div>
        <Button onClick={() => onEdit(null)}>New template…</Button>
      </div>
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
    </div>
  );
}
