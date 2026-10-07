// Interface names for stable internal codes. The stored values never
// change; only their labels are translated (docs/i18n.md, "Enums").
import type { TFunction } from "i18next";
import type { BlockType } from "@/types/domain";
import type { FindingType, RelationType, StudyStatus, StudyType } from "@/types/studies";

export function studyTypeLabel(t: TFunction, type: StudyType): string {
  return t(`studies.studyType.${type}`);
}

export function statusLabel(t: TFunction, status: StudyStatus): string {
  return t(`studies.status.${status}`);
}

/** "Observation" — as a label or at the start of a sentence. */
export function findingLabel(t: TFunction, type: FindingType): string {
  return t(`studies.findingType.${type}`);
}

/** "Observations" — a filter for several findings of one type. */
export function findingPlural(t: TFunction, type: FindingType): string {
  return t(`studies.findingTypePlural.${type}`);
}

/** "observation" — the type's name inside a sentence ("Delete this observation?"). */
export function findingInline(t: TFunction, type: FindingType): string {
  return t(`studies.findingTypeInline.${type}`);
}

export function blockLabel(t: TFunction, type: BlockType): string {
  return t(`studies.blockType.${type}`);
}

/** A block type's name inside a sentence. */
export function blockInline(t: TFunction, type: BlockType): string {
  return t(`studies.blockTypeInline.${type}`);
}

/** How a relation reads from this study's side. */
export function relationLabel(t: TFunction, type: RelationType, direction: "outgoing" | "incoming"): string {
  return t(`studies.relation.${direction}.${type}`);
}

/** Whether a study type is normally about one passage. */
export function isPassageCentred(type: StudyType): boolean {
  return type === "passage" || type === "teaching";
}
