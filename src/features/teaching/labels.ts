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

/** The help offered for one part, in three short groups. Nothing here writes a part for the person. */
export function assistGroups(part: TeachingPart): { group: "wording" | "comments" | "ideas"; actions: AssistAction[] }[] {
  if (part === "whole") return [{ group: "comments", actions: ["structure", "restructure"] }];
  const short = part === "audience" || part === "purpose" || part === "pointTitle";
  const wording: AssistAction[] = short
    ? ["grammar", "clarity", "natural", "translate"]
    : ["grammar", "clarity", "shorten", "natural", "repetition", "spoken", "audience", "translate", "transition"];
  const comments: AssistAction[] = short ? ["review"] : part === "pointApplication" ? ["review", "application", "theology", "passages"] : ["review", "theology", "passages"];
  const ideas: AssistAction[] = short
    ? ["phrasing"]
    : part === "notes"
      ? ["phrasing", "question"]
      : ["phrasing", "question", "illustration", "story", "visual"];
  return [
    { group: "wording", actions: wording },
    { group: "comments", actions: comments },
    { group: "ideas", actions: ideas },
  ];
}
