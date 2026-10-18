// TypeScript mirror of the Teaching Preparation and assistant types (v0.16):
// src-tauri/src/domain/teaching.rs and src-tauri/src/assistant/. Keep both
// sides in step.
import type { ScriptureRef } from "./scripture";
import type { Finding } from "./studies";

export const TEACHING_KINDS = ["sermon", "bible_study", "youth", "children", "lesson", "talk", "other"] as const;
export type TeachingKind = (typeof TEACHING_KINDS)[number];

export interface TeachingSummary {
  id: string;
  studyId: string;
  title: string;
  kind: TeachingKind | null;
  updatedAt: string;
}

/** The kinds of step a lesson is made of (audio is kept for later: not offered yet). */
export const STEP_KINDS = ["text", "scripture", "question", "activity", "image"] as const;
export type StepKind = (typeof STEP_KINDS)[number] | "audio";

export interface TeachingPoint {
  id: string;
  position: number;
  /** For a step of a lesson: what kind of step it is; null when not said. */
  kind: StepKind | null;
  title: string;
  explanation: string;
  application: string;
  illustration: string;
}

export interface TeachingFindingLink {
  id: string;
  /** null: used for the teaching as a whole. */
  pointId: string | null;
  /** Live: the finding as it is in the study now. */
  finding: Finding;
}

export interface TeachingPassage {
  id: string;
  pointId: string | null;
  reference: ScriptureRef;
}

/** A source a search returned (never an address the assistant wrote). */
export interface ExternalSource {
  title: string;
  url: string;
  site: string;
  excerpt: string;
}

export interface ImageInfo {
  url?: string | null;
  pageUrl?: string | null;
  thumbUrl?: string | null;
  licence?: string | null;
  licenceUrl?: string | null;
  author?: string | null;
  attribution?: string | null;
  /** A generated image kept in the data folder. */
  file?: string | null;
}

export type MaterialKind = "story" | "illustration" | "image" | "visual";
/** How far a kept item can be relied on; always shown with it. */
export type MaterialStanding = "verified" | "unverified" | "hypothetical" | "found" | "generated" | "suggestion";

export interface TeachingMaterial {
  id: string;
  pointId: string | null;
  kind: MaterialKind;
  standing: MaterialStanding;
  title: string;
  content: string;
  sources: ExternalSource[];
  image: ImageInfo | null;
  assistant: string | null;
  createdAt: string;
}

export interface TeachingPreparation {
  id: string;
  studyId: string;
  title: string;
  kind: TeachingKind | null;
  audience: string | null;
  purpose: string | null;
  centralMessage: string | null;
  introduction: string;
  conclusion: string;
  notes: string;
  points: TeachingPoint[];
  findings: TeachingFindingLink[];
  passages: TeachingPassage[];
  materials: TeachingMaterial[];
  createdAt: string;
  updatedAt: string;
  revision: number;
}

/** Fields left out are unchanged; "" clears an optional one. */
export interface UpdateTeaching {
  id: string;
  title?: string;
  kind?: TeachingKind | "";
  audience?: string;
  purpose?: string;
  centralMessage?: string;
  introduction?: string;
  conclusion?: string;
  notes?: string;
}

export interface UpdateTeachingPoint {
  id: string;
  /** "" clears it. */
  kind?: StepKind | "";
  title?: string;
  explanation?: string;
  application?: string;
  illustration?: string;
}

export interface KeepTeachingMaterial {
  preparationId: string;
  pointId?: string | null;
  kind: MaterialKind;
  standing: MaterialStanding;
  title: string;
  content: string;
  sources?: ExternalSource[];
  image?: ImageInfo | null;
  assistant?: string | null;
}

// ---------------------------------------------------------------------------
// Assistant
// ---------------------------------------------------------------------------

/** Services on the internet, then on this computer, then any other compatible one (as the core lists them). */
export const PROVIDER_KINDS = ["openai", "anthropic", "google", "xai", "perplexity", "deepseek", "qwen", "mistral", "cohere", "moonshot", "zai", "minimax", "ollama", "lmstudio", "openai_compatible"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export const IMAGE_SERVICES = ["same", "openai"] as const;
export type ImageService = (typeof IMAGE_SERVICES)[number];
export type ImageCapability = "supported" | "unsupported" | "unknown";
export const SEARCH_KINDS = ["none", "brave", "tavily", "exa", "searxng", "serpapi"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export interface AssistantConfig {
  enabled: boolean;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  search: SearchKind;
  searchUrl: string;
  findImages: boolean;
  generateImages: boolean;
  imageModel: string;
  /** Where images are made: the writing service, or OpenAI. */
  imageService: ImageService;
  perspective: string;
}

export interface AssistantSettings {
  config: AssistantConfig;
  hasKey: boolean;
  hasSearchKey: boolean;
  /** Text leaves this computer when the assistant is asked. */
  remote: boolean;
  canGenerateImages: boolean;
  /** Whether the chosen image service can make images. */
  imageCapability: ImageCapability;
  /** A key is kept for the image service. */
  hasImageKey: boolean;
}

export const WORDING_ACTIONS = ["grammar", "clarity", "shorten", "natural", "repetition", "spoken", "audience", "translate", "transition"] as const;
/** Answered as comments; "free" is a request in the person's own words. */
export const REVIEW_ACTIONS = ["review", "structure", "application", "theology", "passages", "free"] as const;
export const OPTION_ACTIONS = ["phrasing", "question", "restructure", "illustration"] as const;
export type AssistAction =
  | (typeof WORDING_ACTIONS)[number]
  | (typeof REVIEW_ACTIONS)[number]
  | (typeof OPTION_ACTIONS)[number]
  | "story"
  | "visual";

export type TeachingPart =
  | "audience"
  | "purpose"
  | "centralMessage"
  | "introduction"
  | "conclusion"
  | "notes"
  | "pointTitle"
  | "pointExplanation"
  | "pointApplication"
  | "pointIllustration"
  | "whole";

export interface AssistInput {
  preparationId: string;
  action: AssistAction;
  part: TeachingPart;
  pointId?: string | null;
  /** Exactly the person's text being worked on (the part, or the selected words). */
  text: string;
  selected?: boolean;
  /** The person's own words about what they want. */
  request?: string;
  audience?: string;
  language?: string;
  uiLanguage?: string;
}

export interface SharedItem {
  kind: "text" | "request" | "teaching" | "nearby" | "passage" | "finding" | "source";
  label: string;
  /** For a passage, so it is named in the interface language. */
  reference: ScriptureRef | null;
}

export interface AssistPreview {
  remote: boolean;
  assistant: string;
  shared: SharedItem[];
  searches: boolean;
}

export interface AssistComment {
  excerpt: string;
  comment: string;
  basis: "scripture" | "study" | "source" | "reasoning";
  passages: ScriptureRef[];
}

export interface Story {
  title: string;
  summary: string;
  standing: "verified" | "unverified";
  sources: ExternalSource[];
}

export interface VisualIdea {
  description: string;
  kind: "photo" | "diagram" | "drawing";
  searchTerms: string;
}

export type AssistResult =
  | { type: "proposal"; suggestion: string; changes: string; placement: "replace" | "start" }
  | { type: "comments"; summary: string; comments: AssistComment[] }
  | { type: "options"; standing: "suggestion" | "hypothetical"; options: { text: string; note: string }[] }
  | { type: "stories"; stories: Story[] }
  | { type: "visuals"; ideas: VisualIdea[] };

export interface AssistReply {
  result: AssistResult;
  assistant: string;
  remote: boolean;
}

export interface FoundImage {
  title: string;
  url: string;
  pageUrl: string;
  thumbUrl: string;
  licence: string;
  licenceUrl: string | null;
  author: string | null;
  attribution: string;
  /** The small picture, fetched by the core (the window loads no remote images). */
  thumbData: string | null;
}

export interface GeneratedImage {
  file: string;
  dataUrl: string;
  assistant: string;
}
