import { useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/design-system/Button";
import type { StudySection } from "@/types/domain";
import type { StudyTemplate } from "@/types/studies";
import { sectionGuidance, sectionTitle } from "./builtinText";

interface AddPartProps {
  /** The template the study was made with (or the built-in one for its kind): its parts to add later are suggested. */
  template: StudyTemplate | null;
  /** The study's parts now: a suggestion already there is not offered again. */
  sections: StudySection[];
  onAdd: (part: { title: string; guidance?: string }) => Promise<void>;
}

/**
 * Adds a part to the study: one the study's template keeps for later
 * (such as "Key Words"), or one with the person's own heading. The new part
 * is the person's own text, in their language, from then on.
 */
export function AddPart({ template, sections, onAdd }: AddPartProps) {
  const { t } = useTranslation();
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const present = new Set(sections.flatMap((s) => [s.key ?? "", sectionTitle(s).toLocaleLowerCase()]));
  const suggestions = (template?.sections ?? [])
    .filter((s) => s.optional && !s.retired)
    .map((s) => ({ key: s.key ?? "", title: sectionTitle(s), guidance: sectionGuidance(s) ?? undefined }))
    .filter((s) => !present.has(s.key) && !present.has(s.title.toLocaleLowerCase()));

  const close = () => {
    setOpen(false);
    setTitle("");
    toggle.current?.focus();
  };
  const add = async (part: { title: string; guidance?: string }) => {
    if (busy || !part.title.trim()) return;
    setBusy(true);
    try {
      await onAdd({ ...part, title: part.title.trim() });
      setOpen(false);
      setTitle("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <Button ref={toggle} variant="quiet" className="min-h-11 self-start" aria-expanded={open} aria-controls={id} onClick={() => (open ? close() : setOpen(true))}>
        <Plus className="size-4" aria-hidden="true" />
        {t("studies.parts.add")}
      </Button>
      {open && (
        <div id={id} className="flex flex-col gap-2 border-l-[3px] border-border-subtle pl-3">
          {suggestions.length > 0 && (
            <div role="group" aria-label={t("studies.parts.suggested")} className="flex flex-wrap items-center gap-2">
              {suggestions.map((s, index) => (
                <button
                  key={s.key || s.title}
                  type="button"
                  autoFocus={index === 0}
                  disabled={busy}
                  onClick={() => void add(s)}
                  className="min-h-11 rounded-full border border-border px-4 text-[0.9375rem] text-text-strong hover:bg-bg-secondary"
                >
                  {s.title}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void add({ title });
            }}
          >
            <label htmlFor={`${id}-own`} className="sr-only">
              {t("studies.parts.own")}
            </label>
            <input
              id={`${id}-own`}
              autoFocus={suggestions.length === 0}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("studies.parts.own")}
              className="h-11 min-w-0 flex-1 basis-48 rounded-aw border border-border bg-bg px-3 text-[0.9375rem] placeholder:text-text-muted"
            />
            <Button type="submit" variant="primary" className="min-h-11" disabled={busy || !title.trim()}>
              {t("common.add")}
            </Button>
            <Button className="min-h-11" onClick={close}>
              {t("common.cancel")}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
