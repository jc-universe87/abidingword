import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { StudySection } from "@/types/domain";
import { sectionTitle } from "./builtinText";

/** A study with fewer sections than this needs no way to find its way around. */
export const CONTENTS_MIN_SECTIONS = 5;

interface StudyContentsProps {
  sections: StudySection[];
  /** Whether there are findings to jump to. */
  hasFindings: boolean;
}

/**
 * One quiet "Contents" control for a long study: opens a short list of its
 * sections (and the findings, when there are some) and takes the reader to
 * the one chosen. Nothing is shown for a short study.
 */
export function StudyContents({ sections, hasFindings }: StudyContentsProps) {
  const { t } = useTranslation();
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (sections.length < CONTENTS_MIN_SECTIONS) return null;

  const go = (anchor: string, heading: string) => {
    setOpen(false);
    const target = document.getElementById(anchor);
    target?.scrollIntoView?.({ block: "start" });
    // Move reading focus too, so keyboard and screen-reader users arrive there.
    document.getElementById(heading)?.focus({ preventScroll: true });
  };

  const item = "flex min-h-11 w-full items-center rounded-aw px-2 text-left text-[0.9375rem] text-text-strong hover:bg-bg-secondary";
  return (
    <div
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-11 items-center gap-1 rounded-aw px-1 text-[0.9375rem] text-text-muted hover:text-text-strong"
      >
        {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
        {t("studies.editor.contentsToggle")}
      </button>
      {open && (
        <nav id={id} aria-label={t("studies.editor.contents")} className="absolute left-0 top-full z-10 mt-1 max-h-[60vh] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-aw border border-border bg-bg p-1 shadow-lg">
          <ul className="m-0 flex list-none flex-col p-0">
            {hasFindings && (
              <li>
                <button type="button" className={item} onClick={() => go("study-findings", "study-findings")}>
                  {t("studies.editor.findingsLink")}
                </button>
              </li>
            )}
            {sections.map((section) => (
              <li key={section.id}>
                <button type="button" className={item} onClick={() => go(`section-anchor-${section.id}`, `section-${section.id}`)}>
                  {sectionTitle(section)}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
