// Names for the kinds of help and the kinds of points (v0.20). Stored and
// sent values never change; only their labels are translated.
import type { TFunction } from "i18next";
import type { Inquiry, PointKind } from "@/types/inquiry";

/** The menu's groups, in order: what the help does for the person. */
export type InquiryGroup = "text" | "thinking" | "source" | "compare" | "wording" | "own";

const GROUPS: { key: InquiryGroup; actions: readonly Inquiry[] }[] = [
  { key: "text", actions: ["understand", "context", "expression", "related", "readings"] },
  { key: "thinking", actions: ["follows", "overlooked", "assumptions", "questions", "unresolved"] },
  { key: "source", actions: ["summary", "argument", "source_assumptions", "source_passages", "conclusion", "investigate", "relate_study"] },
  { key: "compare", actions: ["compare"] },
  { key: "wording", actions: ["clarify", "grammar"] },
  { key: "own", actions: ["free"] },
];

/** The groups that hold any of `offered`, each with only the offered kinds. */
export function inquiryGroups(offered: readonly Inquiry[]): { key: InquiryGroup; actions: Inquiry[] }[] {
  return GROUPS.map((g) => ({ key: g.key, actions: g.actions.filter((a) => offered.includes(a)) })).filter((g) => g.actions.length > 0);
}

/** "In the text", "The author says", "Assistant's inference"… */
export function kindLabel(t: TFunction, kind: PointKind): string {
  return t(`studies.inquiry.kind.${kind}`);
}
