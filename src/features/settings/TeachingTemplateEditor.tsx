import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { canvasShape, teachingKindLabel, type ShapeText } from "@/features/teaching/labels";
import { templatePointTitle } from "@/features/teaching/teachingTemplates";
import { STEP_KINDS, TEACHING_KINDS, type StepKind, type TeachingKind, type TeachingTemplate, type TeachingTemplatePoint } from "@/types/teaching";

/** A point being edited: its row keeps one identity while it moves, so focus moves with it. */
type Row = TeachingTemplatePoint & { row: string };
let rows = 0;
const asRow = (point: TeachingTemplatePoint): Row => ({ ...point, row: `row-${++rows}` });

/**
 * Create or edit a Bible Teaching template of the person's own (v0.18.7):
 * its name, what it is for, its format, and the points, questions or steps
 * a teaching starts with (each step with its kind). Reordered with buttons,
 * never only by dragging. Saving changes the template only: teachings
 * already made from it keep their own points.
 */
export function TeachingTemplateEditor({ templateId, onClose }: { templateId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const templates = useLoad(useCallback(() => api.teachingTemplateList(), [api]));
  const existing = templateId ? templates.data?.find((x) => x.id === templateId) : undefined;
  if (templateId && !existing) {
    // Still opening (or it failed): a heading, Back and Escape, so the sheet can always be left.
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto bg-bg p-8" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <Button variant="quiet" className="self-start" autoFocus onClick={onClose}>
          <ArrowLeft className="size-4" aria-hidden="true" /> {t("studies.templateEditor.back")}
        </Button>
        <h1 id="teaching-template-editor-title" className="type-title m-0">
          {t("studies.teaching.templates.editTitle")}
        </h1>
        <p role={templates.error ? "alert" : "status"} className={`m-0 ${templates.error ? "text-danger" : "text-text-muted"}`}>
          {templates.error ? templates.error.message : t("studies.templateEditor.opening")}
        </p>
      </div>
    );
  }
  return <Form key={templateId ?? "new"} templateId={templateId} initial={existing} onClose={onClose} />;
}

function Form({ templateId, initial, onClose }: { templateId: string | null; initial?: TeachingTemplate; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [kind, setKind] = useState<TeachingKind>(initial?.kind ?? "sermon");
  // Built-in steps are shown in the person's language; once changed they are the person's own words.
  const [points, setPoints] = useState<Row[]>(() => (initial?.points ?? []).map((p) => asRow({ ...p, title: templatePointTitle(t, initial!.kind, p) })));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [moved, setMoved] = useState<{ row: string; up: boolean } | null>(null);
  useEffect(() => heading.current?.focus(), []);
  // Focus stays on the moved point's arrow; at the top or bottom, on the arrow it still has.
  useEffect(() => {
    if (!moved) return;
    const arrow = (up: boolean) => document.getElementById(`${id}-${moved.row}-${up ? "up" : "down"}`) as HTMLButtonElement | null;
    const here = arrow(moved.up);
    (here && !here.disabled ? here : arrow(!moved.up))?.focus();
  }, [moved, id]);

  const shapeName = canvasShape(kind);
  const shape = (key: ShapeText, options?: Record<string, unknown>) => t(`studies.teaching.shape.${shapeName}.${key}`, options ?? {});
  const steps = shapeName === "steps";
  const update = (index: number, changes: Partial<TeachingTemplatePoint>) => setPoints(points.map((p, i) => (i === index ? { ...p, ...changes } : p)));
  const move = (index: number, delta: -1 | 1) => {
    const next = [...points];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target] as Row, next[index] as Row];
    setPoints(next);
    setMoved({ row: points[index]!.row, up: delta < 0 });
  };

  // Focus goes to the point after (else before) the one removed, or to Add.
  const removeAt = (index: number) => {
    const next = points.filter((_, i) => i !== index);
    setPoints(next);
    const target = next[Math.min(index, next.length - 1)];
    requestAnimationFrame(() => (target ? document.getElementById(`${id}-${target.row}-title`) : document.getElementById(`${id}-add`))?.focus());
  };

  const save = async () => {
    setError(null);
    // A step's kind belongs to a lesson in steps; the other formats keep none.
    const input = { name, description, kind, points: points.map(({ row: _row, ...p }) => ({ ...p, kind: steps ? (p.kind ?? null) : null })) };
    try {
      if (templateId) await api.teachingTemplateUpdate({ id: templateId, ...input });
      else await api.teachingTemplateCreate(input);
      setSaved(true);
      onClose();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const field = "aw-input h-10 px-3 text-base";
  const tool = "inline-flex size-11 items-center justify-center rounded-aw text-text-muted hover:bg-hover disabled:opacity-40";
  return (
    <div
      className="h-full overflow-y-auto bg-bg"
      onKeyDown={(e) => {
        // Escape closes the editor, as Back and Cancel do, but not from a field (as in Settings).
        if (e.key === "Escape" && !e.defaultPrevented && !(e.target as HTMLElement).closest("input, textarea, select")) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="mx-auto flex max-w-[46rem] flex-col gap-6 px-8 pb-24 pt-8">
        <div className="sticky top-0 z-10 -mx-8 -mt-8 self-stretch border-b border-border-subtle bg-bg px-8 py-2">
          <Button variant="quiet" onClick={onClose}>
            <ArrowLeft className="size-4" aria-hidden="true" /> {t("studies.templateEditor.back")}
          </Button>
        </div>
        <h1 id="teaching-template-editor-title" ref={heading} tabIndex={-1} className="type-title m-0">
          {templateId ? t("studies.teaching.templates.editTitle") : t("studies.teaching.templates.newTitle")}
        </h1>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-text-strong">{t("studies.templateEditor.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-text-strong">{t("studies.templateEditor.description")}</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
        </label>
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-text-strong">{t("studies.teaching.templates.format")}</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as TeachingKind)} className={field} aria-describedby={`${id}-format`}>
              {TEACHING_KINDS.map((k) => (
                <option key={k} value={k}>{teachingKindLabel(t, k)}</option>
              ))}
            </select>
          </label>
          <p id={`${id}-format`} className="m-0 text-[0.9375rem] text-text-muted">{t(`studies.teaching.format.${shapeName}`)}</p>
        </div>

        <section aria-labelledby={`${id}-points`} className="flex flex-col gap-3">
          <h2 id={`${id}-points`} className="type-section m-0">{shape("title")}</h2>
          <p className="m-0 text-[0.9375rem] text-text-muted">{points.length === 0 ? t("studies.teaching.templates.none") : t("studies.teaching.templates.pointsHint")}</p>
          {points.length > 0 && (
            <ol aria-label={t("studies.teaching.templates.pointsList")} className="m-0 flex list-none flex-col gap-3 p-0">
              {points.map((point, index) => {
                const number = index + 1;
                const label = point.title.trim() || shape("untitled", { number });
                return (
                  <li key={point.row} className="flex flex-wrap items-center gap-2 border-l-[3px] border-border pl-3">
                    <input
                      id={`${id}-${point.row}-title`}
                      value={point.title}
                      onChange={(e) => update(index, { title: e.target.value, key: null })}
                      placeholder={shape("titlePlaceholder")}
                      aria-label={shape("titleLabel", { number })}
                      className={`${field} min-w-0 flex-1 basis-56 placeholder:text-text-muted`}
                    />
                    {steps && (
                      <select
                        value={point.kind ?? ""}
                        onChange={(e) => update(index, { kind: (e.target.value || null) as StepKind | null })}
                        aria-label={t("studies.teaching.stepKindLabel", { step: label })}
                        className="aw-input h-10 px-2 text-[0.9375rem]"
                      >
                        <option value="">{t("studies.teaching.stepKind.none")}</option>
                        {[...STEP_KINDS, ...(point.kind === "audio" ? (["audio"] as const) : [])].map((k) => (
                          <option key={k} value={k}>{t(`studies.teaching.stepKind.${k}`)}</option>
                        ))}
                      </select>
                    )}
                    <button type="button" id={`${id}-${point.row}-up`} disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("studies.templateEditor.moveUp", { title: label })} className={tool}>
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </button>
                    <button type="button" id={`${id}-${point.row}-down`} disabled={index === points.length - 1} onClick={() => move(index, 1)} aria-label={t("studies.templateEditor.moveDown", { title: label })} className={tool}>
                      <ArrowDown className="size-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => removeAt(index)} aria-label={t("studies.templateEditor.remove", { title: label })} className={`${tool} hover:text-danger`}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          <div>
            <Button id={`${id}-add`} onClick={() => setPoints([...points, asRow({ title: "", kind: steps ? "text" : null })])}>
              <Plus className="size-4" aria-hidden="true" /> {shape("add")}
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
