import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/design-system/Button";
import { HelpTip } from "@/design-system/HelpTip";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { localizedSections, templateDescription, templateName } from "@/features/studies/builtinText";
import { studyTypeLabel } from "@/features/studies/labels";
import { startsWith, type StudyTemplate } from "@/types/studies";
import { TEACHING_KINDS } from "@/types/teaching";
import { STARTING_STEPS, canvasShape, startingStepTitle, teachingKindLabel } from "@/features/teaching/labels";

/**
 * Built-in templates no longer offered: the old "Teaching / Sermon" study is
 * now Bible Teaching. Kept installed so older studies keep their translated
 * headings; not listed.
 */
export const RETIRED_TEMPLATES = new Set(["teaching-study"]);

/**
 * Settings → Templates: reusable starting structures, for a Bible study
 * (its parts; built-in and the person's own) and for a Bible teaching (each
 * format's shape, and the steps a lesson starts with).
 */
export function StudyTemplates({ onEdit, version = 0 }: { onEdit: (templateId: string | null) => void; version?: number }) {
  const { t } = useTranslation();
  const api = useApi();
  // Reloaded when the template editor (over Settings) closes: `version` changes then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const templates = useLoad(useCallback(() => api.templateList(), [api, version]));
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

  // A built-in template becomes the user's own copy in the interface language.
  const customise = async (template: StudyTemplate) => {
    const copy = await api.templateCreate({
      name: t("studies.builtin.copyTitle", { title: templateName(template) }),
      description: templateDescription(template) ?? undefined,
      studyType: template.studyType,
      sections: localizedSections(template),
    });
    onEdit(copy.id);
  };

  // The core names a copy in English; name it in the interface language.
  const duplicate = async (template: StudyTemplate) => {
    const copy = await api.templateDuplicate(template.id);
    const name = t("studies.builtin.copyTitle", { title: template.name });
    if (copy.name === `${template.name} (copy)` && copy.name !== name) {
      await api.templateUpdate({
        id: copy.id,
        name,
        description: copy.description ?? undefined,
        studyType: copy.studyType,
        sections: copy.sections,
      });
    }
  };

  const row = (template: StudyTemplate) => {
    const name = templateName(template);
    return (
      <li key={template.id} className="flex flex-col gap-2 border-b border-border-subtle py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="type-item m-0">{name}</p>
            <p className="m-0 text-[0.9375rem] text-text-muted">
              {[
                studyTypeLabel(t, template.studyType),
                t("studies.templates.sectionCount", { count: template.sections.filter(startsWith).length }),
                template.isBuiltin && t("studies.templates.builtIn"),
              ]
                .filter(Boolean)
                .join(t("common.listSeparator"))}
            </p>
          </div>
          <div className="flex gap-2">
            {template.isBuiltin ? (
              <Button variant="quiet" onClick={() => act(() => customise(template))}>
                {t("studies.templates.duplicateCustomise")}
              </Button>
            ) : (
              <>
                <Button variant="quiet" onClick={() => onEdit(template.id)} aria-label={t("studies.templates.edit", { name })}>
                  {t("common.edit")}
                </Button>
                <Button variant="quiet" onClick={() => act(() => duplicate(template))} aria-label={t("studies.templates.duplicate", { name })}>
                  {t("common.duplicate")}
                </Button>
                <Button variant="quiet" onClick={() => setConfirming(template.id)} aria-label={t("studies.templates.delete", { name })}>
                  {t("common.deleteEllipsis")}
                </Button>
              </>
            )}
          </div>
        </div>
        {confirming === template.id && (
          <div role="alertdialog" aria-label={t("studies.templates.confirmLabel", { name })} className="flex flex-wrap items-center gap-2 border-l-[3px] border-danger bg-bg-secondary px-4 py-3">
            <span>{t("studies.templates.confirm", { name })}</span>
            <Button variant="primary" onClick={() => act(async () => { await api.templateDelete(template.id); setConfirming(null); })}>
              {t("studies.templates.deleteTemplate")}
            </Button>
            <Button autoFocus onClick={() => setConfirming(null)}>{t("studies.keepIt")}</Button>
          </div>
        )}
      </li>
    );
  };

  const list = (templates.data ?? []).filter((template) => !(template.isBuiltin && RETIRED_TEMPLATES.has(template.key)));
  const heading = "type-group m-0";
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="templates-study" className="flex flex-col gap-3">
        <div className="flex items-center gap-1">
          <h3 id="templates-study" className={heading}>{t("studies.view.study")}</h3>
          <HelpTip name={t("settings.help.about", { topic: t("settings.sections.templates") })}>{t("studies.templates.intro")}</HelpTip>
        </div>
        <ul aria-label={t("studies.templates.listLabel")} className="m-0 list-none border-t border-border-subtle p-0">
          {list.map(row)}
        </ul>
        <div>
          <Button onClick={() => onEdit(null)}>{t("studies.templates.new")}</Button>
        </div>
        {error && <p role="alert" className="m-0 text-danger">{error}</p>}
      </section>
      <section aria-labelledby="templates-teaching" className="flex flex-col gap-3">
        <h3 id="templates-teaching" className={heading}>{t("studies.view.teaching")}</h3>
        <ul aria-label={t("studies.templates.teachingListLabel")} className="m-0 list-none border-t border-border-subtle p-0">
          {TEACHING_KINDS.map((kind) => (
            <li key={kind} className="flex flex-col gap-0.5 border-b border-border-subtle py-3">
              <p className="type-item m-0">{teachingKindLabel(t, kind)}</p>
              <p className="m-0 text-[0.9375rem] text-text-muted">
                {t(`studies.teaching.format.${canvasShape(kind)}`)}
                {STARTING_STEPS[kind] &&
                  ` ${t("studies.teaching.startsWith", { steps: STARTING_STEPS[kind]!.map((step) => startingStepTitle(t, kind, step.key)).join(t("common.listSeparator")) })}`}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
