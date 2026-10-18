// Presentation & Delivery (v0.18). Mirrors src-tauri/src/domain/presentation.rs
// and src-tauri/src/presentation/document.rs; keep the two in step.

export const PRESENTATION_THEMES = ["light", "dark", "warm"] as const;
export type PresentationTheme = (typeof PRESENTATION_THEMES)[number];

/** Teaching-focused kinds of slide (not a general slide designer). */
export const ITEM_KINDS = ["title", "section", "heading", "text", "scripture", "image", "quote", "question", "activity", "pause"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export type SourceKind = "preparation" | "point" | "passage" | "material" | "finding";
export type PreparationField = "title" | "central_message" | "introduction" | "conclusion";

export interface ItemSource {
  kind: SourceKind;
  id: string;
  /** For `preparation`: which of its fields. */
  field: PreparationField | null;
}

export interface PresentationSummary {
  id: string;
  preparationId: string;
  title: string;
  theme: PresentationTheme;
  updatedAt: string;
}

export interface PresentationItem {
  id: string;
  position: number;
  kind: ItemKind;
  /** null: a slide of the presentation's own. */
  source: ItemSource | null;
  /** The person's own heading; null follows the teaching. */
  heading: string | null;
  /** The person's own audience text; null follows the teaching. */
  body: string | null;
  /** Canonical reference; null follows the source passage. */
  reference: string | null;
  /** Speaker-only notes. Never shown to the audience. */
  notes: string;
  /** Left out of this presentation (kept to be brought back). */
  skipped: boolean;
}

export interface Presentation {
  id: string;
  preparationId: string;
  title: string;
  theme: PresentationTheme;
  translationId: string | null;
  /** An optional target time in minutes, for quiet guidance while presenting. */
  targetMinutes: number | null;
  items: PresentationItem[];
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface UpdatePresentationItem {
  id: string;
  kind?: ItemKind;
  heading?: string;
  followHeading?: boolean;
  body?: string;
  followBody?: boolean;
  reference?: string;
  followReference?: boolean;
  notes?: string;
  skipped?: boolean;
}

export interface CreatePresentationItem {
  presentationId: string;
  kind: ItemKind;
  source?: ItemSource | null;
  heading?: string | null;
  body?: string | null;
  reference?: string | null;
  afterItemId?: string | null;
}

// --- The document: one pipeline for every output ---------------------------

export interface RefInfo {
  canonical: string;
  book: string;
  startChapter: number;
  startVerse: number | null;
  endChapter: number;
  endVerse: number | null;
}

export interface SlideVerse {
  chapter: number;
  verse: number;
  text: string;
}

export interface SlideImage {
  assetId: string;
  caption: string | null;
  credit: string | null;
  generated: boolean;
}

/** What the audience sees. Nothing else is ever shown to them. */
export interface AudienceSlide {
  heading: string | null;
  body: string | null;
  reference: RefInfo | null;
  verses: SlideVerse[];
  bible: string | null;
  image: SlideImage | null;
  blank: boolean;
}

export type ManuscriptField = "introduction" | "conclusion" | "explanation" | "application" | "illustration" | "standing";

export interface SpeakerSlide {
  manuscript: { field: ManuscriptField; text: string }[];
  notes: string;
}

export interface Citation {
  kind: "source" | "image" | "bible";
  title: string;
  url: string | null;
  detail: string | null;
}

export interface Slide {
  id: string;
  itemId: string;
  index: number;
  part: number;
  parts: number;
  kind: ItemKind;
  audience: AudienceSlide;
  speaker: SpeakerSlide;
  citations: Citation[];
  source: ItemSource | null;
  sourceMissing: boolean;
}

export interface ImageAsset {
  id: string;
  mediaType: string | null;
  width: number | null;
  height: number | null;
  available: boolean;
  sha256: string | null;
}

export type WarningCode = "scriptureUnavailable" | "imageUnavailable" | "sourceMissing" | "longText" | "noBible";

export interface PresentationDocument {
  format: string;
  schemaVersion: number;
  presentationId: string;
  teachingId: string;
  title: string;
  teachingKind: string | null;
  theme: PresentationTheme;
  targetMinutes?: number | null;
  primaryPassage: RefInfo | null;
  bible: { id: string; name: string; shortName: string; copyright: string | null } | null;
  presentationUpdatedAt: string;
  teachingUpdatedAt: string;
  slides: Slide[];
  images: ImageAsset[];
  warnings: { slideId: string | null; code: WarningCode }[];
}

/** The audience screen's document: no speaker text, notes or citations at all. */
export interface AudienceDocument {
  format: string;
  schemaVersion: number;
  presentationId: string;
  title: string;
  theme: PresentationTheme;
  slides: { id: string; index: number; kind: ItemKind; audience: AudienceSlide }[];
  images: ImageAsset[];
}

/** A passage shown on the audience screen over the slide. */
export interface ScriptureOverlay {
  label: string;
  bible: string | null;
  verses: SlideVerse[];
}

/** A point on a slide, from 0 to 1 across and down. */
export type SlidePoint = [number, number];

/** The speaker's pointer and pen on the slide: for this moment only, never stored. */
export interface LiveMarks {
  pointer: SlidePoint | null;
  strokes: SlidePoint[][];
}

export const NO_MARKS: LiveMarks = { pointer: null, strokes: [] };

/** What the audience screen shows now. */
export interface AudienceState {
  presentationId: string;
  index: number;
  blank: boolean;
  scripture: ScriptureOverlay | null;
  marks?: LiveMarks;
}

export interface Screen {
  index: number;
  name: string;
  width: number;
  height: number;
  primary: boolean;
}

export const EXPORT_FORMATS = ["pptx", "pdf", "speaker_pdf", "markdown", "package"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportLabels {
  slide: string;
  speakerNotes: string;
  introduction: string;
  conclusion: string;
  explanation: string;
  application: string;
  illustration: string;
  standing: string;
  citations: string;
  generatedImage: string;
  imageUnavailable: string;
  scriptureUnavailable: string;
  pause: string;
  next: string;
  standings: Record<string, string>;
}

export interface ExportLocale {
  language: string;
  bookNames: Record<string, string>;
  psalm: string;
  verseSeparator: string;
  labels: ExportLabels;
}

export interface ExportOptions {
  speakerNotes: boolean;
  citations: boolean;
  locale: ExportLocale;
}

export interface ExportResult {
  path: string;
  slides: number;
  missingImages: number;
}
