import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/design-system/Button";

interface StudyAddProps {
  /** Nothing written yet: show the two beginnings openly instead of a menu. */
  empty: boolean;
  onAddNote: () => void;
  onAddSection: () => void;
}

/**
 * The study's one Add action. A new study offers its two ways to begin
 * side by side; once there is writing it is a single "Add" that opens the
 * same two choices.
 */
export function StudyAdd({ empty, onAddNote, onAddSection }: StudyAddProps) {
  const { t } = useTranslation();
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  if (empty) {
    return (
      <div className="flex flex-col gap-2">
        <p className="m-0 text-[1.0625rem] text-text-strong">{t("studies.editor.start")}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onAddNote}>
            <Plus className="size-4" aria-hidden="true" />
            {t("studies.add.note")}
          </Button>
          <Button onClick={onAddSection}>
            <Plus className="size-4" aria-hidden="true" />
            {t("studies.add.section")}
          </Button>
        </div>
      </div>
    );
  }

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <Button ref={toggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Plus className="size-4" aria-hidden="true" />
        {t("studies.add.toggle")}
      </Button>
      {open && (
        <div id={id} role="group" aria-label={t("studies.add.group")} className="flex flex-wrap gap-2">
          <Button variant="quiet" autoFocus onClick={() => choose(onAddNote)}>{t("studies.add.note")}</Button>
          <Button variant="quiet" onClick={() => choose(onAddSection)}>{t("studies.add.section")}</Button>
        </div>
      )}
    </div>
  );
}
