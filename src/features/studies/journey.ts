import type { StudySection } from "@/types/domain";
import type { StudyType } from "@/types/studies";

/**
 * The movement of a Bible Study (v0.18.6): from the text, through
 * understanding it and what it teaches about God, to living it, the people
 * it is for, and teaching it. The phases only group the study's own parts
 * where they stand; nothing is reordered, renamed or locked, and a part can
 * be worked on in any order.
 */
export const PHASES = ["text", "understanding", "theology", "application", "audience", "teaching"] as const;
export type Phase = (typeof PHASES)[number];

/**
 * The phase of a part, by the built-in part it was made from (its key,
 * which stays when the part is renamed). The same key can mean different
 * things in different kinds of study: "conclusions" of a word study say what
 * a word means, of a systematic theology study what is believed; in a study
 * made to prepare a teaching, everything after its theology is preparing the
 * teaching.
 */
const BY_KEY: Record<string, Phase> = {
  // The text and what is in it
  text: "text",
  observations: "text",
  context: "text",
  structure: "text",
  "key-words": "text",
  word: "text",
  occurrences: "text",
  topic: "text",
  "key-passages": "text",
  "key-texts": "text",
  doctrine: "text",
  theme: "text",
  // What it means
  meaning: "understanding",
  exegesis: "understanding",
  "main-idea": "understanding",
  "related-scripture": "understanding",
  "open-questions": "understanding",
  "semantic-range": "understanding",
  "immediate-contexts": "understanding",
  "main-themes": "understanding",
  "biblical-context": "understanding",
  "difficult-passages": "understanding",
  "old-testament": "understanding",
  "new-testament": "understanding",
  gospels: "understanding",
  epistles: "understanding",
  "canonical-development": "understanding",
  conclusions: "understanding",
  // What it teaches about God
  theology: "theology",
  fulfilment: "theology",
  synthesis: "theology",
  "biblical-synthesis": "theology",
  "historical-theology": "theology",
  "confessional-witness": "theology",
  "alternative-positions": "theology",
  "theological-significance": "theology",
  // Living it, the people, teaching it
  application: "application",
  audience: "audience",
  teaching: "teaching",
  "teaching-outline": "teaching",
  illustrations: "teaching",
  purpose: "teaching",
};

const BY_TYPE: Partial<Record<StudyType, Record<string, Phase>>> = {
  systematic_theology: { conclusions: "theology" },
  // A study made to prepare a teaching: its purpose, audience, structure and application are the teaching's.
  teaching: { purpose: "teaching", audience: "teaching", structure: "teaching", application: "teaching" },
};

export function phaseOfKey(key: string | null, studyType: StudyType): Phase | null {
  if (!key) return null;
  return BY_TYPE[studyType]?.[key] ?? BY_KEY[key] ?? null;
}

export interface PhaseRun {
  /** Null: parts before any recognised one (a study of the person's own shape). */
  phase: Phase | null;
  sections: StudySection[];
}

/**
 * The study's parts as consecutive runs of one phase, in the person's own
 * order. A part not made from a built-in one (added by the person) belongs to
 * the phase of the part before it. When a part of an earlier phase comes
 * later (an optional part added at the end, say), it starts a run of its own:
 * the grouping shows the study as it is.
 */
export function phaseRuns(sections: readonly StudySection[], studyType: StudyType): PhaseRun[] {
  const runs: PhaseRun[] = [];
  let current: Phase | null = null;
  for (const section of sections) {
    const own = phaseOfKey(section.key, studyType);
    const phase: Phase | null = own ?? current;
    const last = runs[runs.length - 1];
    if (last && last.phase === phase) last.sections.push(section);
    else runs.push({ phase, sections: [section] });
    current = phase;
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
