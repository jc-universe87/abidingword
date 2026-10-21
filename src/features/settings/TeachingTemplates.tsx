import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/design-system/Button";
import { HelpTip } from "@/design-system/HelpTip";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { teachingKindLabel } from "@/features/teaching/labels";
import { BUILTIN_TEACHING_TEMPLATES, builtinPoints, startSummary, type BuiltinTeachingTemplate } from "@/features/teaching/teachingTemplates";
import type { TeachingTemplate } from "@/types/teaching";

/**
 * Settings → Templates → Bible Teaching (v0.18.7): the built-in starting
 * structures, one per format, which stay as they are; and the person's own,
 * which they can edit, duplicate and delete. A built-in one becomes the
 * person's own with "Save as my template". Choosing one happens where a
 * teaching is begun ("What would you like to prepare?").
 */
export function TeachingTemplates({ onEdit, version = 0 }: { onEdit: (templateId: string | null) => void; version?: number }) {
  const { t } = useTranslation();
  const api = useApi();
  // Reloaded when the editor (over Settings) closes: `version` changes then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mine = useLoad(useCallback(() => api.teachingTemplateList(), [api, version]));
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      mine.reload();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };
  // A built-in template becomes the person's own copy, in their language, and opens to be changed.
  const saveAsMine = async (template: BuiltinTeachingTemplate) => {
    const copy = await api.teachingTemplateCreate({
      name: t("studies.builtin.copyTitle", { title: teachingKindLabel(t, template.kind) }),
      kind: template.kind,
      points: builtinPoints(t, template),
    });
    onEdit(copy.id);
  };
  const duplicate = (template: TeachingTemplate) =>
    api.teachingTemplateCreate({
      name: t("studies.builtin.copyTitle", { title: template.name }),
      description: template.description,
      kind: template.kind,
      points: template.points.map((p) => ({ ...p })),
    });

  const meta = "m-0 text-[0.9375rem] text-text-muted";
  return (
    <section aria-labelledby="templates-teaching" className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <h3 id="templates-teaching" className="type-group m-0">{t("studies.view.teaching")}</h3>
        <HelpTip name={t("settings.help.about", { topic: t("studies.teaching.templates.listLabel") })}>{t("studies.teaching.templates.intro")}</HelpTip>
      </div>
      <ul aria-label={t("studies.teaching.templates.listLabel")} className="m-0 list-none border-t border-border-subtle p-0">
        {BUILTIN_TEACHING_TEMPLATES.map((template) => {
          const name = teachingKindLabel(t, template.kind);
          return (
            <li key={template.key} className="flex flex-wrap items-start justify-between gap-2 border-b border-border-subtle py-3">
              <div className="min-w-0 flex-1 basis-64">
                <p className="type-item m-0">{name}</p>
                <p className={`${meta} line-clamp-2`} title={startSummary(t, { builtin: template })}>
                  {startSummary(t, { builtin: template })}
                  {t("common.listSeparator")}
                  {t("studies.templates.builtIn")}
                </p>
              </div>
              <Button variant="quiet" onClick={() => act(() => saveAsMine(template))} aria-label={t("studies.teaching.templates.saveAsMineLabel", { name })}>
                {t("studies.teaching.templates.saveAsMine")}
              </Button>
            </li>
          );
        })}
        {(mine.data ?? []).map((template) => (
          <li key={template.id} className="flex flex-col gap-2 border-b border-border-subtle py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1 basis-64">
                <p className="type-item m-0">{template.name}</p>
                <p className={`${meta} line-clamp-2`} title={startSummary(t, { mine: template })}>
                  {teachingKindLabel(t, template.kind)}
                  {t("common.listSeparator")}
                  {startSummary(t, { mine: template })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="quiet" onClick={() => onEdit(template.id)} aria-label={t("studies.teaching.templates.edit", { name: template.name })}>
                  {t("common.edit")}
                </Button>
                <Button variant="quiet" onClick={() => act(() => duplicate(template))} aria-label={t("studies.teaching.templates.duplicate", { name: template.name })}>
                  {t("common.duplicate")}
                </Button>
                <Button id={`delete-${template.id}`} variant="quiet" onClick={() => setConfirming(template.id)} aria-label={t("studies.teaching.templates.delete", { name: template.name })}>
                  {t("common.deleteEllipsis")}
                </Button>
              </div>
            </div>
            {confirming === template.id && (
              <div role="alertdialog" aria-label={t("studies.teaching.templates.confirmLabel", { name: template.name })} className="flex flex-wrap items-center gap-2 border-l-[3px] border-danger bg-hover px-4 py-3">
                <span>{t("studies.teaching.templates.confirm", { name: template.name })}</span>
                <Button variant="danger" onClick={() => act(async () => { await api.teachingTemplateDelete(template.id); setConfirming(null); focusSoon("teaching-template-new"); })}>
                  {t("studies.templates.deleteTemplate")}
                </Button>
                <Button autoFocus onClick={() => { setConfirming(null); focusSoon(`delete-${template.id}`); }}>{t("studies.keepIt")}</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div>
        <Button id="teaching-template-new" onClick={() => onEdit(null)}>{t("studies.teaching.templates.new")}</Button>
      </div>
      {mine.error && <p role="alert" className="m-0 text-danger">{mine.error.message}</p>}
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
    </section>
  );
}

/** Moves focus once the row it leaves has gone (a deleted template, a closed confirmation). */
function focusSoon(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}
