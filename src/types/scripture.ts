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
  /** Word annotations from the Bible's own markup (v0.21); absent when it has none. */
  words?: WordAnnotations | null;
}

/** What a Bible's own word markup gives (v0.21). */
export interface WordAnnotations {
  wordCount: number;
  verseCount: number;
  lemmas: boolean;
  lexicalIds: boolean;
  morphology: boolean;
  /** A documented scheme (described), "raw" (shown as written) or "none". */
  morphScheme: MorphScheme;
  morphAttribute: string | null;
  sourceFormat: string;
  /** Why the codes are described (v0.22): the edition names the scheme, or the person chose it. */
  grammarBasis?: "edition" | "person" | null;
  /** Where the edition names it. */
  grammarEvidence?: GrammarStatement | null;
}

/** The documented grammar-code schemes Abiding Word can describe (v0.22). */
export type GrammarScheme = "oshb" | "robinson" | "morphgnt";
export type MorphScheme = GrammarScheme | "raw" | "none";

/** Where an edition names its grammar scheme: the file and the words found. */
export interface GrammarStatement {
  file: string;
  words: string;
}

/** Which scheme a Bible's codes fit, and whether the edition says so (v0.22). */
export interface GrammarFinding {
  scheme: GrammarScheme | null;
  coded: number;
  described: number;
  stated: GrammarStatement | null;
}

/** What the person chose for a Bible's words when adding it (v0.22). */
export interface WordChoice {
  /** Index words that carry only lexical numbers. */
  numbers?: boolean;
  /** Describe the codes with this scheme, which they fit. */
  grammar?: GrammarScheme | null;
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

/** A lemma with the lexical identifiers given with it (homographs are separate entries). */
export interface LemmaEntry {
  lemma: string | null;
  strong: string | null;
  occurrences: number;
  forms: string[];
  /** The lexical number the typed text matched, as stored ("H0430" for "H430"; v0.22). */
  matchedId?: string | null;
}

export interface LemmaLookup {
  translationId: string;
  text: string;
}

export type LemmaSelection =
  | { kind: "entry"; lemma: string | null; strong: string | null }
  | { kind: "lemma"; lemma: string }
  | { kind: "lexicalId"; id: string };

export interface LemmaQuery {
  translationId: string;
  selection: LemmaSelection;
  /** Only words with one of these morphology codes, exactly as written. */
  morph?: string[];
  book?: string;
}

/** A grammatical property; `field` and `value` are keys the interface translates. */
export interface MorphFeature {
  field: string;
  value: string;
}

export interface MorphSegment {
  partOfSpeech: string;
  features: MorphFeature[];
}

export interface MorphDescribed {
  scheme: GrammarScheme;
  language: "hebrew" | "aramaic" | "greek";
  segments: MorphSegment[];
}

export interface LemmaResult {
  selection: LemmaSelection;
  translationId: string;
  occurrences: number;
  verses: number;
  books: ConcordanceBook[];
  hits: ConcordanceHit[];
  hitsComplete: boolean;
  forms: { form: string; count: number }[];
  morphology: { code: string; count: number; described: MorphDescribed | null }[];
  withoutMorphology: number;
  morphScheme: MorphScheme;
  morphAttribute: string | null;
}

/** One annotated word of a verse. */
export interface VerseWord {
  position: number;
  /** UTF-16 offsets into the verse text, end exclusive. */
  start: number;
  end: number;
  surface: string;
  shape: "word" | "phrase" | "part";
  lemma: string | null;
  strong: string | null;
  lexicalIds: string[];
  morph: string | null;
  described: MorphDescribed | null;
  entryOccurrences: number;
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
  /** What the Bible's word markup gives (v0.21). */
  words?: WordReport;
  /** For documents (PDF, EPUB, Word, Markdown, text; v0.23): what was found in them. */
  document?: DocumentPreview | null;
}

/** Where something is in a Bible's documents (v0.23). */
export interface DocumentPlace {
  /** Which document (0 = the first). */
  document: number;
  page: number | null;
  /** The paragraph (segment position) it lies in. */
  segment: number | null;
}

/** A book heading found in a document, as the review lists it (v0.23). */
export interface FoundBook {
  index: number;
  heading: string;
  /** The book the heading names, if it names one. */
  detected: string | null;
  /** The book used (detected or chosen); null when none or left out. */
  book: string | null;
  leftOut: boolean;
  chapters: number;
  verses: number;
  place: DocumentPlace;
}

/** Text left out of the verses (v0.23). */
export interface LeftOutText {
  sample: string;
  chars: number;
  place: DocumentPlace;
  reason: "heading" | "beforeVerses" | "noBook" | "notes" | "leftOutBook";
}

export interface DocumentStats {
  pageLines: number;
  headings: number;
  leftOutChars: number;
  psalmTitles: number;
  unnumberedFirst: number;
  numberedChapters: number;
}

export interface DocumentFileInfo {
  name: string;
  format: "pdf" | "epub" | "docx" | "markdown" | "text";
  pages: number | null;
  textChars: number;
  /** No text layer (scanned pages): readable page by page only. */
  scanned: boolean;
  /** Its layout is kept and shown (PDF pages, EPUB and Word formatting). */
  keepsLayout: boolean;
  notes: number;
}

export interface DocumentPreview {
  files: DocumentFileInfo[];
  books: FoundBook[];
  leftOut: LeftOutText[];
  stats: DocumentStats;
  /** Verses were found and nothing contradicts itself. */
  versesUsable: boolean;
  textChars: number;
}

/** One of the documents a Bible was added from (v0.23). */
export interface BibleDocument {
  id: string;
  position: number;
  format: DocumentFileInfo["format"];
  /** The file's name as the person had it. */
  name: string;
  pageCount: number | null;
  extractionStatus: "digital_text" | "extracted_text" | "ocr_required";
  segmentCount: number;
  /** How the original is shown: its layout ("pdf", "epub", "docx"), or its text (null). */
  view: "pdf" | "epub" | "docx" | null;
}

export interface DocumentSegment {
  position: number;
  text: string;
  pageNumber: number | null;
  sectionPath: string | null;
}

export interface DocumentWindow {
  total: number;
  offset: number;
  segments: DocumentSegment[];
}

export interface DocumentHit {
  documentId: string;
  position: number;
  pageNumber: number | null;
  sectionPath: string | null;
  text: string;
}

/** Where a verse of a Bible added from documents came from (v0.23). */
export interface VerseOrigin {
  documentId: string;
  documentName: string;
  firstSegment: number | null;
  lastSegment: number | null;
  firstPage: number | null;
  lastPage: number | null;
}

/** The import preview's summary of word annotations (v0.21). */
export interface WordReport {
  marked: number;
  words: number;
  verses: number;
  withLemma: number;
  withLexicalId: number;
  withMorphology: number;
  distinctLemmas: number;
  phrases: number;
  parts: number;
  morphAttribute: string | null;
  /** Which documented scheme the codes fit, and whether the edition says so (v0.22). */
  grammar: GrammarFinding;
  otherAttributes: string[];
  leftOut: {
    syntax: number;
    conflict: number;
    tooLong: number;
    unbalanced: number;
    overlapping: number;
    outsideVerse: number;
    empty: number;
    tooMany: number;
  };
  indexed: boolean;
  notIndexed: "strongOnly" | "unreliable" | "unreadable" | "tooLarge" | null;
  /** About how much the word index takes on disk (bytes). */
  estimatedBytes: number;
}

/** Reading an installed Bible's kept files again for its words (v0.22). */
export interface WordsPreview {
  previewId: string;
  translationId: string;
  format: string;
  words: WordReport;
  current: WordAnnotations | null;
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
  /** What to do with the Bible's words (v0.22). */
  words?: WordChoice;
  /** A Bible from documents is added to read as a document, even with verses found (v0.23). */
  asDocument?: boolean;
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
  /** In order; a bridge ("25–27") is one verse with its last; a psalm's title comes on its first verse. */
  verses: (VerseText & { bridgeEnd?: number; title?: string })[];
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
