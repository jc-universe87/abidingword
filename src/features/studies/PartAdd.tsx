import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Plus } from "lucide-react";
import { FINDING_TYPES, type FindingType } from "@/types/studies";
import { findingLabel } from "./labels";

/** Offered at once; the other kinds are one step away. */
const COMMON: FindingType[] = ["observation", "question", "interpretation", "application"];

interface PartAddProps {
  /** The part's title, for the button's name. */
  part: string;
  onWriting: () => void;
  onNote: (kind: FindingType) => void;
}

/**
 * Add, at the end of one part of a study: more writing, or a note of a kind
 * people use when they study (an observation, a question…). No generic
 * "item" to pick first. Escape closes it and returns to Add.
 */
export function PartAdd({ part, onWriting, onNote }: PartAddProps) {
  const { t } = useTranslation();
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);

  const choose = (action: () => void) => {
    setOpen(false);
    setMore(false);
    action();
  };
  const kinds = more ? [...FINDING_TYPES] : COMMON;
  const item = "inline-flex min-h-11 items-center gap-1 rounded-aw px-3 text-[0.9375rem] text-text-strong hover:bg-bg-secondary";

  return (
    <div
      className="flex flex-wrap items-center gap-1"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          setMore(false);
          toggle.current?.focus();
        }
      }}
    >
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t("studies.add.to", { part })}
        onClick={() => {
          setOpen(!open);
          setMore(false);
        }}
        className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-bg-secondary hover:text-text-strong"
      >
        <Plus className="size-4" aria-hidden="true" />
        {t("studies.add.toggle")}
      </button>
      {open && (
        <div id={id} role="group" aria-label={t("studies.add.to", { part })} className="flex flex-wrap items-center gap-1">
          <button type="button" autoFocus className={item} onClick={() => choose(onWriting)}>
            {t("studies.add.writing")}
          </button>
          {kinds.map((kind) => (
            <button key={kind} type="button" className={item} onClick={() => choose(() => onNote(kind))}>
              {findingLabel(t, kind)}
            </button>
          ))}
          {!more && (
            <button type="button" aria-expanded={false} onClick={() => setMore(true)} className={`${item} text-text-muted`}>
              <ChevronRight className="size-4" aria-hidden="true" />
              {t("studies.findings.moreTypes")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
