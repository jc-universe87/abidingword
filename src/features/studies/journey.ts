import type { StudySection } from "@/types/domain";
import { STUDY_PHASES, type StudyPhase } from "@/types/studies";

/**
 * The movement of a Bible Study (v0.18.6): from the text, through
 * understanding it and what it teaches about God, to living it, the people
 * it is for, and teaching it. The phases only group the study's own parts
 * where they stand; nothing is reordered, renamed or locked, and a part can
 * be worked on in any order.
 *
 * Since v0.18.7 each part carries its phase itself, from the template it was
 * made with (built-in or the person's own), and the person can change it. A
 * study need not use all six phases, or use them in this order.
 */
export const PHASES = STUDY_PHASES;
export type Phase = StudyPhase;

export interface PhaseRun {
  /** Null: parts before any with a phase (a study of the person's own shape). */
  phase: Phase | null;
  sections: StudySection[];
}

/**
 * The study's parts as consecutive runs of one phase, in the person's own
 * order. A part without a phase of its own (one the person added, say) never
 * begins a phase: it stays with the part before it, without taking on its
 * meaning. When a part of an earlier phase comes later, it starts a run of
 * its own: the grouping shows the study as it is.
 */
export function phaseRuns(sections: readonly StudySection[]): PhaseRun[] {
  const runs: PhaseRun[] = [];
  for (const section of sections) {
    const last = runs[runs.length - 1];
    const phase = section.phase ?? last?.phase ?? null;
    if (last && last.phase === phase) last.sections.push(section);
    else runs.push({ phase, sections: [section] });
  }
  return runs;
}

/** Whether a study has enough of a movement to show it: at least three different phases. */
export function hasJourney(runs: readonly PhaseRun[]): boolean {
  return new Set(runs.map((r) => r.phase).filter(Boolean)).size >= 3;
}

/**
 * Whether a run needs its phase named above it: not when its first part's own
 * title already says the same ("Theology" above "Theology", "Text" above
 * "Text, Observations, Context").
 */
export function namesRun(run: PhaseRun, phaseName: string, title: (section: StudySection) => string): boolean {
  if (!run.phase) return false;
  return title(run.sections[0]!).trim().toLocaleLowerCase() !== phaseName.trim().toLocaleLowerCase();
}
