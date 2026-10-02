import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { studyTypeLabel } from "@/features/studies/labels";
import { STUDY_TYPES, type StudyType, type TemplateSection } from "@/types/studies";

/** Create or edit a user template: name, purpose, type, ordered sections. */
export function TemplateEditor({ templateId, onClose }: { templateId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const templates = useLoad(useCallback(() => api.templateList(), [api]));
  const existing = templateId ? templates.data?.find((t) => t.id === templateId) : undefined;
  if (templateId && !existing) {
    return <p className="p-8 text-text-muted">{templates.error ? templates.error.message : t("studies.templateEditor.opening")}</p>;
  }
  return <Form key={templateId ?? "new"} templateId={templateId} initial={existing} onClose={onClose} />;
}

interface FormProps {
  templateId: string | null;
  initial?: { name: string; description: string | null; studyType: StudyType; sections: TemplateSection[] };
  onClose: () => void;
}

function Form({ templateId, initial, onClose }: FormProps) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [studyType, setStudyType] = useState<StudyType>(initial?.studyType ?? "custom");
  const [sections, setSections] = useState<TemplateSection[]>(
    () => initial?.sections ?? [{ title: t("studies.builtin.defaultSection") }],
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => heading.current?.focus(), []);

  const update = (index: number, changes: Partial<TemplateSection>) =>
    setSections(sections.map((s, i) => (i === index ? { ...s, ...changes } : s)));
  const move = (index: number, delta: -1 | 1) => {
    const next = [...sections];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target] as TemplateSection, next[index] as TemplateSection];
    setSections(next);
  };

  const save = async () => {
    setError(null);
    const input = { name, description, studyType, sections };
    try {
      if (templateId) await api.templateUpdate({ id: templateId, ...input });
      else await api.templateCreate(input);
      setSaved(true);
      onClose();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const field = "h-10 rounded-aw border border-border bg-bg px-3 text-base";
  return (
    <main aria-labelledby={`${id}-title`} className="min-h-0 flex-1 overflow-y-auto bg-bg">
      <div className="mx-auto flex max-w-[46rem] flex-col gap-6 px-8 pb-24 pt-8">
        <div className="flex flex-col items-start gap-4">
          <Button variant="quiet" onClick={onClose}>
            <ArrowLeft className="size-4" aria-hidden="true" /> {t("studies.templateEditor.back")}
          </Button>
          <h1 id={`${id}-title`} ref={heading} tabIndex={-1} className="m-0 font-display text-[1.875rem] font-heading text-text-strong">
            {templateId ? t("studies.templateEditor.editTitle") : t("studies.templateEditor.newTitle")}
          </h1>
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-text-strong">{t("studies.templateEditor.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-text-strong">{t("studies.templateEditor.description")}</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-text-strong">{t("studies.templateEditor.meantFor")}</span>
          <select value={studyType} onChange={(e) => setStudyType(e.target.value as StudyType)} className={field}>
            {STUDY_TYPES.map((type) => (
              <option key={type} value={type}>{studyTypeLabel(t, type)}</option>
            ))}
          </select>
        </label>

        <section aria-labelledby={`${id}-sections`} className="flex flex-col gap-3">
          <h2 id={`${id}-sections`} className="m-0 text-[1.125rem] font-semibold text-text-strong">{t("studies.templateEditor.sections")}</h2>
          <ol aria-label={t("studies.templateEditor.sectionsList")} className="m-0 flex list-none flex-col gap-3 p-0">
            {sections.map((section, index) => {
              const sectionName = section.title || t("studies.templateEditor.untitledSection");
              const number = index + 1;
              return (
              <li key={index} className="flex flex-col gap-2 border-l-[3px] border-border pl-3">
                <div className="flex items-center gap-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="sr-only">{t("studies.templateEditor.sectionTitle", { number })}</span>
                    <input value={section.title} onChange={(e) => update(index, { title: e.target.value })} className={`${field} w-full`} aria-label={t("studies.templateEditor.sectionTitle", { number })} />
                  </label>
                  <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("studies.templateEditor.moveUp", { title: sectionName })} className="inline-flex size-10 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary disabled:opacity-40">
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" disabled={index === sections.length - 1} onClick={() => move(index, 1)} aria-label={t("studies.templateEditor.moveDown", { title: sectionName })} className="inline-flex size-10 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary disabled:opacity-40">
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" disabled={sections.length === 1} onClick={() => setSections(sections.filter((_, i) => i !== index))} aria-label={t("studies.templateEditor.remove", { title: sectionName })} className="inline-flex size-10 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary hover:text-danger disabled:opacity-40">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
                <input
                  value={section.guidance ?? ""}
                  onChange={(e) => update(index, { guidance: e.target.value })}
                  placeholder={t("studies.templateEditor.guidancePlaceholder")}
                  aria-label={t("studies.templateEditor.sectionGuidance", { number })}
                  className="h-9 rounded-aw border border-border-subtle bg-bg px-3 text-[0.9375rem] placeholder:text-text-muted"
                />
              </li>
              );
            })}
          </ol>
          <div>
            <Button onClick={() => setSections([...sections, { title: "" }])}>
              <Plus className="size-4" aria-hidden="true" /> {t("studies.templateEditor.addSection")}
            </Button>
          </div>
        </section>

        {error && <p role="alert" className="m-0 text-danger">{error}</p>}
        <div className="flex gap-3 border-t border-border-subtle pt-6">
          <Button variant="primary" onClick={save} disabled={saved}>{t("studies.templateEditor.save")}</Button>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
        </div>
      </div>
    </main>
  );
}
