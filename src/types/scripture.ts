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
  message: string;
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

export interface Annotation {
  id: string;
  reference: ScriptureRef;
  translationId: string | null;
  kind: AnnotationKind;
  content: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface CreateAnnotation {
  reference: string;
  kind: AnnotationKind;
  content?: string;
  translationId?: string;
}

export interface StudyPassage {
  id: string;
  studyId: string;
  reference: ScriptureRef;
  createdAt: string;
}
