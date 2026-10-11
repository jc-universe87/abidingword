// TypeScript mirror of the native library types (src-tauri/src/library).
import type { ScriptureRef } from "./scripture";

export const SOURCE_TYPES = ["book", "article", "notes", "sermon", "lecture", "document"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const LICENCE_STATUSES = ["private", "distributable", "unknown"] as const;
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];

export type SourceFormat = "pdf" | "epub" | "docx" | "markdown" | "text";

/** Which in-app viewer shows a source's original file (the format decides). */
export interface OriginalView {
  /** "pdf": drawn from the file's own bytes; "epub" and "docx": pages the core builds (see `EpubItem`). */
  kind: "pdf" | "epub" | "docx";
}

export interface OriginalInfo {
  kind: "pdf";
  sizeBytes: number;
}

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
  /** How the original file can be viewed in the app; null when it cannot. */
  originalView: OriginalView | null;
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

/** Why a source segment is linked to a passage (docs/passage-aware-sources-v0.9.md). */
export type PassageLinkOrigin = "explicit" | "section" | "inherited" | "manual";

/** How a link relates to the passage being read, best first. */
export type PassageMatchKind = "exact" | "contained" | "overlap";

/** One place in a source that fits the passage being read. */
export interface PassageLocation {
  segmentId: string;
  locator: string;
  /** "explicit" (mentions it), "section" (a heading names it) or "manual". */
  origin: PassageLinkOrigin;
  matchKind: PassageMatchKind;
  /** The passage the source links this place to. */
  reference: ScriptureRef;
  /** The reference as written in the source (the heading, for a section). */
  matchedText: string;
  sectionHeading: string | null;
}

/** A source with the places in it that fit the passage being read, best first. */
export interface PassageSourceGroup {
  sourceId: string;
  sourceTitle: string;
  author: string | null;
  locations: PassageLocation[];
  /** How many further places the source has. */
  moreLocations: number;
}

/** Why one segment is linked to Scripture (what it mentions; the section it opens or lies within). */
export interface SegmentPassageLink {
  origin: PassageLinkOrigin;
  reference: ScriptureRef;
  matchedText: string;
  sectionHeading: string | null;
  sectionSegmentId: string | null;
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
  /** English; shown through `problemCode` in the interface language. */
  problem: string | null;
  problemCode: string | null;
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

/**
 * A place a contents entry leads to: a physical PDF page, or (EPUB) the
 * position of a segment of the extracted text. Always internal to the source.
 */
export type ContentsTarget = { kind: "page"; page: number } | { kind: "segment"; position: number };

/** One entry of a source's own table of contents. Never generated. */
export interface ContentsItem {
  /** Stable within one source's contents. */
  id: string;
  title: string;
  /** None for a heading that only groups its children. */
  target: ContentsTarget | null;
  children: ContentsItem[];
}

/**
 * A link inside a source's extracted text that leads elsewhere in the same
 * source: the segment it is in (`position`), the range of that segment's text
 * it covers (UTF-16 units) and the segment it leads to. Internal links only.
 */
/** A Scripture reference written in a segment's text, and where (UTF-16 offsets, end exclusive). v0.11. */
export interface SourceReference {
  position: number;
  start: number;
  end: number;
  reference: ScriptureRef;
}

/** One place a "Find in this source" query occurs (v0.13): UTF-16 offsets into the segment's text. */
export interface SourceMatch {
  position: number;
  pageNumber: number | null;
  start: number;
  end: number;
}

/** Where a query occurs in one source, in reading order; `truncated` when more exist than were counted or returned. */
export interface SourceFind {
  matches: SourceMatch[];
  total: number;
  truncated: boolean;
}

export interface SourceLink {
  position: number;
  start: number;
  end: number;
  target: number;
}

/**
 * Where one reading-order document of an EPUB starts among the extracted text,
 * and which segment each of its element ids falls in: how Reading and
 * Original find the same place in a book. `id` is the only name the interface
 * uses for a document.
 */
export interface EpubStructureItem {
  id: string;
  startSegment: number;
  segmentCount: number;
  anchors: Record<string, number>;
}

/** An element of a formatted EPUB page, as the core allows it (see `epubDocument.tsx`). Text is a plain string. */
export type EpubNode = string | EpubElement;

export interface EpubElement {
  /** The tag. */
  t: string;
  /** Allowed attributes. */
  a?: Record<string, string>;
  /** Children. */
  c?: EpubNode[];
  /** A link to another place in the same book. */
  l?: { item: string; id?: string };
  /** A link to the web: an address the core has already checked (http or https). Opened only on a click. */
  x?: string;
}

/** One reading-order document of an EPUB, sanitised by the core. */
export interface EpubItem {
  id: string;
  nodes: EpubNode[];
  /** The document's own style, already reduced to what is safe. */
  css: string;
  /** What the `<body>` carried (class, id, style). */
  root: Record<string, string>;
  missingImages: number;
}
