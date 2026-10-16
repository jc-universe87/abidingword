import type { TFunction } from "i18next";
import type { AssistAction, MaterialStanding, TeachingKind, TeachingPart } from "@/types/teaching";

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
  | "illustration";
