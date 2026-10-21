import { useTranslation } from "react-i18next";
import { STUDY_PHASES, type StudyPhase } from "@/types/studies";
import { usePhaseName } from "./StudyJourney";

/**
 * Where a part belongs in the study outline (v0.18.7): one of the six
 * phases, or none. A part with none stays where it is and is never given a
 * meaning of its own; it only sits with the part before it.
 */
export function PhaseSelect({
  value,
  onChange,
  label,
  className = "",
  large = false,
}: {
  value: StudyPhase | null | undefined;
  onChange: (phase: StudyPhase | null) => void;
  label: string;
  className?: string;
  /** In the study itself: a 44 px target, like the controls around it. */
  large?: boolean;
}) {
  const { t } = useTranslation();
  const name = usePhaseName();
  return (
    <label className={`inline-flex min-h-11 items-center gap-2 text-[0.9375rem] text-text ${className}`}>
      <span aria-hidden="true">{t("studies.phase.label")}</span>
      <select aria-label={label} value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as StudyPhase | null)} className={`aw-input ${large ? "h-11" : "h-10"} min-w-0 px-2 text-[0.9375rem]`}>
        <option value="">{t("studies.phase.none")}</option>
        {STUDY_PHASES.map((phase) => (
          <option key={phase} value={phase}>
            {name(phase)}
          </option>
        ))}
      </select>
    </label>
  );
}
