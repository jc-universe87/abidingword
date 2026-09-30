// Plain-English names for stable internal codes.
import type { FindingType, RelationType, StudyStatus, StudyType } from "@/types/studies";

export const STUDY_TYPE_LABELS: Record<StudyType, string> = {
  passage: "Passage Study",
  word: "Word Study",
  topical: "Topical Study",
  biblical_theology: "Biblical Theology Study",
  systematic_theology: "Systematic Theology Study",
  teaching: "Teaching / Sermon",
  custom: "Custom Study",
};

export const STATUS_LABELS: Record<StudyStatus, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  archived: "Archived",
};

export const FINDING_LABELS: Record<FindingType, string> = {
  observation: "Observation",
  interpretation: "Interpretation",
  question: "Question",
  quotation: "Quotation",
  doctrine: "Doctrine",
  application: "Application",
  illustration: "Illustration",
  teaching_idea: "Teaching idea",
  unresolved_issue: "Unresolved issue",
  conclusion: "Conclusion",
};

export const FINDING_PLURALS: Record<FindingType, string> = {
  observation: "Observations",
  interpretation: "Interpretations",
  question: "Questions",
  quotation: "Quotations",
  doctrine: "Doctrine",
  application: "Applications",
  illustration: "Illustrations",
  teaching_idea: "Teaching ideas",
  unresolved_issue: "Unresolved issues",
  conclusion: "Conclusions",
};

/** How a relation reads from this study's side. */
export function relationLabel(type: RelationType, direction: "outgoing" | "incoming"): string {
  const outgoing: Record<RelationType, string> = {
    related: "Related to",
    continues: "Continues",
    contrasts: "Contrasts with",
    supports: "Supports",
    custom: "Linked to",
  };
  const incoming: Record<RelationType, string> = {
    related: "Related to",
    continues: "Continued by",
    contrasts: "Contrasts with",
    supports: "Supported by",
    custom: "Linked from",
  };
  return direction === "outgoing" ? outgoing[type] : incoming[type];
}

export const RELATION_CHOICES: Record<RelationType, string> = {
  related: "is related to",
  continues: "continues",
  contrasts: "contrasts with",
  supports: "supports",
  custom: "is linked to",
};

/** Whether a study type is normally about one passage. */
export function isPassageCentred(type: StudyType): boolean {
  return type === "passage" || type === "teaching";
}
