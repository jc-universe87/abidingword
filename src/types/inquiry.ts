// Study and research help (v0.20). Mirrors `src-tauri/src/assistant/inquiry/`.
import type { TextPoint } from "./library";
import type { ScriptureRef } from "./scripture";
import type { FindingType } from "./studies";

export const STUDY_INQUIRIES = [
  "understand",
  "context",
  "expression",
  "related",
  "readings",
  "follows",
  "overlooked",
  "assumptions",
  "questions",
  "unresolved",
  "clarify",
  "grammar",
  "free",
] as const;

export const SOURCE_INQUIRIES = ["summary", "argument", "source_assumptions", "source_passages", "conclusion", "investigate", "relate_study", "free"] as const;

export type Inquiry = (typeof STUDY_INQUIRIES)[number] | (typeof SOURCE_INQUIRIES)[number] | "compare";

/** Selected words of a library source, as the reader has them. */
export interface ExcerptInput {
  sourceId: string;
  start: TextPoint;
  end: TextPoint;
  quote: string;
}

export type InquiryScope =
  | {
      kind: "study";
      studyId: string;
      sectionId: string | null;
      blockId?: string | null;
      /** The writing in focus, as it is on screen. */
      text?: string;
      /** Words selected in it, exactly. */
      selected?: string;
      findingId?: string | null;
    }
  | { kind: "source"; excerpt: ExcerptInput; studyId?: string | null }
  | { kind: "compare"; excerpts: ExcerptInput[]; studyId?: string | null };

export interface InquiryInput {
  scope: InquiryScope;
  action: Inquiry;
  request?: string;
  uiLanguage: string;
}

export type BlockKind = "scripture" | "writing" | "note" | "quote" | "source" | "request";

/** One labelled piece of what would be sent, word for word. */
export interface SharedBlock {
  id: string;
  kind: BlockKind;
  label: string;
  text: string;
  reference: ScriptureRef | null;
  translation: string | null;
  sourceId: string | null;
  location: string | null;
}

export interface InquiryPreview {
  remote: boolean;
  assistant: string;
  blocks: SharedBlock[];
  /** Words of library books are included. */
  sourceText: boolean;
  /** Always false: this help does not search the web. */
  searches: boolean;
  /** Asking sends only what has this fingerprint. */
  fingerprint: string;
}

export interface SourceLink {
  sourceId: string;
  title: string;
  author: string | null;
  location: string;
  start: TextPoint;
  end: TextPoint;
  quote: string;
}

export interface Evidence {
  block: string;
  kind: BlockKind;
  label: string;
  quote: string;
  source: SourceLink | null;
}

export type PointKind =
  | "text"
  | "source"
  | "writing"
  | "interpretation"
  | "inference"
  | "knowledge"
  | "question"
  | "uncertain"
  | "position"
  | "agreement"
  | "disagreement"
  | "assumption"
  | "unsupported";

export const POINT_KINDS: readonly PointKind[] = [
  "text",
  "source",
  "writing",
  "interpretation",
  "inference",
  "knowledge",
  "question",
  "uncertain",
  "position",
  "agreement",
  "disagreement",
  "assumption",
  "unsupported",
];

export interface InsightPoint {
  kind: PointKind;
  text: string;
  about: string | null;
  aboutLabel: string | null;
  evidence: Evidence[];
  /** Passages the assistant names (suggestions, recognised by the app). */
  references: ScriptureRef[];
  /** Shown as inference: the words it relied on were not in what was sent. */
  downgraded: boolean;
}

export type Verdict = "agree" | "disagree" | "partly" | "insufficient";

export type InquiryResult =
  | { type: "proposal"; original: string; suggestion: string; changes: string }
  | { type: "insight"; summary: string; points: InsightPoint[]; verdict: Verdict | null; unverified: number; downgraded: number };

export interface InquiryReply {
  result: InquiryResult;
  assistant: string;
  remote: boolean;
}

/** Keeps help the person accepted as a note in their study. */
export interface KeepInsight {
  studyId: string;
  sectionId?: string | null;
  findingType: FindingType;
  content: string;
  assistant: string;
  citations?: ExcerptInput[];
}
