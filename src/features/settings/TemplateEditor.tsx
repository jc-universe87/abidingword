import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { studyTypeLabel } from "@/features/studies/labels";
import { PhaseSelect } from "@/features/studies/PhaseSelect";
import { ownPartKey } from "@/features/studies/templateParts";
import { STUDY_TYPES, type StudyType, type TemplateSection } from "@/types/studies";

/** A part being edited: its row keeps one identity while it moves, so focus moves with it. */
type Row = TemplateSection & { row: string };
let rows = 0;
const asRow = (section: TemplateSection): Row => ({ ...section, row: `row-${++rows}` });

/** Create or edit a user template: name, purpose, type, ordered sections. */
export function TemplateEditor({ templateId, onClose }: { templateId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const templates = useLoad(useCallback(() => api.templateList(), [api]));
  const existing = templateId ? templates.data?.find((t) => t.id === templateId) : undefined;
  if (templateId && !existing) {
    // Still opening (or it failed): a heading, Back and Escape, so the sheet can always be left.
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto bg-bg p-8" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <Button variant="quiet" className="self-start" autoFocus onClick={onClose}>
          <ArrowLeft className="size-4" aria-hidden="true" /> {t("studies.templateEditor.back")}
        </Button>
        <h1 id="template-editor-title" className="type-title m-0">
          {t("studies.templateEditor.editTitle")}
        </h1>
        <p role={templates.error ? "alert" : "status"} className={`m-0 ${templates.error ? "text-danger" : "text-text-muted"}`}>
          {templates.error ? templates.error.message : t("studies.templateEditor.opening")}
        </p>
      </div>
    );
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
  const [sections, setSections] = useState<Row[]>(() => (initial?.sections ?? [{ key: ownPartKey(), title: t("studies.builtin.defaultSection") }]).map(asRow));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => heading.current?.focus(), []);

  const update = (index: number, changes: Partial<TemplateSection>) =>
    setSections(sections.map((s, i) => (i === index ? { ...s, ...changes } : s)));
  const move = (index: number, delta: -1 | 1) => {
    const next = [...sections];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target] as Row, next[index] as Row];
    setSections(next);
    setMoved({ row: sections[index]!.row, up: delta < 0 });
  };
  // Focus stays on the moved part's arrow; at the top or bottom, on the arrow it still has.
  const [moved, setMoved] = useState<{ row: string; up: boolean } | null>(null);
  useEffect(() => {
    if (!moved) return;
    const arrow = (up: boolean) => document.getElementById(`${id}-${moved.row}-${up ? "up" : "down"}`) as HTMLButtonElement | null;
    const here = arrow(moved.up);
    (here && !here.disabled ? here : arrow(!moved.up))?.focus();
  }, [moved, id]);

  const save = async () => {
    setError(null);
    const input = { name, description, studyType, sections: sections.map(({ row: _row, ...section }) => section) };
    try {
      if (templateId) await api.templateUpdate({ id: templateId, ...input });
      else await api.templateCreate(input);
      setSaved(true);
      onClose();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const field = "aw-input h-10 px-3 text-base";
  return (
    <div
      className="h-full overflow-y-auto bg-bg"
      onKeyDown={(e) => {
        // Escape closes the editor, as its Back and Cancel do, but not from a field: there it
        // would throw away what is being typed (as in Settings).
        if (e.key === "Escape" && !e.defaultPrevented && !(e.target as HTMLElement).closest("input, textarea, select")) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="mx-auto flex max-w-[46rem] flex-col gap-6 px-8 pb-24 pt-8">
        {/* Back stays in reach while the page scrolls. */}
        <div className="sticky top-0 z-10 -mx-8 -mt-8 self-stretch border-b border-border-subtle bg-bg px-8 py-2">
          <Button variant="quiet" onClick={onClose}>
            <ArrowLeft className="size-4" aria-hidden="true" /> {t("studies.templateEditor.back")}
          </Button>
        </div>
        <div className="flex flex-col items-start gap-4">
          <h1 id="template-editor-title" ref={heading} tabIndex={-1} className="type-title m-0">
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
            {/* A teaching is prepared in Bible Teaching now; "teaching" stays only for a template already meant for it. */}
            {STUDY_TYPES.filter((type) => type !== "teaching" || studyType === "teaching").map((type) => (
              <option key={type} value={type}>{studyTypeLabel(t, type)}</option>
            ))}
          </select>
        </label>

        <section aria-labelledby={`${id}-sections`} className="flex flex-col gap-3">
          <h2 id={`${id}-sections`} className="type-section m-0">{t("studies.templateEditor.sections")}</h2>
          <ol aria-label={t("studies.templateEditor.sectionsList")} className="m-0 flex list-none flex-col gap-3 p-0">
            {sections.map((section, index) => {
              const sectionName = section.title || t("studies.templateEditor.untitledSection");
              const number = index + 1;
              return (
              <li key={section.row} className="flex flex-col gap-2 border-l-[3px] border-border pl-3">
                <div className="flex items-center gap-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="sr-only">{t("studies.templateEditor.sectionTitle", { number })}</span>
                    <input value={section.title} onChange={(e) => update(index, { title: e.target.value })} className={`${field} w-full`} aria-label={t("studies.templateEditor.sectionTitle", { number })} />
                  </label>
                  <button type="button" id={`${id}-${section.row}-up`} disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("studies.templateEditor.moveUp", { title: sectionName })} className="inline-flex size-10 items-center justify-center rounded-aw text-text-muted hover:bg-hover disabled:opacity-40">
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" id={`${id}-${section.row}-down`} disabled={index === sections.length - 1} onClick={() => move(index, 1)} aria-label={t("studies.templateEditor.moveDown", { title: sectionName })} className="inline-flex size-10 items-center justify-center rounded-aw text-text-muted hover:bg-hover disabled:opacity-40">
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" disabled={sections.length === 1} onClick={() => setSections(sections.filter((_, i) => i !== index))} aria-label={t("studies.templateEditor.remove", { title: sectionName })} className="inline-flex size-10 items-center justify-center rounded-aw text-text-muted hover:bg-hover hover:text-danger disabled:opacity-40">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <input
                    value={section.guidance ?? ""}
                    onChange={(e) => update(index, { guidance: e.target.value })}
                    placeholder={t("studies.templateEditor.guidancePlaceholder")}
                    aria-label={t("studies.templateEditor.sectionGuidance", { number })}
                    className="h-9 min-w-0 flex-1 basis-56 rounded-aw border border-border-subtle bg-bg px-3 text-[0.9375rem] placeholder:text-text-muted"
                  />
                  {/* A part to add later is offered in the study, not made with it. */}
                  <label className="inline-flex min-h-9 items-center gap-2 text-[0.9375rem] text-text">
                    <input
                      type="checkbox"
                      checked={Boolean(section.optional)}
                      onChange={(e) => update(index, { optional: e.target.checked })}
                      aria-label={t("studies.templateEditor.laterLabel", { number })}
                      className="size-4 accent-[var(--aw-primary)]"
                    />
                    <span aria-hidden="true">{t("studies.templateEditor.later")}</span>
                  </label>
                  <PhaseSelect value={section.phase} onChange={(phase) => update(index, { phase })} label={t("studies.phase.ofTemplatePart", { number })} />
                </div>
              </li>
              );
            })}
          </ol>
          <div>
            <Button onClick={() => setSections([...sections, asRow({ key: ownPartKey(), title: "" })])}>
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
    </div>
  );
}
