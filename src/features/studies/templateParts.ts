import type { StudySection } from "@/types/domain";
import type { TemplateSection } from "@/types/studies";
import { sectionGuidance, sectionTitle } from "./builtinText";

/**
 * A stable key for a part of the person's own (v0.18.7): it stays when the
 * part is renamed, so a study can tell the part is already there. It never
 * matches a built-in part's key, and gives the part no meaning of its own.
 */
export const ownPartKey = () => `own-${Math.random().toString(36).slice(2, 10)}`;

/**
 * A study's structure as the parts of a template of the person's own
 * ("Save as my template", v0.18.7): each part's heading and guidance as the
 * person sees them, its key and its place in the outline, in the study's
 * order. Nothing written in the study comes with it: no writing, notes,
 * passages or details. Every part gets a key of its own, once.
 */
export function partsFromStudy(sections: readonly StudySection[]): TemplateSection[] {
  const used = new Set<string>();
  return sections.map((section) => {
    let key = section.key;
    if (!key || used.has(key)) key = ownPartKey();
    used.add(key);
    const guidance = sectionGuidance(section);
    return { key, title: sectionTitle(section), guidance: guidance || null, phase: section.phase ?? null };
  });
}
