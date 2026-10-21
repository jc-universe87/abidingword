// Built-in study templates are application text, shown in the interface
// language; what a study copied from one is the user's own text from then
// on. The database keeps the English the templates were installed with, so
// a section is shown translated only while it still has exactly that
// English wording. Once the user renames it, their wording is shown as it
// is. No stored text is ever rewritten (docs/i18n.md, "Built-in templates").
import i18n, { type TFunction } from "i18next";
import biblicalTheology from "../../../resources/templates/biblical-theology-study.json";
import passage from "../../../resources/templates/passage-study.json";
import systematicTheology from "../../../resources/templates/systematic-theology-study.json";
import teaching from "../../../resources/templates/teaching-study.json";
import topical from "../../../resources/templates/topical-study.json";
import word from "../../../resources/templates/word-study.json";
import type { StudyTemplate, TemplateSection } from "@/types/studies";

interface BuiltinDefinition {
  key: string;
  name: string;
  description?: string | null;
  /** False: kept only for the studies made with it, never offered for a new one (e.g. the old teaching study). */
  offered?: boolean;
  sections: { key: string; title: string; guidance?: string | null; optional?: boolean; retired?: boolean; phase?: string | null }[];
}

const BUILTIN: BuiltinDefinition[] = [passage, word, topical, biblicalTheology, systematicTheology, teaching];
const BY_KEY = new Map(BUILTIN.map((t) => [t.key, t]));

/** The section title a study without a template starts with. */
const DEFAULT_SECTION = "Notes";

function translate(key: string, fallback: string): string {
  return (i18n.t as (key: string, options: Record<string, unknown>) => string)(key, { defaultValue: fallback });
}

/** Finds the built-in section a stored section was copied from, by key and unchanged English. */
function builtinSection(key: string | null | undefined, field: "title" | "guidance", english: string) {
  if (!key) return null;
  for (const template of BUILTIN) {
    const section = template.sections.find((s) => s.key === key && (s[field] ?? "") === english);
    if (section) return { template: template.key, section: section.key };
  }
  return null;
}

/** A section's title: translated while it is the built-in English, otherwise as written. */
export function sectionTitle(section: { key?: string | null; title: string }): string {
  if (!section.key && section.title === DEFAULT_SECTION) return translate("studies.builtin.defaultSection", section.title);
  const found = builtinSection(section.key, "title", section.title);
  return found
    ? translate(`studies.builtin.templates.${found.template}.sections.${found.section}.title`, section.title)
    : section.title;
}

/** A section's guidance, by the same rule as its title. */
export function sectionGuidance(section: { key?: string | null; guidance?: string | null }): string | null {
  if (!section.guidance) return section.guidance ?? null;
  const found = builtinSection(section.key, "guidance", section.guidance);
  return found
    ? translate(`studies.builtin.templates.${found.template}.sections.${found.section}.guidance`, section.guidance)
    : section.guidance;
}

/** A built-in template's name and description in the interface language; user templates as written. */
export function templateName(template: Pick<StudyTemplate, "key" | "name" | "isBuiltin">): string {
  return template.isBuiltin && BY_KEY.has(template.key)
    ? translate(`studies.builtin.templates.${template.key}.name`, template.name)
    : template.name;
}

export function templateDescription(template: Pick<StudyTemplate, "key" | "description" | "isBuiltin">): string | null {
  return template.isBuiltin && BY_KEY.has(template.key) && template.description
    ? translate(`studies.builtin.templates.${template.key}.description`, template.description)
    : template.description;
}

/**
 * A built-in template's sections in the interface language, e.g. to make a
 * user's own copy in their language ("Save as my template").
 */
export function localizedSections(template: Pick<StudyTemplate, "key" | "isBuiltin" | "sections">): TemplateSection[] {
  if (!template.isBuiltin || !BY_KEY.has(template.key)) return template.sections;
  // Retired parts stay behind; the parts to add later stay optional in the copy.
  return template.sections
    .filter((s) => !s.retired)
    .map((s) => ({
      key: s.key ?? null,
      title: sectionTitle({ key: s.key, title: s.title }),
      guidance: sectionGuidance({ key: s.key, guidance: s.guidance }),
      phase: s.phase ?? null,
      ...(s.optional ? { optional: true } : {}),
    }));
}

/** Whether a built-in template is offered for new work (its resource file says so); a user's own always is. */
export function isOffered(template: Pick<StudyTemplate, "key" | "isBuiltin">): boolean {
  return !template.isBuiltin || BY_KEY.get(template.key)?.offered !== false;
}

/**
 * What a template starts a study with, from its own parts ("Starts with:
 * Text · Observations · Context."), in the interface language. No template:
 * the one part a study of its own shape starts with. Shared by every place
 * a template is chosen, so a preview never says something the template
 * does not (v0.18.8).
 */
export function studyStartSummary(t: TFunction, template: Pick<StudyTemplate, "sections"> | null): string {
  const parts = template ? template.sections.filter((s) => !s.optional && !s.retired).map(sectionTitle) : [sectionTitle({ key: null, title: DEFAULT_SECTION })];
  return t("studies.newStudy.startsWith", { parts: parts.join(t("common.listSeparator")) });
}
