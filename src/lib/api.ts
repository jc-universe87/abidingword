// The frontend's only door to the native core. Components use the `Api`
// interface through `useApi()`, never `invoke` directly, so tests can supply
// an in-memory implementation.
import { localizeError } from "@/i18n/messages";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
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
  CreateAnnotation,
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
  PassageMention,
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
  sourceGetSegments(input: { sourceId: string; offset?: number; limit?: number }): Promise<SegmentWindow>;
  sourceGetPassages(sourceId: string): Promise<PassageMention[]>;
  librarySourcesForPassage(reference: string): Promise<PassageMention[]>;
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
        { name: "Books and notes (PDF, EPUB, Markdown, text)", extensions: ["pdf", "epub", "md", "markdown", "txt"] },
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
  sourceGetPassages: (sourceId) => call("source_get_passages", { sourceId }),
  librarySourcesForPassage: (reference) => call("library_sources_for_passage", { reference }),
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
  annotationCreate: (input) => call("annotation_create", { input }),
  annotationUpdate: (input) => call("annotation_update", { input }),
  annotationDelete: (id) => call("annotation_delete", { id }),
  annotationAnchorCheck: (input) => call("annotation_anchor_check", { input }),

  studyPassageList: (studyId) => call("study_passage_list", { studyId }),
  studyPassageAdd: (input) => call("study_passage_add", { input }),
  studyPassageRemove: (id) => call("study_passage_remove", { id }),
  studyPassageSetRole: ({ id, role }) => call("study_passage_set_role", { id, role }),
};
