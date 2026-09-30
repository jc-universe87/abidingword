// TypeScript mirror of the native library types (src-tauri/src/library).
import type { ScriptureRef } from "./scripture";

export const SOURCE_TYPES = ["book", "article", "notes", "sermon", "lecture", "document"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const LICENCE_STATUSES = ["private", "distributable", "unknown"] as const;
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];

export type SourceFormat = "pdf" | "epub" | "markdown" | "text";

export interface Source {
  id: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  publisher: string | null;
  edition: string | null;
  publicationYear: number | null;
  isbn: string | null;
  doi: string | null;
  language: string | null;
  sourceType: SourceType;
  licenceStatus: LicenceStatus;
  licence: string | null;
  notes: string | null;
  format: SourceFormat | null;
  originalFilename: string | null;
  extractionStatus: string | null;
  pageCount: number | null;
  segmentCount: number;
  passageCount: number;
  contentHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceSummary {
  id: string;
  title: string;
  author: string | null;
  sourceType: SourceType;
  format: SourceFormat | null;
  language: string | null;
  createdAt: string;
}

export interface SourceSegment {
  id: string;
  position: number;
  text: string;
  pageNumber: number | null;
  pageLabel: string | null;
  chapter: string | null;
  heading: string | null;
  sectionPath: string | null;
  paragraphIndex: number | null;
  locator: string;
}

export interface SegmentWindow {
  sourceId: string;
  total: number;
  offset: number;
  segments: SourceSegment[];
  targetSegmentId: string | null;
}

export interface LibraryHit {
  sourceId: string;
  sourceTitle: string;
  author: string | null;
  segmentId: string;
  position: number;
  pageNumber: number | null;
  locator: string;
  /** Matches wrapped in U+0002 … U+0003. */
  snippet: string;
}

export interface LibraryResults {
  hits: LibraryHit[];
  offset: number;
  hasMore: boolean;
}

export interface PassageMention {
  sourceId: string;
  sourceTitle: string;
  author: string | null;
  segmentId: string;
  locator: string;
  matchedText: string;
  reference: ScriptureRef;
}

export interface SourceImportPreview {
  previewId: string;
  fileName: string;
  format: SourceFormat;
  suggestedTitle: string;
  suggestedAuthor: string | null;
  suggestedLanguage: string | null;
  suggestedPublisher: string | null;
  suggestedIsbn: string | null;
  suggestedType: SourceType;
  pageCount: number | null;
  chapterCount: number | null;
  segmentCount: number;
  referenceCount: number;
  extractionStatus: string;
  problem: string | null;
  duplicateOf: { id: string; title: string } | null;
  canImport: boolean;
}

export interface CommitSourceImport {
  previewId: string;
  title: string;
  author?: string;
  language?: string;
  publisher?: string;
  isbn?: string;
  sourceType?: SourceType;
  licenceStatus?: LicenceStatus;
  allowDuplicate?: boolean;
}

export interface FindingCitation {
  id: string;
  findingId: string;
  sourceId: string;
  segmentId: string | null;
  title: string;
  author: string | null;
  locator: string | null;
  removed: boolean;
}
