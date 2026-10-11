// The frontend's only door to the native core. Components use the `Api`
// interface through `useApi()`, never `invoke` directly, so tests can supply
// an in-memory implementation.
import { localizeError } from "@/i18n/messages";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { safeExternalUrl } from "./externalLink";
import type {
  AppInfo,
  AppSettings,
  CreateProject,
  CreateStudy,
  CreateStudyBlock,
  ErrorPayload,
  ErrorKind,
  Project,
  Study,
  StudyBlock,
  StudyDetail,
  StudySection,
  UpdateProject,
  UpdateSettings,
  UpdateStudy,
  UpdateStudyBlock,
  UpdateStudySection,
  Workspace,
} from "@/types/domain";
import type {
  AnchorInput,
  Annotation,
  AnnotationAnchor,
  BibleTranslation,
  BookInfo,
  BundledBibleInfo,
  ChapterText,
  CommitImport,
  ConcordanceQuery,
  ConcordanceResult,
  CreateAnnotation,
  MarksPage,
  MarksQuery,
  DetectedReference,
  ImportPreview,
  ImportRequest,
  PassageText,
  ScriptureRef,
  SearchResults,
  SearchScripture,
  StudyPassage,
  UpdateAnnotation,
} from "@/types/scripture";
import type {
  CreateFinding,
  Finding,
  ListStudies,
  PassageRole,
  RelationType,
  Reorder,
  StudyRelation,
  StudySearchHit,
  StudySummary,
  StudyTemplate,
  TemplateInput,
  UpdateFinding,
} from "@/types/studies";
import type {
  CommitSourceImport,
  LibraryResults,
  ContentsItem,
  EpubItem,
  EpubStructureItem,
  SourceLink,
  DrawnScope,
  SourceFind,
  SourceReference,
  OriginalInfo,
  PassageMention,
  PassageLocation,
  PassageSourceGroup,
  SegmentPassageLink,
  SegmentWindow,
  Source,
  SourceImportPreview,
  SourceSummary,
  SourceType,
} from "@/types/library";

export interface Api {
  appInfo(): Promise<AppInfo>;
  logError(message: string): Promise<void>;
  workspaceGetDefault(): Promise<Workspace>;
  projectList(workspaceId: string): Promise<Project[]>;
  projectGet(id: string): Promise<Project>;
  projectCreate(input: CreateProject): Promise<Project>;
  projectUpdate(input: UpdateProject): Promise<Project>;
  studyList(filter: ListStudies): Promise<StudySummary[]>;
  studyDuplicate(input: { studyId: string; includeContent: boolean }): Promise<StudyDetail>;
  studySearch(query: string): Promise<StudySearchHit[]>;
  studyGet(id: string): Promise<StudyDetail>;
  studyCreate(input: CreateStudy): Promise<StudyDetail>;
  studyUpdate(input: UpdateStudy): Promise<Study>;
  studySectionList(studyId: string): Promise<StudySection[]>;
  studySectionUpdate(input: UpdateStudySection): Promise<StudySection>;
  studySectionCreate(input: { studyId: string; title: string; guidance?: string }): Promise<StudySection>;
  studySectionDelete(input: { id: string; force: boolean }): Promise<void>;
  studySectionReorder(input: Reorder): Promise<StudySection[]>;
  studyBlockReorder(input: Reorder): Promise<StudyBlock[]>;

  findingList(studyId: string): Promise<Finding[]>;
  findingCreate(input: CreateFinding): Promise<Finding>;
  findingUpdate(input: UpdateFinding): Promise<Finding>;
  findingDelete(id: string): Promise<void>;
  findingReorder(input: Reorder): Promise<Finding[]>;
  findingLinkPassage(input: { findingId: string; reference: string }): Promise<Finding>;
  findingUnlinkPassage(passageId: string): Promise<Finding>;
  findingSetTags(input: { findingId: string; tags: string[] }): Promise<Finding>;

  studyRelationList(studyId: string): Promise<StudyRelation[]>;
  studyRelationCreate(input: { fromStudyId: string; toStudyId: string; relationType: RelationType; note?: string }): Promise<StudyRelation>;
  studyRelationDelete(id: string): Promise<void>;

  templateList(): Promise<StudyTemplate[]>;
  templateCreate(input: TemplateInput): Promise<StudyTemplate>;
  templateUpdate(input: TemplateInput & { id: string }): Promise<StudyTemplate>;
  templateDuplicate(id: string): Promise<StudyTemplate>;
  templateDelete(id: string): Promise<void>;

  libraryList(filter: { sourceType?: SourceType; language?: string }): Promise<SourceSummary[]>;
  libraryLanguages(): Promise<string[]>;
  libraryGetSource(id: string): Promise<Source>;
  /** Opens the system file dialog for one library file; null when cancelled. */
  chooseSourceFile(): Promise<string | null>;
  libraryImportPreview(path: string): Promise<SourceImportPreview>;
  libraryImportCommit(input: CommitSourceImport): Promise<Source>;
  libraryImportCancel(previewId: string): Promise<void>;
  libraryRemoveSource(id: string): Promise<void>;
  librarySearch(input: { query: string; offset?: number }): Promise<LibraryResults>;
  libraryOpenSegment(segmentId: string): Promise<SegmentWindow>;
  sourceGetSegments(input: { sourceId: string; offset?: number; limit?: number; aroundPage?: number }): Promise<SegmentWindow>;
  /** Size and kind of a source's original file, found by source id only. */
  /** The contents an EPUB carries (or the headings of a DOCX), as segment targets (a PDF's outline comes from the PDF engine). */
  librarySourceContents(id: string): Promise<ContentsItem[]>;
  /** Contents made from the source's own headings, for a source that carries none (shown as generated). */
  libraryGeneratedContents(id: string): Promise<ContentsItem[]>;
  /** The links in an EPUB's text that lead elsewhere in the same book (none for other formats). */
  librarySourceLinks(id: string): Promise<SourceLink[]>;
  /** The Scripture references written in a source's text, with their places (stored index). */
  librarySourceReferences(id: string): Promise<SourceReference[]>;
  /** The Scripture references in pieces of a source's drawn text, read in the source's language. */
  /**
   * The Scripture references in pieces of a source's drawn text, read in the source's language. With a
   * `scope` (the formatted document's segments, or a PDF page), bookless references such as "15:4" are
   * linked where the imported text of that part resolved them, and only there.
   */
  libraryDetectReferences(id: string, texts: string[], scope?: DrawnScope): Promise<DetectedReference[][]>;
  /** Where a query occurs in one source's text (case, accents and spacing ignored), in reading order. */
  librarySourceFind(id: string, query: string): Promise<SourceFind>;
  /** For an EPUB's formatted view: where each reading-order document starts among the extracted text. */
  libraryEpubStructure(id: string): Promise<EpubStructureItem[]>;
  /** One reading-order document of an EPUB, sanitised by the core. */
  libraryEpubItem(id: string, item: string): Promise<EpubItem>;
  /** For a DOCX's formatted view: where each part starts among the extracted text (same shape as an EPUB's). */
  libraryDocxStructure(id: string): Promise<EpubStructureItem[]>;
  /** One part of a DOCX, sanitised by the core into the same tree as an EPUB document. */
  libraryDocxItem(id: string, item: string): Promise<EpubItem>;
  /** Opens an http(s) address in the system's default browser. Only for an explicit click; anything else is refused. */
  openExternalLink(url: string): Promise<void>;
  libraryOriginalInfo(id: string): Promise<OriginalInfo>;
  /** A bounded range of a source's original file (never the whole file). */
  libraryOriginalRead(id: string, offset: number, length: number): Promise<Uint8Array>;
  sourceGetPassages(sourceId: string): Promise<PassageMention[]>;
  /** The sources that fit a passage (canonical reference), best first, each with its best places. */
  libraryPassageSources(reference: string): Promise<PassageSourceGroup[]>;
  /** Every place in one source that fits the passage, in the pane's order (bounded). */
  libraryPassageSourceLocations(sourceId: string, reference: string): Promise<PassageLocation[]>;
  /** Why a segment is linked to Scripture: what it mentions and the section it belongs to. */
  sourceSegmentPassageLinks(segmentId: string): Promise<SegmentPassageLink[]>;
  findingSourceAdd(input: { findingId: string; segmentId: string }): Promise<Finding>;
  findingSourceRemove(citationId: string): Promise<Finding>;
  studyBlockCreate(input: CreateStudyBlock): Promise<StudyBlock>;
  studyBlockUpdate(input: UpdateStudyBlock): Promise<StudyBlock>;
  studyBlockDelete(id: string): Promise<void>;
  settingsGet(): Promise<AppSettings>;
  settingsUpdate(input: UpdateSettings): Promise<AppSettings>;

  scriptureBooks(): Promise<BookInfo[]>;
  scriptureGetChapter(input: { translationId: string; book: string; chapter: number }): Promise<ChapterText>;
  scriptureGetPassage(input: { translationId: string; reference: string }): Promise<PassageText>;
  scriptureSearch(input: SearchScripture): Promise<SearchResults>;
  /** Where a word or phrase occurs in one translation (v0.12). */
  scriptureConcordance(input: ConcordanceQuery): Promise<ConcordanceResult>;
  referenceParse(text: string): Promise<ScriptureRef>;
  referenceDetect(text: string): Promise<DetectedReference[]>;

  bibleList(): Promise<BibleTranslation[]>;
  bibleBundledList(): Promise<BundledBibleInfo[]>;
  /** Opens the system file dialog; null when the user cancels. */
  chooseBibleFiles(): Promise<string[] | null>;
  bibleImportPreview(input: ImportRequest): Promise<ImportPreview>;
  bibleImportCommit(input: CommitImport): Promise<BibleTranslation>;
  bibleImportCancel(previewId: string): Promise<void>;
  bibleRemove(id: string): Promise<void>;

  /** With a translation, phrase anchors report whether its wording matches. */
  annotationList(reference: string, translationId?: string): Promise<Annotation[]>;
  /** A page of the user's marks in Scripture order, for the Marks view. */
  annotationMarksList(query: MarksQuery): Promise<MarksPage>;
  annotationCreate(input: CreateAnnotation): Promise<Annotation>;
  annotationUpdate(input: UpdateAnnotation): Promise<Annotation>;
  annotationDelete(id: string): Promise<void>;
  /** Checks a phrase selection against the stored text without saving it. */
  annotationAnchorCheck(input: AnchorInput): Promise<AnnotationAnchor>;

  studyPassageList(studyId: string): Promise<StudyPassage[]>;
  studyPassageAdd(input: { studyId: string; reference: string; role?: PassageRole }): Promise<StudyPassage>;
  studyPassageRemove(id: string): Promise<void>;
  studyPassageSetRole(input: { id: string; role: PassageRole }): Promise<StudyPassage>;
}

/** An error with a message that is safe to show to the user. */
export class ApiError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
  }
}

/**
 * The error as the user should see it: the core's payload (kind, message
 * code, values) becomes a message in the interface language.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const payload = error as ErrorPayload;
    return new ApiError(payload.kind, localizeError(payload.kind, payload.message, payload.code, payload.params));
  }
  return new ApiError("unexpected", localizeError("unexpected", ""));
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toApiError(error);
  }
}

export const tauriApi: Api = {
  appInfo: () => call("app_info"),
  logError: (message) => call("app_log_error", { message }),
  workspaceGetDefault: () => call("workspace_get_default"),
  projectList: (workspaceId) => call("project_list", { workspaceId }),
  projectGet: (id) => call("project_get", { id }),
  projectCreate: (input) => call("project_create", { input }),
  projectUpdate: (input) => call("project_update", { input }),
  studyList: (input) => call("study_list", { input }),
  studyDuplicate: (input) => call("study_duplicate", { input }),
  studySearch: (query) => call("study_search", { query }),
  studyGet: (id) => call("study_get", { id }),
  studyCreate: (input) => call("study_create", { input }),
  studyUpdate: (input) => call("study_update", { input }),
  studySectionList: (studyId) => call("study_section_list", { studyId }),
  studySectionUpdate: (input) => call("study_section_update", { input }),
  studySectionCreate: (input) => call("study_section_create", { input }),
  studySectionDelete: (input) => call("study_section_delete", { input }),
  studySectionReorder: (input) => call("study_section_reorder", { input }),
  studyBlockReorder: (input) => call("study_block_reorder", { input }),

  findingList: (studyId) => call("finding_list", { studyId }),
  findingCreate: (input) => call("finding_create", { input }),
  findingUpdate: (input) => call("finding_update", { input }),
  findingDelete: (id) => call("finding_delete", { id }),
  findingReorder: (input) => call("finding_reorder", { input }),
  findingLinkPassage: (input) => call("finding_link_passage", { input }),
  findingUnlinkPassage: (passageId) => call("finding_unlink_passage", { passageId }),
  findingSetTags: (input) => call("finding_set_tags", { input }),

  studyRelationList: (studyId) => call("study_relation_list", { studyId }),
  studyRelationCreate: (input) => call("study_relation_create", { input }),
  studyRelationDelete: (id) => call("study_relation_delete", { id }),

  templateList: () => call("template_list"),
  templateCreate: (input) => call("template_create", { input }),
  templateUpdate: (input) => call("template_update", { input }),
  templateDuplicate: (id) => call("template_duplicate", { id }),
  templateDelete: (id) => call("template_delete", { id }),

  libraryList: (input) => call("library_list", { input }),
  libraryLanguages: () => call("library_languages"),
  libraryGetSource: (id) => call("library_get_source", { id }),
  chooseSourceFile: async () => {
    const chosen = await open({
      multiple: false,
      directory: false,
      title: "Choose a file to add to your library",
      filters: [
        { name: "Books and notes (PDF, EPUB, Word, Markdown, text)", extensions: ["pdf", "epub", "docx", "md", "markdown", "txt"] },
      ],
    });
    return typeof chosen === "string" ? chosen : null;
  },
  libraryImportPreview: (path) => call("library_import_preview", { path }),
  libraryImportCommit: (input) => call("library_import_commit", { input }),
  libraryImportCancel: (previewId) => call("library_import_cancel", { previewId }),
  libraryRemoveSource: (id) => call("library_remove_source", { id }),
  librarySearch: (input) => call("library_search", { input }),
  libraryOpenSegment: (segmentId) => call("library_open_segment", { segmentId }),
  sourceGetSegments: (input) => call("source_get_segments", { input }),
  librarySourceContents: (id) => call("library_source_contents", { id }),
  libraryGeneratedContents: (id) => call("library_generated_contents", { id }),
  librarySourceLinks: (id) => call("library_source_links", { id }),
  librarySourceReferences: (id) => call("library_source_references", { id }),
  libraryDetectReferences: (id, texts, scope) => call("library_detect_references", { id, texts, scope: scope ?? null }),
  librarySourceFind: (id, query) => call("library_source_find", { id, query }),
  libraryEpubStructure: (id) => call("library_epub_structure", { id }),
  libraryEpubItem: (id, item) => call("library_epub_item", { id, item }),
  openExternalLink: async (url) => {
    const safe = safeExternalUrl(url);
    if (!safe) throw new ApiError("invalidInput", "This kind of link is not opened.");
    await openUrl(safe);
  },
  libraryDocxStructure: (id) => call("library_docx_structure", { id }),
  libraryDocxItem: (id, item) => call("library_docx_item", { id, item }),
  libraryOriginalInfo: (id) => call("library_original_info", { id }),
  libraryOriginalRead: async (id, offset, length) =>
    new Uint8Array(await call<ArrayBuffer>("library_original_read", { id, offset, length })),
  sourceGetPassages: (sourceId) => call("source_get_passages", { sourceId }),
  libraryPassageSources: (reference) => call("library_passage_sources", { reference }),
  libraryPassageSourceLocations: (sourceId, reference) =>
    call("library_passage_source_locations", { sourceId, reference }),
  sourceSegmentPassageLinks: (segmentId) => call("source_segment_passage_links", { segmentId }),
  findingSourceAdd: (input) => call("finding_source_add", { input }),
  findingSourceRemove: (citationId) => call("finding_source_remove", { citationId }),
  studyBlockCreate: (input) => call("study_block_create", { input }),
  studyBlockUpdate: (input) => call("study_block_update", { input }),
  studyBlockDelete: (id) => call("study_block_delete", { id }),
  settingsGet: () => call("settings_get"),
  settingsUpdate: (input) => call("settings_update", { input }),

  scriptureBooks: () => call("scripture_books"),
  scriptureGetChapter: (input) => call("scripture_get_chapter", { input }),
  scriptureGetPassage: (input) => call("scripture_get_passage", { input }),
  scriptureSearch: (input) => call("scripture_search", { input }),
  scriptureConcordance: (input) => call("scripture_concordance", { input }),
  referenceParse: (text) => call("scripture_reference_parse", { text }),
  referenceDetect: (text) => call("scripture_reference_detect", { text }),

  bibleList: () => call("bible_list"),
  bibleBundledList: () => call("bible_bundled_list"),
  chooseBibleFiles: async () => {
    const chosen = await open({
      multiple: true,
      directory: false,
      title: "Choose a Bible to add",
      filters: [
        { name: "Bible files (USFM or .zip)", extensions: ["zip", "usfm", "sfm", "ptx", "txt"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (chosen === null) return null;
    return Array.isArray(chosen) ? chosen : [chosen];
  },
  bibleImportPreview: (input) => call("bible_import_preview", { input }),
  bibleImportCommit: (input) => call("bible_import_commit", { input }),
  bibleImportCancel: (previewId) => call("bible_import_cancel", { previewId }),
  bibleRemove: (id) => call("bible_remove", { id }),

  annotationList: (reference, translationId) => call("annotation_list", { reference, translationId }),
  annotationMarksList: (query) => call("annotation_marks_list", { query }),
  annotationCreate: (input) => call("annotation_create", { input }),
  annotationUpdate: (input) => call("annotation_update", { input }),
  annotationDelete: (id) => call("annotation_delete", { id }),
  annotationAnchorCheck: (input) => call("annotation_anchor_check", { input }),

  studyPassageList: (studyId) => call("study_passage_list", { studyId }),
  studyPassageAdd: (input) => call("study_passage_add", { input }),
  studyPassageRemove: (id) => call("study_passage_remove", { id }),
  studyPassageSetRole: ({ id, role }) => call("study_passage_set_role", { id, role }),
};
