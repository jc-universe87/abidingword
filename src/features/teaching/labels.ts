import type { TFunction } from "i18next";
import type { AssistAction, MaterialStanding, StepKind, TeachingKind, TeachingPart, TeachingPoint } from "@/types/teaching";

export function teachingKindLabel(t: TFunction, kind: TeachingKind): string {
  return t(`studies.teaching.kind.${kind}`);
}

export function assistLabel(t: TFunction, action: AssistAction): string {
  return t(`studies.teaching.assist.action.${action}`);
}

export function standingLabel(t: TFunction, standing: MaterialStanding, licence?: string | null): string {
  return t(`studies.teaching.standing.${standing}`, { licence: licence ?? "" });
}

export type AssistCategory = "wording" | "review" | "structure" | "ideas" | "research";

/**
 * The help offered for one part: a few plain categories, each with a short
 * list of actions, plus "Ask for something else…" (the person's own words,
 * answered only as comments). Nothing here writes a part for the person.
 */
export function assistCategories(part: TeachingPart): { category: AssistCategory; actions: AssistAction[] }[] {
  if (part === "whole") return [{ category: "structure", actions: ["structure", "restructure"] }];
  const short = part === "audience" || part === "purpose" || part === "pointTitle";
  const all: { category: AssistCategory; actions: AssistAction[] }[] = short
    ? [
        { category: "wording", actions: ["grammar", "clarity", "natural", "translate"] },
        { category: "review", actions: ["review"] },
        { category: "ideas", actions: ["phrasing"] },
      ]
    : [
        { category: "wording", actions: ["grammar", "clarity", "shorten", "natural", "repetition", "spoken", "audience", "translate"] },
        { category: "review", actions: part === "pointApplication" ? ["review", "application", "theology"] : ["review", "theology"] },
        { category: "structure", actions: part === "notes" ? [] : ["transition"] },
        { category: "ideas", actions: part === "notes" ? ["phrasing", "question"] : ["phrasing", "question", "illustration", "visual"] },
        { category: "research", actions: part === "notes" ? ["passages"] : ["passages", "story"] },
      ];
  return all.filter((c) => c.actions.length > 0);
}

/**
 * The shape of the main canvas for a kind of teaching. The stored points are
 * the same for every kind; only what they are called changes: points of a
 * sermon or talk, questions of a group Bible study, steps of a lesson. A
 * future kind-specific canvas (docs/teaching-preparation-v0.16.md) can start
 * from here without a change to the data.
 */
export type CanvasShape = "points" | "questions" | "steps";

export function canvasShape(kind: TeachingKind | null): CanvasShape {
  if (kind === "bible_study") return "questions";
  if (kind === "lesson" || kind === "children") return "steps";
  return "points";
}

export type ShapeText =
  | "message"
  | "messageHint"
  | "introduction"
  | "conclusion"
  | "title"
  | "none"
  | "add"
  | "number"
  | "label"
  | "untitled"
  | "titleLabel"
  | "titlePlaceholder"
  | "explanation"
  | "application"
  | "illustration"
  | "added"
  | "removed"
  | "moved"
  | "deleteConfirm";

/** A teaching's own parts around the main canvas, as its shape names them. */
export type FramePart = "message" | "introduction" | "conclusion";

/**
 * Whether the canvas shows a part around the points: a lesson in steps has
 * its welcome and its ending as steps, so it has no separate introduction
 * or conclusion. A part with writing in it is always shown.
 */
export function showsFrame(shape: CanvasShape, part: FramePart, text: string | null): boolean {
  if (text?.trim()) return true;
  return !(shape === "steps" && (part === "introduction" || part === "conclusion"));
}

/** The fields of one point the canvas shows, in order: those its shape (and, for a step, its kind) uses, and any with writing. */
export function pointFields(shape: CanvasShape, point: Pick<TeachingPoint, "kind" | "explanation" | "application" | "illustration">): ("explanation" | "application" | "illustration")[] {
  const used: Record<"explanation" | "application" | "illustration", boolean> =
    shape === "steps" && point.kind
      ? { explanation: true, application: false, illustration: point.kind === "activity" }
      : { explanation: true, application: true, illustration: true };
  return (["explanation", "application", "illustration"] as const).filter((field) => used[field] || point[field].trim().length > 0);
}

/** Translates a key put together at run time (the keys exist in every language; i18n:check sees to it). */
const dynamic = (t: TFunction, key: string) => (t as unknown as (key: string) => string)(key);

/** A step's field label, after its kind (e.g. "How it works" for an activity); null: the shape's own label. */
export function stepFieldLabel(t: TFunction, kind: StepKind | null, field: "explanation" | "application" | "illustration"): string | null {
  if (!kind || kind === "audio") return null;
  if (field === "explanation") return dynamic(t, `studies.teaching.step.${kind}.explanation`);
  if (field === "illustration" && kind === "activity") return t("studies.teaching.step.activity.illustration");
  return null;
}

/** The title a starting step is given, in the person's language. */
export function startingStepTitle(t: TFunction, kind: TeachingKind, key: string): string {
  return dynamic(t, `studies.teaching.starts.${kind}.${key}`);
}

/** What a new teaching of a kind starts with: the steps of a lesson; nothing for the others. */
export const STARTING_STEPS: Partial<Record<TeachingKind, { key: string; kind: StepKind }[]>> = {
  children: [
    { key: "welcome", kind: "text" },
    { key: "story", kind: "scripture" },
    { key: "question", kind: "question" },
    { key: "activity", kind: "activity" },
    { key: "prayer", kind: "text" },
  ],
  lesson: [
    { key: "teaching", kind: "text" },
    { key: "discussion", kind: "question" },
    { key: "activity", kind: "activity" },
  ],
};
