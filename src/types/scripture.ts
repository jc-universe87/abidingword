// TypeScript mirror of the native Scripture types (src-tauri/src/scripture).
// Keep both sides in step when a field changes.

/** A validated passage. `canonical` is the identity; the rest describes it. */
export interface ScriptureRef {
  canonical: string;
  display: string;
  book: string;
  startChapter: number;
  startVerse: number | null;
  endChapter: number;
  endVerse: number | null;
}

export interface BookInfo {
  ordinal: number;
  code: string;
  name: string;
  testament: "OT" | "NT";
  chapterCount: number;
}

/** A language a Bible can be marked as (one of the 100 reference languages). */
export interface BibleLanguageOption {
  code: string;
  /** English name. */
  name: string;
  /** The name in the language itself, when known. */
  native: string | null;
}

export interface BibleTranslation {
  id: string;
  name: string;
  shortName: string;
  language: string;
  languageCode: string | null;
  publisher: string | null;
  copyrightNotice: string | null;
  licenseType: string | null;
  /** "structured" (readable by passage) or "document" (not yet mapped). */
  kind: "structured" | "document";
  sourceType: string;
  /** "bundled" (shipped with the app) or "managed_copy" (the user's file, copied in). */
  sourceOrigin: "bundled" | "managed_copy";
  sourcePath: string | null;
  originalFileName: string | null;
  importStatus: "ready" | "document_only";
  isBuiltin: boolean;
  bookCount: number;
  verseCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BundledBibleInfo {
  id: string;
  name: string;
  shortName: string;
  language: string;
  /** e.g. "de": the interface language's Bibles are offered first. */
  languageCode: string;
  licenseType: string;
  installed: boolean;
}

export interface VerseText {
  canonical: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface ChapterText {
  translationId: string;
  book: string;
  bookName: string;
  chapter: number;
  chapterCount: number;
  superscription: string | null;
  verses: VerseText[];
}

export interface PassageText {
  translationId: string;
  reference: ScriptureRef;
  verses: VerseText[];
}

export interface SearchScripture {
  query: string;
  translationId?: string;
  book?: string;
}

export interface SearchHit {
  reference: ScriptureRef;
  translationId: string;
  translationShortName: string;
  text: string;
}

export interface SearchResults {
  hits: SearchHit[];
  truncated: boolean;
}

/** Concordance (v0.12): a word, or words together. */
export type ConcordanceMode = "word" | "phrase";

export interface ConcordanceQuery {
  translationId: string;
  query: string;
  mode: ConcordanceMode;
  /** Only this book's verses (the counts stay for the whole Bible). */
  book?: string;
}

export interface ConcordanceHit {
  reference: ScriptureRef;
  text: string;
  /** Where the query is in `text` (UTF-16 offsets, end exclusive). */
  matches: [number, number][];
}

export interface ConcordanceBook {
  code: string;
  name: string;
  verses: number;
  occurrences: number;
}

export interface ConcordanceResult {
  query: string;
  mode: ConcordanceMode;
  translationId: string;
  verses: number;
  occurrences: number;
  books: ConcordanceBook[];
  /** Every matching verse when there are few (or the book asked for); otherwise empty. */
  hits: ConcordanceHit[];
  hitsComplete: boolean;
}

export interface DetectedReference {
  text: string;
  /** UTF-16 offsets, as JavaScript string indexes. */
  start: number;
  end: number;
  reference: ScriptureRef;
}

export type IssueSeverity = "error" | "warning" | "note";

export interface ImportIssue {
  severity: IssueSeverity;
  book: string | null;
  chapter: number | null;
  /** English; shown through `code` in the interface language (docs/i18n.md). */
  message: string;
  code: string | null;
  params: Record<string, string>;
}

export interface PreviewBook {
  code: string;
  name: string;
  chapters: number;
  verses: number;
  status: "ok" | "warning" | "error";
}

export interface SuggestedMetadata {
  name: string;
  shortName: string;
  language: string;
  languageCode: string;
  publisher: string | null;
  copyrightNotice: string | null;
  licenseType: string | null;
}

export interface ImportPreview {
  previewId: string;
  format: string;
  bundled: boolean;
  suggested: SuggestedMetadata;
  bookCount: number;
  chapterCount: number;
  verseCount: number;
  books: PreviewBook[];
  issues: ImportIssue[];
  skippedFiles: string[];
  canImport: boolean;
}

export interface ImportRequest {
  paths?: string[];
  bundled?: string;
}

export interface CommitImport {
  previewId: string;
  name: string;
  shortName: string;
  language: string;
  languageCode?: string;
  publisher?: string;
  copyrightNotice?: string;
  licenseType?: string;
}

export type AnnotationKind = "note" | "highlight" | "bookmark";

/** Visual names only; no meaning is attached to a colour. */
export const HIGHLIGHT_COLORS = ["amber", "green", "blue", "rose", "grey"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** One end of a phrase anchor: a canonical verse and a UTF-16 offset into its text. */
export interface AnchorEnd {
  verse: string;
  offset: number;
}

/** A phrase highlight's or phrase note's tie to exact wording. */
export interface AnnotationAnchor {
  start: AnchorEnd;
  /** Exclusive. */
  end: AnchorEnd;
  quote: string;
  /** Short name of the translation it was marked in (a snapshot). */
  translationShortName: string;
  /** True when the translation asked about has exactly this wording. */
  shown: boolean;
}

export interface Annotation {
  id: string;
  reference: ScriptureRef;
  translationId: string | null;
  kind: AnnotationKind;
  content: string;
  /** Highlights only. */
  color: HighlightColor | null;
  /** Phrase highlights and phrase notes only. */
  anchor: AnnotationAnchor | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

/** A phrase selection in one translation, checked by the core. */
export interface AnchorInput {
  translationId: string;
  start: AnchorEnd;
  end: AnchorEnd;
  quote: string;
}

export interface CreateAnnotation {
  reference: string;
  kind: AnnotationKind;
  content?: string;
  translationId?: string;
  color?: HighlightColor;
  anchor?: AnchorInput;
}

export interface UpdateAnnotation {
  id: string;
  content?: string;
  color?: HighlightColor;
}

export interface StudyPassage {
  id: string;
  studyId: string;
  reference: ScriptureRef;
  role: "primary" | "related";
  createdAt: string;
}

/** What the Marks view asks for. All of it optional; nothing set means every mark in Scripture order. */
export interface MarksQuery {
  kind?: AnnotationKind;
  /** A canonical book code, e.g. `JHN`. */
  book?: string;
  color?: HighlightColor;
  /** Words to look for in note text. */
  query?: string;
  /** The translation shown, so phrase marks can say whether they fit it. */
  translationId?: string;
  limit?: number;
  offset?: number;
}

export interface MarksPage {
  marks: Annotation[];
  offset: number;
  hasMore: boolean;
}

/** The text of a material's passages from one Bible (v0.18.8): only that Bible, with what it lacks named. */
export interface MaterialPassage {
  canonical: string;
  verses: VerseText[];
  /** "chapter:verse" of each verse the Bible has no text for. */
  missing: string[];
}

export interface MaterialScripture {
  translationId: string;
  name: string;
  shortName: string;
  copyrightNotice: string | null;
  passages: MaterialPassage[];
}
