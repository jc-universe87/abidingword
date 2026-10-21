import i18n, { type TFunction } from "i18next";
import { LANGUAGES } from "@/i18n/languages";
import builtin from "../../../resources/teaching-templates.json";
import type { StepKind, TeachingKind, TeachingPreparation, TeachingTemplate, TeachingTemplatePoint } from "@/types/teaching";
import { canvasShape, startingStepTitle } from "./labels";

/**
 * Bible Teaching templates (v0.18.7): what a new teaching starts with, its
 * format and its points, questions or steps. The built-in ones (one per
 * format, from resources/teaching-templates.json) are application text in
 * the person's language and cannot be changed; the person's own are kept by
 * the core. A teaching copies its template when it is made, and is never
 * linked to it afterwards.
 */
export interface BuiltinTeachingTemplate {
  key: string;
  kind: TeachingKind;
  points: { key: string; kind: StepKind }[];
}

export const BUILTIN_TEACHING_TEMPLATES: readonly BuiltinTeachingTemplate[] = builtin.templates as BuiltinTeachingTemplate[];

/** A template to start from: a built-in one, or one of the person's own. */
export type TeachingStart = { builtin: BuiltinTeachingTemplate } | { mine: TeachingTemplate };

export const startKind = (start: TeachingStart): TeachingKind => ("builtin" in start ? start.builtin.kind : start.mine.kind);

/** The built-in starting steps a kind of teaching knows, by key. */
const builtinStep = (kind: TeachingKind, key: string | null | undefined) =>
  key ? BUILTIN_TEACHING_TEMPLATES.find((b) => b.kind === kind)?.points.find((p) => p.key === key) : undefined;

/**
 * A template point's title: a built-in step's in the person's language while
 * it is unchanged (as saved in any language, or left empty), else as written.
 */
export function templatePointTitle(t: TFunction, kind: TeachingKind, point: TeachingTemplatePoint): string {
  if (point.key && builtinStep(kind, point.key)) {
    const key = `studies.teaching.starts.${kind}.${point.key}`;
    const unchanged = !point.title.trim() || LANGUAGES.some(({ code }) => i18n.t(key as never, { lng: code }) === point.title);
    if (unchanged) return startingStepTitle(t, kind, point.key);
  }
  return point.title;
}

/** The points a new teaching starts with: titled in the person's language, with their kinds. */
export function startingPoints(t: TFunction, start: TeachingStart): { title: string; kind: StepKind | null }[] {
  if ("builtin" in start) return start.builtin.points.map((p) => ({ title: startingStepTitle(t, start.builtin.kind, p.key), kind: p.kind }));
  return start.mine.points.map((p) => ({ title: templatePointTitle(t, start.mine.kind, p), kind: p.kind ?? null }));
}

/** A built-in template's points as the person's own copy, in their language ("Save as my template"). */
export function builtinPoints(t: TFunction, template: BuiltinTeachingTemplate): TeachingTemplatePoint[] {
  return template.points.map((p) => ({ key: p.key, title: startingStepTitle(t, template.kind, p.key), kind: p.kind }));
}

/**
 * A teaching's structure as a template of the person's own ("Save as my
 * template"): its format and as many points, questions or steps as it has,
 * each step with its kind. The steps of a lesson keep their titles ("Welcome",
 * "Game"): they name what happens. The points of a sermon and the questions
 * of a group study are the teaching itself, so they start untitled. Nothing
 * written in the teaching comes with it: no audience, purpose, message,
 * introduction, conclusion, notes, explanation, application, illustration,
 * passages, findings or kept material.
 */
export function templateFromTeaching(prep: Pick<TeachingPreparation, "kind" | "points">): { kind: TeachingKind; points: TeachingTemplatePoint[] } {
  const kind = prep.kind ?? "other";
  const steps = canvasShape(kind) === "steps";
  return {
    kind,
    points: prep.points.map((p) => ({
      title: steps ? p.title.trim() : "",
      ...(p.kind ? { kind: p.kind } : {}),
    })),
  };
}

/** What a template gives to work in: its format, and what it starts with ("Starts with: Welcome · Game · Step 3."). */
export function startSummary(t: TFunction, start: TeachingStart): string {
  const kind = startKind(start);
  const shape = canvasShape(kind);
  const format = t(`studies.teaching.format.${shape}`);
  const points = startingPoints(t, start);
  if (points.length === 0) return format;
  const names = points.map((p, i) => p.title || (t as unknown as (key: string, o: object) => string)(`studies.teaching.shape.${shape}.untitled`, { number: i + 1 }));
  return `${format} ${t("studies.teaching.startsWith", { steps: names.join(t("common.listSeparator")) })}`;
}
