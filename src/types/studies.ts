// TypeScript mirror of the Studies v0.3 native types
// (src-tauri/src/domain/studies.rs). Keep both sides in step.
import type { FindingCitation } from "./library";
import type { ScriptureRef } from "./scripture";

export const STUDY_TYPES = [
  "passage",
  "word",
  "topical",
  "biblical_theology",
  "systematic_theology",
  "teaching",
  "custom",
] as const;
export type StudyType = (typeof STUDY_TYPES)[number];

export const STUDY_STATUSES = ["active", "paused", "completed", "archived"] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

export const FINDING_TYPES = [
  "observation",
  "interpretation",
  "question",
  "quotation",
  "doctrine",
  "application",
  "illustration",
  "teaching_idea",
  "unresolved_issue",
  "conclusion",
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

export const RELATION_TYPES = ["related", "continues", "contrasts", "supports", "custom"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export type PassageRole = "primary" | "related";

export interface StudyDetails {
  lemma?: string | null;
  originalLanguage?: string | null;
  lexicalId?: string | null;
  audience?: string | null;
  duration?: string | null;
  teachingFormat?: string | null;
}

export interface StudySummary {
  id: string;
  projectId: string;
  projectTitle: string;
  title: string;
  studyType: StudyType;
  status: StudyStatus;
  primaryPassage: ScriptureRef | null;
  findingCount: number;
  updatedAt: string;
}

export interface ListStudies {
  projectId?: string;
  studyType?: StudyType;
  status?: StudyStatus;
}

export interface FindingPassage {
  id: string;
  reference: ScriptureRef;
}

export interface Finding {
  id: string;
  studyId: string;
  sectionId: string | null;
  findingType: FindingType;
  content: string;
  sortOrder: number;
  parentId: string | null;
  passages: FindingPassage[];
  tags: string[];
  /** Library sources this finding cites. */
  sources: FindingCitation[];
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface CreateFinding {
  studyId: string;
  findingType: FindingType;
  content?: string;
  sectionId?: string;
  passage?: string;
}

export interface UpdateFinding {
  id: string;
  findingType?: FindingType;
  content?: string;
  /** "" makes the finding study-level. */
  sectionId?: string;
}

export interface RelatedStudy {
  id: string;
  projectId: string;
  title: string;
  studyType: StudyType;
}

export interface StudyRelation {
  id: string;
  relationType: RelationType;
  direction: "outgoing" | "incoming";
  note: string | null;
  other: RelatedStudy;
  createdAt: string;
}

export interface StudySearchHit {
  studyId: string;
  studyTitle: string;
  projectId: string;
  kind: "study" | "section" | "block" | "finding";
  /** English description from the core; the interface uses the fields below. */
  location: string;
  /** Block hits: the section's key and title. */
  sectionKey: string | null;
  sectionTitle: string | null;
  /** Finding hits: the finding's type. */
  findingType: FindingType | null;
  /** Matches are wrapped in U+0002 … U+0003. */
  snippet: string;
}

export interface TemplateSection {
  key?: string | null;
  title: string;
  guidance?: string | null;
}

export interface StudyTemplate {
  id: string;
  key: string;
  name: string;
  description: string | null;
  studyType: StudyType;
  isBuiltin: boolean;
  sections: TemplateSection[];
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface TemplateInput {
  name: string;
  description?: string;
  studyType: StudyType;
  sections: TemplateSection[];
}

export interface Reorder {
  parentId: string;
  ids: string[];
}
