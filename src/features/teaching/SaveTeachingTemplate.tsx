import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutTemplate } from "lucide-react";
import { Button } from "@/design-system/Button";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { TeachingPreparation } from "@/types/teaching";
import { shapeWords } from "./labels";
import { templateFromTeaching } from "./teachingTemplates";

/**
 * "Save as my template" for a Bible Teaching (v0.18.7): its structure, never
 * what was written in it, becomes a template of the person's own for later
 * teachings. Says what is kept and what is not before saving. The teaching
 * itself is not changed, and not linked to the template afterwards.
 */
/** The most points or steps a template starts with (the core's limit). */
const MAX_STARTING_POINTS = 20;

export function SaveTeachingTemplate({ preparation }: { preparation: TeachingPreparation }) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  // As the core allows (db/teaching_templates.rs): a template starts with at most 20 points or steps.
  const fits = preparation.points.length <= MAX_STARTING_POINTS;
  const [name, setName] = useState(preparation.title);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shape = shapeWords(preparation.kind);

  const save = async () => {
    if (busy || !name.trim() || !fits) return;
    setBusy(true);
    setError(null);
    try {
      const template = await api.teachingTemplateCreate({ name: name.trim(), ...templateFromTeaching(preparation) });
      setSaved(template.name);
      close();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <button
          ref={toggle}
          type="button"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => {
            setOpen(!open);
            setSaved(null);
          }}
          className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-hover hover:text-text-strong"
        >
          <LayoutTemplate className="size-4" aria-hidden="true" />
          {t("studies.teaching.saveTemplate.action")}
        </button>
      </div>
      {open && (
        <form
          id={id}
          aria-label={t("studies.teaching.saveTemplate.group")}
          className="flex flex-col gap-2 border-l-[3px] border-accent bg-bg px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-[0.9375rem] font-medium text-text-muted">{t("studies.teaching.saveTemplate.name")}</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="h-11 aw-input px-3 text-text-strong" />
          </label>
          <p className="m-0 text-[0.9375rem] text-text">
            {fits ? t(`studies.teaching.saveTemplate.keeps.${shape}`) : t("studies.teaching.saveTemplate.tooMany", { max: MAX_STARTING_POINTS })}
          </p>
          <p className="m-0 text-[0.9375rem] text-text-muted">{t("studies.teaching.saveTemplate.notKept")}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy || !name.trim() || !fits}>{t("studies.templateEditor.save")}</Button>
            <Button variant="quiet" onClick={close}>{t("common.cancel")}</Button>
          </div>
          {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
        </form>
      )}
      {saved && <p role="status" className="m-0 text-[0.9375rem] text-text-muted">{t("studies.teaching.saveTemplate.saved", { name: saved })}</p>}
    </div>
  );
}
