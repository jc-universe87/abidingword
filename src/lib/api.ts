// The frontend's only door to the native core. Components use the `Api`
// interface through `useApi()`, never `invoke` directly, so tests can supply
// an in-memory implementation.
import type { MaterialDocument } from "@/features/materials/derive";
import i18n from "i18next";
import { localizeError } from "@/i18n/messages";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { safeExternalUrl } from "./externalLink";
import type { InquiryInput, InquiryPreview, InquiryReply, KeepInsight } from "@/types/inquiry";
import type { BackupPreview, BackupReport, ProjectExportReport, ProjectImportReport, ProjectPackagePreview, RestoreReport, SampleReport } from "@/types/portability";
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
  CreateStudySection,
  UpdateStudySection,
  Workspace,
} from "@/types/domain";
import type {
  BibleLanguageOption,
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
  HighlightColor,
  DetectedReference,
  ImportPreview,
  ImportRequest,
  PassageText,
  ScriptureRef,
  SearchResults,
  SearchScripture,
  StudyPassage,
  UpdateAnnotation, MaterialScripture } from "@/types/scripture";
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
  AssistantConfig,
  AssistantSettings,
  AssistInput,
  AssistPreview,
  AssistReply,
  FoundImage,
  GeneratedImage,
  KeepTeachingMaterial,
  StepKind,
  TeachingKind,
  TeachingPreparation,
  TeachingTemplate,
  TeachingTemplateInput,
  TeachingSummary,
  UpdateTeaching,
  UpdateTeachingPoint,
} from "@/types/teaching";
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
  SourceAnnotation,
  CreateSourceAnnotation,
  UpdateSourceAnnotation,
  SourceMarksPage,
  MarkedSource,
  SourceAnnotationKind,
  CreateFindingFromSource,
  CitationPlace,
} from "@/types/library";
import type {
  AudienceDocument,
  AudienceSlide,
  AudienceState,
  CreatePresentationItem,
  ExportFormat,
  ExportLocale,
  ExportOptions,
  ExportResult,
  ItemKind,
  Presentation,
  PresentationDocument,
  PresentationSummary,
  PresentationTheme,
  Screen,
  UpdatePresentationItem,
} from "@/types/presentation";
import type {
  ImportedTemplate,
  ImportProgress,
  InstalledFont,
  Page,
  PresentationTemplate,
  PresentationTemplateSummary,
  TemplateAsset,
  TemplateDefinition,
  TemplateSource,
} from "@/types/presentationTemplate";

export interface Api {
  appInfo(): Promise<AppInfo>;
  logError(message: string): Promise<void>;
  workspaceGetDefault(): Promise<Workspace>;
  projectList(workspaceId: string): Promise<Project[]>;
  projectGet(id: string): Promise<Project>;
  projectCreate(input: CreateProject): Promise<Project>;
  projectUpdate(input: UpdateProject): Promise<Project>;
  /** Saves one project as a package (.awproject) where the save dialog said; where it went. */
  projectExport(input: { projectId: string; path: string }): Promise<[string, ProjectExportReport]>;
  /** What a project package holds and what it refers to that is not here; nothing changes. */
  projectPackageInspect(path: string): Promise<ProjectPackagePreview>;
  /** Adds a package's project as a new project; never replaces one. */
  projectImport(path: string): Promise<ProjectImportReport>;
  /** Saves everything as one backup (.awbackup); where it went. */
  backupCreate(path: string): Promise<[string, BackupReport]>;
  /** What a backup holds; nothing changes. */
  backupInspect(path: string): Promise<BackupPreview>;
  /** Replaces everything with a backup, after a safety copy. */
  backupRestore(path: string): Promise<RestoreReport>;
  /** Adds the example project when asked; finds it instead when it is already there. */
  sampleProjectInstall(): Promise<SampleReport>;
  /** The system's open dialog for a project package or a backup; null when cancelled. */
  choosePortableFile(input: { kind: "project" | "backup"; title: string; filterName: string }): Promise<string | null>;
  /** The system's save dialog for a project package or a backup; null when cancelled. */
  choosePortableSaveFile(input: { kind: "project" | "backup"; defaultName: string; filterName: string }): Promise<string | null>;
  studyList(filter: ListStudies): Promise<StudySummary[]>;
  studyDuplicate(input: { studyId: string; includeContent: boolean }): Promise<StudyDetail>;
  studySearch(query: string): Promise<StudySearchHit[]>;
  studyGet(id: string): Promise<StudyDetail>;
  studyCreate(input: CreateStudy): Promise<StudyDetail>;
  studyUpdate(input: UpdateStudy): Promise<Study>;
  studySectionList(studyId: string): Promise<StudySection[]>;
  studySectionUpdate(input: UpdateStudySection): Promise<StudySection>;
  studySectionCreate(input: CreateStudySection): Promise<StudySection>;
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
  /** A source's highlights, notes and bookmarks in reading order, each found again in the stored text first. */
  sourceAnnotationList(sourceId: string): Promise<SourceAnnotation[]>;
  sourceAnnotationCreate(input: CreateSourceAnnotation): Promise<SourceAnnotation>;
  sourceAnnotationUpdate(input: UpdateSourceAnnotation): Promise<SourceAnnotation>;
  sourceAnnotationDelete(id: string): Promise<void>;
  /** A page of the marks in library sources (by source, then reading order), for the Marks view. */
  sourceMarksList(query: { kind?: SourceAnnotationKind; sourceId?: string; color?: HighlightColor; query?: string; limit?: number; offset?: number }): Promise<SourceMarksPage>;
  /** The sources that have marks, with how many. */
  sourceMarksSources(): Promise<MarkedSource[]>;
  findingSourceAdd(input: { findingId: string; segmentId: string }): Promise<Finding>;
  /** "Add to Study" (v0.15): a new finding from selected words, a place or a mark, with its citation. */
  findingCreateFromSource(input: CreateFindingFromSource): Promise<Finding>;
  /** Where a citation is in its source now (null: the source was removed). */
  findingSourceLocate(citationId: string): Promise<CitationPlace | null>;

  /** Teaching Preparation (v0.16): what a study leads to, written by the person. */
  teachingList(studyId: string): Promise<TeachingSummary[]>;
  teachingGet(id: string): Promise<TeachingPreparation>;
  /** `points`: the steps or points it starts with (a format's starting structure), in the person's language. */
  /** The person's own Bible Teaching templates (v0.18.7); the built-in ones are in the interface. */
  teachingTemplateList(): Promise<TeachingTemplate[]>;
  teachingTemplateCreate(input: TeachingTemplateInput): Promise<TeachingTemplate>;
  teachingTemplateUpdate(input: TeachingTemplateInput & { id: string }): Promise<TeachingTemplate>;
  teachingTemplateDelete(id: string): Promise<void>;
  teachingCreate(input: { studyId: string; title: string; kind?: TeachingKind | null; points?: { title: string; kind?: StepKind | null }[] }): Promise<TeachingPreparation>;
  teachingUpdate(input: UpdateTeaching): Promise<TeachingPreparation>;
  teachingDelete(id: string): Promise<void>;
  teachingPointCreate(input: { preparationId: string; title?: string; kind?: StepKind | null; afterPointId?: string | null }): Promise<TeachingPreparation>;
  teachingPointUpdate(input: UpdateTeachingPoint): Promise<TeachingPreparation>;
  teachingPointDelete(id: string): Promise<TeachingPreparation>;
  teachingPointReorder(input: Reorder): Promise<TeachingPreparation>;
  /** Uses a study finding here (a live link; the finding stays the study's). */
  teachingFindingLink(input: { preparationId: string; pointId?: string | null; findingId: string }): Promise<TeachingPreparation>;
  teachingFindingUnlink(linkId: string): Promise<TeachingPreparation>;
  teachingPassageAdd(input: { preparationId: string; pointId?: string | null; reference: string }): Promise<TeachingPreparation>;
  teachingPassageRemove(id: string): Promise<TeachingPreparation>;
  /** Keeps something from the assistant, with its standing and sources. */
  teachingMaterialKeep(input: KeepTeachingMaterial): Promise<TeachingPreparation>;
  teachingMaterialRemove(id: string): Promise<TeachingPreparation>;
  /** A kept generated image, as a data: address. */
  teachingImage(file: string): Promise<string>;

  // Presentation & Delivery (v0.18): the teaching stays the source of truth.
  presentationList(preparationId: string): Promise<PresentationSummary[]>;
  presentationGet(id: string): Promise<Presentation>;
  /** A first presentation proposed from the teaching by fixed rules (no AI). */
  presentationCreate(input: { preparationId: string; title?: string | null; propose: boolean; labels: { introduction: string; conclusion: string } }): Promise<Presentation>;
  /** `templateId: ""` goes back to the built-in background. */
  presentationUpdate(input: { id: string; title?: string; theme?: PresentationTheme; translationId?: string; targetMinutes?: number; templateId?: string }): Promise<Presentation>;
  presentationDelete(id: string): Promise<void>;
  presentationItemCreate(input: CreatePresentationItem): Promise<Presentation>;
  presentationItemUpdate(input: UpdatePresentationItem): Promise<Presentation>;
  presentationItemDelete(id: string): Promise<Presentation>;
  presentationItemReorder(input: Reorder): Promise<Presentation>;
  /** The slides as they are now (speaker and audience content). */
  presentationDocument(id: string): Promise<PresentationDocument>;
  /** Audience content only, for the audience screen. */
  presentationAudience(id: string): Promise<AudienceDocument>;
  presentationImage(id: string, assetId: string): Promise<string>;
  /** Saves a copy of a found image on this computer (Wikimedia only), on request. */
  presentationImageSave(input: { presentationId: string; assetId: string }): Promise<void>;
  /** The system's save dialog; null when cancelled. It asks before replacing a file. */
  choosePresentationFile(input: { defaultName: string; format: ExportFormat; filterName: string }): Promise<string | null>;
  presentationExport(input: { id: string; format: ExportFormat; path: string; options: ExportOptions }): Promise<ExportResult>;
  /** Teaching materials (v0.18.6): where to save one, chosen in the system's save dialog (null: cancelled). */
  chooseMaterialFile(input: { defaultName: string; filterName: string; extension?: "md" | "docx" }): Promise<string | null>;
  /** Writes a material, as Markdown, to the chosen file; returns where it went. */
  materialSaveMarkdown(input: { path: string; text: string }): Promise<string>;
  /** Writes a material, as a Word document (.docx), to the chosen file (v0.18.8); returns where it went. */
  materialSaveDocx(input: { path: string; document: MaterialDocument; format?: { language?: string; paper?: "a4" | "letter" } }): Promise<string>;
  /** The text of a material's passages from the chosen Bible only (v0.18.8). */
  materialScripture(input: { translationId: string; references: string[] }): Promise<MaterialScripture>;
  /** The displays connected; empty where a second window cannot be opened. */
  presentationScreens(): Promise<Screen[]>;
  presentationAudienceOpen(input: { presentationId: string; screen: number | null; title: string; state: AudienceState }): Promise<void>;
  presentationAudienceShow(state: AudienceState): Promise<void>;
  presentationAudienceState(): Promise<AudienceState | null>;
  presentationAudienceClose(): Promise<void>;
  /** On the audience screen: what to show, as the presenter moves. */
  onAudienceState(handler: (state: AudienceState) => void): Promise<() => void>;
  /** On the main window: the audience screen was closed. */
  onAudienceClosed(handler: () => void): Promise<() => void>;
  /** On the audience screen: hands a key (a clicker) to the Presenter View. */
  presentationAudienceKey(key: string): Promise<void>;
  /** On the main window: a key pressed on the audience screen. */
  onAudienceKey(handler: (key: string) => void): Promise<() => void>;
  /** Audience pages in the presentation's template, worked out as PowerPoint and PDF work them out. */
  presentationLayout(input: { id: string; slides: { kind: ItemKind; audience: AudienceSlide }[]; locale: ExportLocale }): Promise<Page[]>;

  // Church presentation templates (v0.18.1)
  presentationTemplateList(): Promise<PresentationTemplateSummary[]>;
  presentationTemplateGet(id: string): Promise<PresentationTemplate>;
  presentationTemplateCreate(input: { name: string; description: string; definition: TemplateDefinition; sourceFormat: TemplateSource; sourceName?: string | null; report?: unknown }): Promise<PresentationTemplate>;
  presentationTemplateUpdate(input: { id: string; name?: string; description?: string; definition?: TemplateDefinition }): Promise<PresentationTemplate>;
  /** Removes a template; presentations using it go back to their built-in background. */
  presentationTemplateDelete(id: string): Promise<void>;
  /** Keeps an image (logo, background) the person chose. */
  presentationTemplateAssetAdd(path: string): Promise<TemplateAsset>;
  /** A kept template image as a data: address. */
  presentationTemplateAsset(asset: TemplateAsset): Promise<string>;
  presentationTemplateExport(input: { id: string; path: string }): Promise<void>;
  presentationTemplateImportPackage(path: string): Promise<PresentationTemplate>;
  /** Reads a PowerPoint file's design for review; nothing is saved yet. */
  presentationTemplateImportPptx(path: string): Promise<ImportedTemplate>;
  onTemplateImportProgress(handler: (progress: ImportProgress) => void): Promise<() => void>;
  /** Sample slides laid out in a design not saved yet (import review, designer). */
  presentationTemplatePreview(input: { definition: TemplateDefinition; slides: { kind: ItemKind; audience: AudienceSlide }[]; locale: ExportLocale }): Promise<Page[]>;
  /** The fonts installed on this computer. */
  presentationFonts(): Promise<InstalledFont[]>;
  /** The system's open dialog for a template file; null when cancelled. */
  chooseTemplateFile(input: { kind: "pptx" | "package" | "image"; title: string; filterName: string }): Promise<string | null>;
  /** The system's save dialog for a template package; null when cancelled. */
  chooseTemplateSaveFile(input: { defaultName: string; filterName: string }): Promise<string | null>;

  /** The assistant's set-up (never a key, only whether one is kept). */
  assistantSettingsGet(): Promise<AssistantSettings>;
  assistantSettingsSet(config: AssistantConfig): Promise<AssistantSettings>;
  /** Keeps a key in the computer's credential store; blank removes it. */
  assistantKeySet(which: "provider" | "search" | "image", key: string): Promise<AssistantSettings>;
  assistantTest(): Promise<void>;
  /** Asks the chosen search service once; how many web pages it found. */
  assistantSearchTest(): Promise<number>;
  /** What would be shared, and where it would go, before anything is sent. */
  assistantPreview(input: AssistInput): Promise<AssistPreview>;
  /** Asks the assistant. The answer is a suggestion; nothing is changed. */
  assistantAsk(input: AssistInput): Promise<AssistReply>;
  /** Study and research help (v0.20): exactly what would be sent, before anything is. */
  inquiryPreview(input: InquiryInput): Promise<InquiryPreview>;
  /** Asks, only if what would be sent still has the preview's fingerprint. Changes nothing. */
  inquiryAsk(input: InquiryInput, fingerprint: string): Promise<InquiryReply>;
  /** Keeps help the person accepted as a note in their study. */
  inquiryKeep(input: KeepInsight): Promise<Finding>;
  assistantFindImages(terms: string): Promise<FoundImage[]>;
  /** The preview of a kept found image (fetched by the core from Wikimedia only). */
  assistantImagePreview(url: string): Promise<string | null>;
  assistantGenerateImage(description: string): Promise<GeneratedImage>;
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
  /**
   * A typed passage in any of the 100 reference languages ("Johannes 15,5",
   * "요한복음 15장 5절"). `translationId` is the Bible the person is reading:
   * its stored language decides an ambiguous abbreviation first, then the
   * interface language (scripture::resolve).
   */
  referenceParse(text: string, translationId?: string | null): Promise<ScriptureRef>;
  referenceDetect(text: string): Promise<DetectedReference[]>;

  bibleList(): Promise<BibleTranslation[]>;
  bibleBundledList(): Promise<BundledBibleInfo[]>;
  /** Opens the system file dialog; null when the user cancels. */
  chooseBibleFiles(): Promise<string[] | null>;
  bibleImportPreview(input: ImportRequest): Promise<ImportPreview>;
  bibleImportCommit(input: CommitImport): Promise<BibleTranslation>;
  bibleImportCancel(previewId: string): Promise<void>;
  bibleRemove(id: string): Promise<void>;
  /** The languages a Bible can be marked as. */
  bibleLanguageOptions(): Promise<BibleLanguageOption[]>;
  /** Corrects a Bible's language: its name as shown, and its tag (null: none). */
  bibleSetLanguage(input: { id: string; language: string; languageCode: string | null }): Promise<BibleTranslation>;

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

/** The file kinds of a project package and a backup. */
export const PORTABLE_EXTENSION = { project: "awproject", backup: "awbackup" } as const;

export const tauriApi: Api = {
  appInfo: () => call("app_info"),
  logError: (message) => call("app_log_error", { message }),
  workspaceGetDefault: () => call("workspace_get_default"),
  projectList: (workspaceId) => call("project_list", { workspaceId }),
  projectGet: (id) => call("project_get", { id }),
  projectCreate: (input) => call("project_create", { input }),
  projectUpdate: (input) => call("project_update", { input }),
  projectExport: ({ projectId, path }) => call("project_export", { projectId, path }),
  projectPackageInspect: (path) => call("project_package_inspect", { path }),
  projectImport: (path) => call("project_import", { path }),
  backupCreate: (path) => call("backup_create", { path }),
  backupInspect: (path) => call("backup_inspect", { path }),
  backupRestore: (path) => call("backup_restore", { path }),
  sampleProjectInstall: () => call("sample_project_install"),
  choosePortableFile: async ({ kind, title, filterName }) => {
    const chosen = await open({ multiple: false, directory: false, title, filters: [{ name: filterName, extensions: [PORTABLE_EXTENSION[kind]] }] });
    return typeof chosen === "string" ? chosen : null;
  },
  choosePortableSaveFile: async ({ kind, defaultName, filterName }) => save({ defaultPath: defaultName, filters: [{ name: filterName, extensions: [PORTABLE_EXTENSION[kind]] }] }),
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
  sourceAnnotationList: (sourceId) => call("source_annotation_list", { sourceId }),
  sourceAnnotationCreate: (input) => call("source_annotation_create", { input }),
  sourceAnnotationUpdate: (input) => call("source_annotation_update", { input }),
  sourceAnnotationDelete: (id) => call("source_annotation_delete", { id }),
  sourceMarksList: (query) => call("source_marks_list", { query }),
  sourceMarksSources: () => call("source_marks_sources"),
  findingSourceAdd: (input) => call("finding_source_add", { input }),
  findingCreateFromSource: (input) => call("finding_create_from_source", { input }),
  findingSourceLocate: (citationId) => call("finding_source_locate", { citationId }),
  teachingList: (studyId) => call("teaching_list", { studyId }),
  teachingGet: (id) => call("teaching_get", { id }),
  teachingTemplateList: () => call("teaching_template_list"),
  teachingTemplateCreate: (input) => call("teaching_template_create", { input }),
  teachingTemplateUpdate: (input) => call("teaching_template_update", { input }),
  teachingTemplateDelete: (id) => call("teaching_template_delete", { id }),
  teachingCreate: (input) => call("teaching_create", { input }),
  teachingUpdate: (input) => call("teaching_update", { input }),
  teachingDelete: (id) => call("teaching_delete", { id }),
  teachingPointCreate: (input) => call("teaching_point_create", { input }),
  teachingPointUpdate: (input) => call("teaching_point_update", { input }),
  teachingPointDelete: (id) => call("teaching_point_delete", { id }),
  teachingPointReorder: (input) => call("teaching_point_reorder", { input }),
  teachingFindingLink: (input) => call("teaching_finding_link", { input }),
  teachingFindingUnlink: (id) => call("teaching_finding_unlink", { id }),
  teachingPassageAdd: (input) => call("teaching_passage_add", { input }),
  teachingPassageRemove: (id) => call("teaching_passage_remove", { id }),
  teachingMaterialKeep: (input) => call("teaching_material_keep", { input }),
  teachingMaterialRemove: (id) => call("teaching_material_remove", { id }),
  teachingImage: (file) => call("teaching_image", { file }),
  presentationList: (preparationId) => call("presentation_list", { preparationId }),
  presentationGet: (id) => call("presentation_get", { id }),
  presentationCreate: (input) => call("presentation_create", { input }),
  presentationUpdate: (input) => call("presentation_update", { input }),
  presentationDelete: (id) => call("presentation_delete", { id }),
  presentationItemCreate: (input) => call("presentation_item_create", { input }),
  presentationItemUpdate: (input) => call("presentation_item_update", { input }),
  presentationItemDelete: (id) => call("presentation_item_delete", { id }),
  presentationItemReorder: (input) => call("presentation_item_reorder", { input }),
  presentationDocument: (id) => call("presentation_document", { id }),
  presentationAudience: (id) => call("presentation_audience", { id }),
  presentationImage: (id, assetId) => call("presentation_image", { id, assetId }),
  presentationImageSave: (input) => call("presentation_image_save", { input }),
  choosePresentationFile: async ({ defaultName, format, filterName }) => {
    const extension = { pptx: "pptx", pdf: "pdf", speaker_pdf: "pdf", markdown: "md", package: "json" }[format];
    return save({ defaultPath: defaultName, filters: [{ name: filterName, extensions: [extension] }] });
  },
  presentationExport: (input) => call("presentation_export", { input }),
  chooseMaterialFile: async ({ defaultName, filterName, extension = "md" }) => save({ defaultPath: defaultName, filters: [{ name: filterName, extensions: [extension] }] }),
  materialSaveMarkdown: (input) => call("material_save_markdown", { input }),
  materialScripture: (input) => call("material_scripture", { input }),
  materialSaveDocx: (input) => call("material_save_docx", { input }),
  presentationScreens: () => call("presentation_screens"),
  presentationAudienceOpen: (input) => call("presentation_audience_open", { input }),
  presentationAudienceShow: (state) => call("presentation_audience_show", { input: state }),
  presentationAudienceState: () => call("presentation_audience_state"),
  presentationAudienceClose: () => call("presentation_audience_close"),
  onAudienceState: (handler) => listen<AudienceState>("presentation-audience", (event) => handler(event.payload)),
  onAudienceClosed: (handler) => listen("presentation-audience-closed", () => handler()),
  presentationAudienceKey: (key) => call("presentation_audience_key", { key }),
  onAudienceKey: (handler) => listen<string>("presentation-audience-key", (event) => handler(event.payload)),
  presentationLayout: (input) => call("presentation_layout", { input }),
  presentationTemplateList: () => call("presentation_template_list"),
  presentationTemplateGet: (id) => call("presentation_template_get", { id }),
  presentationTemplateCreate: (input) => call("presentation_template_create", { input }),
  presentationTemplateUpdate: (input) => call("presentation_template_update", { input }),
  presentationTemplateDelete: (id) => call("presentation_template_delete", { id }),
  presentationTemplateAssetAdd: (path) => call("presentation_template_asset_add", { path }),
  presentationTemplateAsset: (asset) => call("presentation_template_asset", { asset }),
  presentationTemplateExport: (input) => call("presentation_template_export", { input }),
  presentationTemplateImportPackage: (path) => call("presentation_template_import_package", { path }),
  presentationTemplateImportPptx: (path) => call("presentation_template_import_pptx", { path }),
  onTemplateImportProgress: (handler) => listen<ImportProgress>("presentation-template-import-progress", (event) => handler(event.payload)),
  presentationTemplatePreview: (input) => call("presentation_template_preview", { input }),
  presentationFonts: () => call("presentation_fonts"),
  chooseTemplateFile: async ({ kind, title, filterName }) => {
    const extensions = { pptx: ["pptx"], package: ["awtemplate"], image: ["png", "jpg", "jpeg", "gif", "webp"] }[kind];
    const chosen = await open({ multiple: false, directory: false, title, filters: [{ name: filterName, extensions }] });
    return typeof chosen === "string" ? chosen : null;
  },
  chooseTemplateSaveFile: async ({ defaultName, filterName }) => save({ defaultPath: defaultName, filters: [{ name: filterName, extensions: ["awtemplate"] }] }),
  assistantSettingsGet: () => call("assistant_settings_get"),
  assistantSettingsSet: (config) => call("assistant_settings_set", { config }),
  assistantKeySet: (which, key) => call("assistant_key_set", { which, key }),
  assistantTest: () => call("assistant_test"),
  assistantSearchTest: () => call("assistant_search_test"),
  assistantPreview: (input) => call("assistant_preview", { input }),
  assistantAsk: (input) => call("assistant_ask", { input }),
  inquiryPreview: (input) => call("inquiry_preview", { input }),
  inquiryAsk: (input, fingerprint) => call("inquiry_ask", { input, fingerprint }),
  inquiryKeep: (input) => call("inquiry_keep", { input }),
  assistantFindImages: (terms) => call("assistant_find_images", { terms }),
  assistantImagePreview: (url) => call("assistant_image_preview", { url }),
  assistantGenerateImage: (description) => call("assistant_generate_image", { description }),
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
  // One reader for typed passages in any of the 100 reference languages; the
  // Bible being read, then the interface language, settle a genuine tie.
  referenceParse: (text, translationId) => call("scripture_reference_parse", { text, language: i18n.language, translationId: translationId ?? null }),
  // Detection reads text whose language is unknown: the interface language is
  // not the language of a study note, so it is read as before (English first).
  referenceDetect: (text) => call("scripture_reference_detect", { text }),

  bibleList: () => call("bible_list"),
  bibleBundledList: () => call("bible_bundled_list"),
  chooseBibleFiles: async () => {
    const chosen = await open({
      multiple: true,
      directory: false,
      title: "Choose a Bible to add",
      filters: [
        // metadata.xml / Settings.xml chosen alongside name the language (v0.18.3).
        { name: "Bible files (USFM or .zip)", extensions: ["zip", "usfm", "sfm", "ptx", "txt", "xml"] },
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
  bibleLanguageOptions: () => call("bible_language_options"),
  bibleSetLanguage: ({ id, language, languageCode }) => call("bible_set_language", { id, language, languageCode }),

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
