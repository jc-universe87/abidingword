// An in-memory implementation of the native API for interface tests.
// It mirrors the behaviour the Rust layer guarantees (validation messages,
// template sections, soft delete), not its storage.
import biblicalTheology from "../../resources/templates/biblical-theology-study.json";
import passageStudy from "../../resources/templates/passage-study.json";
import systematicTheology from "../../resources/templates/systematic-theology-study.json";
import teachingStudy from "../../resources/templates/teaching-study.json";
import topicalStudy from "../../resources/templates/topical-study.json";
import wordStudy from "../../resources/templates/word-study.json";
import { ApiError, type Api } from "@/lib/api";
import type {
  AppInfo,
  AppSettings,
  Project,
  Study,
  StudyBlock,
  StudySection,
  Workspace,
} from "@/types/domain";
import type {
  Annotation,
  BibleTranslation,
  ImportPreview,
  ScriptureRef,
  StudyPassage,
  VerseText,
} from "@/types/scripture";
import { contains, refFromCanonical } from "@/lib/scripture";
import type {
  FindingCitation,
  LibraryHit,
  PassageMention,
  Source,
  SourceImportPreview,
  SourceSegment,
  SourceSummary,
} from "@/types/library";
import type {
  Finding,
  StudyRelation,
  StudySearchHit,
  StudySummary,
  StudyTemplate,
  StudyType,
  TemplateSection,
} from "@/types/studies";

const BUILTIN_TEMPLATES = [passageStudy, wordStudy, topicalStudy, biblicalTheology, systematicTheology, teachingStudy];
import { BOOKS, FIXTURE_VERSE_COUNT, fixtureChapters } from "./scriptureFixture";

const now = () => new Date().toISOString();
let counter = 0;
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

function requireTitle(value: string, what: string): string {
  const title = value.trim();
  if (!title) throw new ApiError("invalidInput", `Please give the ${what} a title.`);
  return title;
}

export interface MemoryApi extends Api {
  state: {
    info: AppInfo;
    workspace: Workspace;
    projects: Project[];
    studies: Study[];
    sections: StudySection[];
    blocks: StudyBlock[];
    settings: AppSettings;
    bibles: BibleTranslation[];
    /** translation id → "BOOK|chapter" → verses */
    text: Map<string, Map<string, VerseText[]>>;
    annotations: Annotation[];
    passages: StudyPassage[];
    /** What the next "choose files" dialog returns (null = cancelled). */
    nextChosenFiles: string[] | null;
    findings: Finding[];
    relations: { id: string; from: string; to: string; relationType: StudyRelation["relationType"]; createdAt: string }[];
    templates: StudyTemplate[];
    pendingPreview: { id: string; bundled: boolean } | null;
    library: {
      /** Removed sources stay (deleted: true) as citation tombstones. */
      sources: (Source & { deleted: boolean })[];
      segments: (SourceSegment & { sourceId: string })[];
      mentions: { sourceId: string; segmentId: string; reference: ScriptureRef; matchedText: string }[];
      /** What the next "choose a file" dialog returns (null = cancelled). */
      nextChosenFile: string | null;
      pending: { preview: SourceImportPreview; fixture: SourceFixture } | null;
    };
  };
  /** Installs a fixture Bible directly (test setup). */
  installFixtureBible(shortName: string, wording: string): BibleTranslation;
  /** Adds a source to the library directly (test setup). */
  installFixtureSource(fixture: SourceFixture): Source;
}

/** Invented library content for tests. */
export interface SourceFixture {
  title: string;
  author?: string;
  format?: Source["format"];
  sourceType?: Source["sourceType"];
  language?: string;
  segments: { text: string; pageNumber?: number; sectionPath?: string }[];
  /** Scripture mentions: segment index, canonical reference, text as written. */
  mentions?: { segment: number; reference: string; matchedText: string }[];
}

/**
 * What a library file "contains" in tests, by path: "scanned" → a PDF with
 * no text layer; ".docx" → unsupported; anything else → a small PDF.
 */
function fixtureForPath(path: string): SourceFixture {
  const name = path.split("/").pop() ?? path;
  const format = path.endsWith(".epub") ? "epub" : path.endsWith(".md") ? "markdown" : path.endsWith(".txt") ? "text" : "pdf";
  // PDFs have pages; EPUB and Markdown have chapters or headings.
  const where = (n: number) => (format === "pdf" ? { pageNumber: n } : { sectionPath: `Chapter ${n === 3 ? 2 : 1}` });
  return {
    title: name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
    author: "A. Writer",
    format,
    language: "English",
    segments: path.includes("scanned")
      ? []
      : [
          { text: "The vine and the branches belong together.", ...where(1) },
          { text: "Abide in me, as John 15:4 says, and bear fruit.", ...where(2) },
          { text: "Grace is the root of all fruitfulness.", ...where(3) },
        ],
    mentions: path.includes("scanned") ? [] : [{ segment: 1, reference: "JHN.15.4", matchedText: "John 15:4" }],
  };
}

const bookByCode = new Map(BOOKS.map((b) => [b.code, b]));

const ALIASES: Record<string, string> = {
  john: "JHN", jn: "JHN", romans: "ROM", rom: "ROM", psalm: "PSA", psalms: "PSA", ps: "PSA",
  genesis: "GEN", "1 cor": "1CO", "1 corinthians": "1CO",
};

/** A deliberately small stand-in for the native English parser. */
function parseForTests(text: string): ScriptureRef {
  const match = /^\s*([1-3]?\s?[a-z]+)\s+(\d+)(?::(\d+)(?:-(\d+))?)?\s*$/i.exec(text);
  const book = match ? ALIASES[(match[1] ?? "").toLowerCase()] : undefined;
  const info = book ? bookByCode.get(book) : undefined;
  const chapter = Number(match?.[2]);
  if (!match || !book || !info || chapter < 1 || chapter > info.chapterCount) {
    throw new ApiError(
      "invalidReference",
      `“${text.trim()}” is not a passage I recognise. Try a form like “John 15” or “Rom 8:1-17”.`,
    );
  }
  const [v1, v2] = [match[3], match[4]];
  const canonical = v1
    ? v2
      ? `${book}.${chapter}.${v1}-${book}.${chapter}.${v2}`
      : `${book}.${chapter}.${v1}`
    : `${book}.${chapter}`;
  const ref = refFromCanonical(canonical, bookByCode);
  if (!ref) throw new ApiError("invalidReference", "Invalid reference.");
  return ref;
}

function overlaps(a: ScriptureRef, b: ScriptureRef): boolean {
  if (a.book !== b.book) return false;
  const key = (c: number, v: number) => c * 1000 + v;
  return (
    key(a.startChapter, a.startVerse ?? 0) <= key(b.endChapter, b.endVerse ?? 999) &&
    key(b.startChapter, b.startVerse ?? 0) <= key(a.endChapter, a.endVerse ?? 999)
  );
}

export function createMemoryApi(overrides: Partial<AppInfo> = {}): MemoryApi {
  const stamp = now();
  const state: MemoryApi["state"] = {
    info: {
      version: "0.1.0",
      ready: true,
      error: null,
      dataDirectory: "/home/test/.local/share/Abiding Word",
      databasePath: "/home/test/.local/share/Abiding Word/database/abiding-word.db",
      logDirectory: "/home/test/.local/share/Abiding Word/logs",
      schemaVersion: 1,
      ...overrides,
    },
    workspace: { id: id(), name: "My Workspace", isDefault: true, createdAt: stamp, updatedAt: stamp, revision: 1 },
    projects: [],
    studies: [],
    sections: [],
    blocks: [],
    settings: { theme: "light", scriptureTranslationId: null, scripturePassage: null },
    bibles: [],
    text: new Map(),
    annotations: [],
    passages: [],
    nextChosenFiles: null,
    pendingPreview: null,
    library: { sources: [], segments: [], mentions: [], nextChosenFile: null, pending: null },
    findings: [],
    relations: [],
    templates: BUILTIN_TEMPLATES.map((t) => ({
      id: `tpl-${t.key}`,
      key: t.key,
      name: t.name,
      description: t.description,
      studyType: t.studyType as StudyType,
      isBuiltin: true,
      sections: t.sections,
      createdAt: stamp,
      updatedAt: stamp,
      revision: 1,
    })),
  };

  const touch = (studyId: string) => {
    const study = state.studies.find((s) => s.id === studyId);
    if (study) study.updatedAt = now();
  };
  const addSection = (studyId: string, section: TemplateSection, position: number) => {
    const t = now();
    const sectionId = id();
    state.sections.push({
      id: sectionId, studyId, key: section.key ?? null, title: section.title, guidance: section.guidance ?? null,
      position, blocks: [], createdAt: t, updatedAt: t, revision: 1,
    });
    state.blocks.push({ id: id(), sectionId, blockType: "paragraph", position: 0, content: "", createdAt: t, updatedAt: t, revision: 1 });
    return sectionId;
  };
  const summary = (study: Study): StudySummary => ({
    id: study.id,
    projectId: study.projectId,
    projectTitle: find(state.projects, study.projectId, "project").title,
    title: study.title,
    studyType: study.studyType,
    status: study.status,
    primaryPassage: state.passages.find((p) => p.studyId === study.id && p.role === "primary")?.reference ?? null,
    findingCount: state.findings.filter((f) => f.studyId === study.id).length,
    updatedAt: study.updatedAt,
  });
  const userTemplate = (templateId: string) => {
    const template = find(state.templates, templateId, "template");
    if (template.isBuiltin) {
      throw new ApiError("conflict", "Built-in templates can’t be changed. Duplicate it to make your own version.");
    }
    return template;
  };

  const addBible = (fields: Partial<BibleTranslation> & { shortName: string; name: string }, wording: string) => {
    if (state.bibles.some((b) => b.shortName.toLowerCase() === fields.shortName.toLowerCase())) {
      throw new ApiError("duplicateTranslation", `A Bible called “${fields.shortName}” is already installed. Choose a different short name.`);
    }
    const t = now();
    const bible: BibleTranslation = {
      id: id(),
      language: "English",
      languageCode: "en",
      publisher: null,
      copyrightNotice: null,
      licenseType: null,
      kind: "structured",
      sourceType: "usfm",
      sourceOrigin: "managed_copy",
      sourcePath: null,
      originalFileName: null,
      importStatus: "ready",
      isBuiltin: false,
      bookCount: 3,
      verseCount: FIXTURE_VERSE_COUNT,
      createdAt: t,
      updatedAt: t,
      ...fields,
    };
    state.bibles.push(bible);
    state.text.set(bible.id, fixtureChapters(wording));
    return bible;
  };

  const preview = (bundled: boolean, broken: boolean): ImportPreview => ({
    previewId: id(),
    format: "usfm",
    bundled,
    suggested: bundled
      ? { name: "World English Bible", shortName: "WEB", language: "English", languageCode: "en", publisher: "eBible.org", copyrightNotice: "Public Domain", licenseType: "Public Domain" }
      : { name: "my bible", shortName: "", language: "", languageCode: "", publisher: null, copyrightNotice: null, licenseType: null },
    bookCount: 3,
    chapterCount: 5,
    verseCount: FIXTURE_VERSE_COUNT,
    books: [
      { code: "PSA", name: "Psalms", chapters: 1, verses: 2, status: "ok" },
      { code: "JHN", name: "John", chapters: 3, verses: 10, status: broken ? "error" : "warning" },
      { code: "ROM", name: "Romans", chapters: 1, verses: 3, status: "ok" },
    ],
    issues: [
      // Coded like the core's issues; the interface shows them translated.
      ...(broken
        ? [{
            severity: "error" as const, book: "JHN", chapter: 15, message: "John 15:1 appears twice.",
            code: "bibleImport.verseTwice", params: { bookCode: "JHN", chapter: "15", verse: "1" },
          }]
        : []),
      {
        severity: "warning", book: "JHN", chapter: null, message: "John: 3 of 21 chapters found (missing: 1, 2, 3 and 15 more).",
        code: "bibleImport.missingChapters",
        params: { bookCode: "JHN", found: "3", count: "21", numbers: "1, 2, 3", listed: "18", more: "15" },
      },
    ],
    skippedFiles: [],
    canImport: !broken,
  });

  const find = <T extends { id: string }>(list: T[], key: string, entity: string): T => {
    const item = list.find((x) => x.id === key);
    if (!item) throw new ApiError("notFound", `This ${entity} could not be found. It may have been deleted.`);
    return item;
  };
  const withCount = (p: Project): Project => ({
    ...p,
    studyCount: state.studies.filter((s) => s.projectId === p.id).length,
  });
  const sectionsOf = (studyId: string): StudySection[] =>
    state.sections
      .filter((s) => s.studyId === studyId)
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ ...s, blocks: state.blocks.filter((b) => b.sectionId === s.id) }));
  const detail = (studyId: string) => ({ study: find(state.studies, studyId, "study"), sections: sectionsOf(studyId) });

  const library = state.library;
  const liveSource = (sourceId: string) => {
    const source = library.sources.find((s) => s.id === sourceId && !s.deleted);
    if (!source) throw new ApiError("notFound", "This source could not be found. It may have been removed.");
    return source;
  };
  const locator = (s: { pageNumber: number | null; sectionPath: string | null; paragraphIndex: number | null }) =>
    s.pageNumber !== null ? `p. ${s.pageNumber}` : (s.sectionPath ?? `¶ ${(s.paragraphIndex ?? 0) + 1}`);
  const addSource = (fixture: SourceFixture, extra: Partial<Source> = {}): Source => {
    const t = now();
    const sourceId = id();
    const format = fixture.format ?? "pdf";
    const segmentIds = fixture.segments.map((seg, position) => {
      const segment = {
        id: id(), sourceId, position, text: seg.text, pageNumber: seg.pageNumber ?? null, pageLabel: null,
        chapter: null, heading: null, sectionPath: seg.sectionPath ?? null, paragraphIndex: 0, locator: "",
      };
      segment.locator = locator(segment);
      library.segments.push(segment);
      return segment.id;
    });
    for (const m of fixture.mentions ?? []) {
      const reference = refFromCanonical(m.reference, bookByCode);
      const segmentId = segmentIds[m.segment];
      if (reference && segmentId) library.mentions.push({ sourceId, segmentId, reference, matchedText: m.matchedText });
    }
    const pages = fixture.segments.map((x) => x.pageNumber ?? 0);
    const source: Source & { deleted: boolean } = {
      id: sourceId, title: fixture.title, subtitle: null, author: fixture.author ?? null, publisher: null, edition: null,
      publicationYear: null, isbn: null, doi: null, language: fixture.language ?? null,
      sourceType: fixture.sourceType ?? (format === "pdf" || format === "epub" ? "book" : "notes"),
      licenceStatus: "private", licence: null, notes: null, format, originalFilename: `${fixture.title}.${format}`,
      extractionStatus: format === "pdf" ? "extracted_text" : "digital_text",
      pageCount: format === "pdf" ? Math.max(0, ...pages) : null, segmentCount: fixture.segments.length,
      passageCount: fixture.mentions?.length ?? 0, contentHash: `hash-${fixture.title}`, createdAt: t, updatedAt: t,
      deleted: false, ...extra,
    };
    library.sources.push(source);
    return source;
  };
  const toSummary = (s: Source): SourceSummary => ({
    id: s.id, title: s.title, author: s.author, sourceType: s.sourceType, format: s.format, language: s.language, createdAt: s.createdAt,
  });
  const segmentsOf = (sourceId: string) => library.segments.filter((x) => x.sourceId === sourceId).sort((a, b) => a.position - b.position);
  const window = (sourceId: string, offset: number, limit: number, target: string | null) => {
    const all = segmentsOf(sourceId);
    return { sourceId, total: all.length, offset, segments: all.slice(offset, offset + limit), targetSegmentId: target };
  };
  const mention = (m: (typeof library.mentions)[number]): PassageMention => {
    const source = liveSource(m.sourceId);
    const segment = find(library.segments, m.segmentId, "segment");
    return { sourceId: source.id, sourceTitle: source.title, author: source.author, segmentId: m.segmentId, locator: segment.locator, matchedText: m.matchedText, reference: m.reference };
  };
  const citationFor = (findingId: string, segmentId: string): FindingCitation => {
    const segment = find(library.segments, segmentId, "passage");
    const source = liveSource(segment.sourceId);
    return { id: id(), findingId, sourceId: source.id, segmentId, title: source.title, author: source.author, locator: segment.locator, removed: false };
  };

  const api: MemoryApi = {
    state,
    appInfo: async () => state.info,
    logError: async () => undefined,
    workspaceGetDefault: async () => state.workspace,
    projectList: async (workspaceId) =>
      state.projects
        .filter((p) => p.workspaceId === workspaceId)
        .map(withCount)
        .sort((a, b) => a.title.localeCompare(b.title)),
    projectGet: async (key) => withCount(find(state.projects, key, "project")),
    projectCreate: async (input) => {
      const t = now();
      const project: Project = {
        id: id(),
        workspaceId: input.workspaceId,
        title: requireTitle(input.title, "project"),
        description: input.description ?? null,
        studyCount: 0,
        createdAt: t,
        updatedAt: t,
        revision: 1,
      };
      state.projects.push(project);
      return project;
    },
    projectUpdate: async (input) => {
      const project = find(state.projects, input.id, "project");
      if (input.title !== undefined) project.title = requireTitle(input.title, "project");
      project.revision += 1;
      return withCount(project);
    },
    studyList: async ({ projectId, studyType, status }) =>
      state.studies
        .filter((st) => (!projectId || st.projectId === projectId) && (!studyType || st.studyType === studyType) && (!status || st.status === status))
        .map(summary),
    studyGet: async (key) => detail(key),
    studyCreate: async (input) => {
      find(state.projects, input.projectId, "project");
      const title = requireTitle(input.title, "study");
      const studyType = input.studyType ?? "passage";
      const template = input.templateId
        ? find(state.templates, input.templateId, "template")
        : state.templates.find((t) => t.isBuiltin && t.studyType === studyType) ?? null;
      const primary = input.primaryPassage ? refFromCanonical(input.primaryPassage, bookByCode) : null;
      const t = now();
      const study: Study = {
        id: id(), projectId: input.projectId, templateId: template?.id ?? null, title, studyType, status: "active",
        description: input.description ?? null, details: {}, createdAt: t, updatedAt: t, revision: 1,
      };
      state.studies.push(study);
      (template?.sections ?? [{ title: "Notes" }]).forEach((section, position) => addSection(study.id, section, position));
      if (primary) state.passages.push({ id: id(), studyId: study.id, reference: primary, role: "primary", createdAt: t });
      return detail(study.id);
    },
    studyUpdate: async (input) => {
      const study = find(state.studies, input.id, "study");
      if (input.title !== undefined) study.title = requireTitle(input.title, "study");
      if (input.status) study.status = input.status;
      if (input.studyType) study.studyType = input.studyType;
      if (input.description !== undefined) study.description = input.description || null;
      if (input.details) study.details = input.details;
      study.revision += 1;
      study.updatedAt = now();
      return { ...study };
    },
    studyDuplicate: async ({ studyId, includeContent }) => {
      const original = find(state.studies, studyId, "study");
      const t = now();
      const copy: Study = { ...original, id: id(), title: `${original.title} (copy)`, status: "active", createdAt: t, updatedAt: t, revision: 1 };
      state.studies.push(copy);
      for (const section of sectionsOf(studyId)) {
        const newId = addSection(copy.id, section, section.position);
        if (includeContent) {
          state.blocks = state.blocks.filter((b) => b.sectionId !== newId);
          for (const block of section.blocks) state.blocks.push({ ...block, id: id(), sectionId: newId });
        }
      }
      if (includeContent) {
        for (const f of state.findings.filter((x) => x.studyId === studyId)) state.findings.push({ ...f, id: id(), studyId: copy.id, sectionId: null });
        for (const p of state.passages.filter((x) => x.studyId === studyId)) state.passages.push({ ...p, id: id(), studyId: copy.id });
      }
      return detail(copy.id);
    },
    studySearch: async (query) => {
      const needle = query.toLowerCase();
      const hits: StudySearchHit[] = [];
      const mark = (text: string) => {
        const i = text.toLowerCase().indexOf(needle);
        return `${text.slice(0, i)}\u0002${text.slice(i, i + needle.length)}\u0003${text.slice(i + needle.length)}`;
      };
      for (const st of state.studies) {
        const base = { studyId: st.id, studyTitle: st.title, projectId: st.projectId };
        if (st.title.toLowerCase().includes(needle)) hits.push({ ...base, kind: "study", location: "Title or purpose", sectionKey: null, sectionTitle: null, findingType: null, snippet: mark(st.title) });
        for (const f of state.findings.filter((x) => x.studyId === st.id && x.content.toLowerCase().includes(needle))) {
          hits.push({ ...base, kind: "finding", location: "Finding", sectionKey: null, sectionTitle: null, findingType: f.findingType, snippet: mark(f.content) });
        }
        for (const section of sectionsOf(st.id)) {
          for (const b of section.blocks.filter((x) => x.content.toLowerCase().includes(needle))) {
            hits.push({ ...base, kind: "block", location: section.title, sectionKey: section.key, sectionTitle: section.title, findingType: null, snippet: mark(b.content) });
          }
        }
      }
      return hits;
    },
    studySectionList: async (studyId) => sectionsOf(studyId),
    studySectionUpdate: async (input) => {
      const section = find(state.sections, input.id, "section");
      if (input.title !== undefined) section.title = requireTitle(input.title, "section");
      if (input.guidance !== undefined) section.guidance = input.guidance || null;
      return { ...section, blocks: state.blocks.filter((b) => b.sectionId === section.id) };
    },
    studySectionCreate: async ({ studyId, title, guidance }) => {
      const sectionId = addSection(studyId, { title: requireTitle(title, "section"), guidance }, sectionsOf(studyId).length);
      touch(studyId);
      const section = find(state.sections, sectionId, "section");
      return { ...section, blocks: state.blocks.filter((b) => b.sectionId === sectionId) };
    },
    studySectionDelete: async ({ id: sectionId, force }) => {
      const section = find(state.sections, sectionId, "section");
      const hasContent =
        state.blocks.some((b) => b.sectionId === sectionId && b.content.trim()) ||
        state.findings.some((f) => f.sectionId === sectionId);
      if (hasContent && !force) throw new ApiError("conflict", `“${section.title}” still has writing or findings in it.`);
      state.sections = state.sections.filter((x) => x.id !== sectionId);
      state.blocks = state.blocks.filter((b) => b.sectionId !== sectionId);
      for (const f of state.findings) if (f.sectionId === sectionId) f.sectionId = null;
    },
    studySectionReorder: async ({ parentId, ids }) => {
      ids.forEach((sectionId, position) => {
        find(state.sections, sectionId, "section").position = position;
      });
      return sectionsOf(parentId);
    },
    studyBlockReorder: async ({ parentId, ids }) => {
      ids.forEach((blockId, position) => {
        find(state.blocks, blockId, "block").position = position;
      });
      return state.blocks.filter((b) => b.sectionId === parentId).sort((a, b) => a.position - b.position);
    },

    findingList: async (studyId) =>
      state.findings.filter((f) => f.studyId === studyId).sort((a, b) => a.sortOrder - b.sortOrder),
    findingCreate: async (input) => {
      find(state.studies, input.studyId, "study");
      const t = now();
      const passage = input.passage ? refFromCanonical(input.passage, bookByCode) : null;
      const finding: Finding = {
        id: id(), studyId: input.studyId, sectionId: input.sectionId ?? null, findingType: input.findingType,
        content: input.content ?? "", sortOrder: state.findings.filter((f) => f.studyId === input.studyId).length,
        parentId: null, passages: passage ? [{ id: id(), reference: passage }] : [], tags: [], sources: [],
        createdAt: t, updatedAt: t, revision: 1,
      };
      state.findings.push(finding);
      touch(input.studyId);
      return finding;
    },
    findingUpdate: async (input) => {
      const finding = find(state.findings, input.id, "finding");
      if (input.findingType) finding.findingType = input.findingType;
      if (input.content !== undefined) finding.content = input.content;
      if (input.sectionId !== undefined) finding.sectionId = input.sectionId || null;
      finding.revision += 1;
      return { ...finding };
    },
    findingDelete: async (findingId) => {
      state.findings = state.findings.filter((f) => f.id !== findingId);
    },
    findingReorder: async ({ parentId, ids }) => {
      ids.forEach((findingId, position) => {
        find(state.findings, findingId, "finding").sortOrder = position;
      });
      return state.findings.filter((f) => f.studyId === parentId).sort((a, b) => a.sortOrder - b.sortOrder);
    },
    findingLinkPassage: async ({ findingId, reference }) => {
      const finding = find(state.findings, findingId, "finding");
      const ref = refFromCanonical(reference, bookByCode);
      if (!ref) throw new ApiError("invalidReference", "Invalid reference.");
      if (!finding.passages.some((p) => p.reference.canonical === reference)) finding.passages.push({ id: id(), reference: ref });
      return { ...finding };
    },
    findingUnlinkPassage: async (passageId) => {
      const finding = state.findings.find((f) => f.passages.some((p) => p.id === passageId));
      if (!finding) throw new ApiError("notFound", "This passage could not be found.");
      finding.passages = finding.passages.filter((p) => p.id !== passageId);
      return { ...finding };
    },
    findingSetTags: async ({ findingId, tags }) => {
      const finding = find(state.findings, findingId, "finding");
      finding.tags = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort();
      return { ...finding };
    },

    studyRelationList: async (studyId) =>
      state.relations
        .filter((r) => r.from === studyId || r.to === studyId)
        .map((r) => {
          const other = find(state.studies, r.from === studyId ? r.to : r.from, "study");
          return {
            id: r.id, relationType: r.relationType, direction: r.from === studyId ? "outgoing" : "incoming", note: null,
            other: { id: other.id, projectId: other.projectId, title: other.title, studyType: other.studyType }, createdAt: r.createdAt,
          };
        }),
    studyRelationCreate: async ({ fromStudyId, toStudyId, relationType }) => {
      if (fromStudyId === toStudyId) throw new ApiError("invalidInput", "A study can’t be linked to itself.");
      if (state.relations.some((r) => (r.from === fromStudyId && r.to === toStudyId) || (r.from === toStudyId && r.to === fromStudyId))) {
        throw new ApiError("conflict", "This study is already linked.");
      }
      const relation = { id: id(), from: fromStudyId, to: toStudyId, relationType, createdAt: now() };
      state.relations.push(relation);
      const other = find(state.studies, toStudyId, "study");
      return {
        id: relation.id, relationType, direction: "outgoing", note: null,
        other: { id: other.id, projectId: other.projectId, title: other.title, studyType: other.studyType }, createdAt: relation.createdAt,
      };
    },
    studyRelationDelete: async (relationId) => {
      state.relations = state.relations.filter((r) => r.id !== relationId);
    },

    templateList: async () => [...state.templates],
    templateCreate: async (input) => {
      if (input.sections.length === 0) throw new ApiError("invalidInput", "A template needs at least one section.");
      const t = now();
      const template: StudyTemplate = {
        id: id(), key: `user-${counter}`, name: requireTitle(input.name, "template"), description: input.description ?? null,
        studyType: input.studyType, isBuiltin: false,
        sections: input.sections.map((sec) => ({ ...sec, title: requireTitle(sec.title, "section") })),
        createdAt: t, updatedAt: t, revision: 1,
      };
      state.templates.push(template);
      return template;
    },
    templateUpdate: async (input) => {
      const template = userTemplate(input.id);
      template.name = requireTitle(input.name, "template");
      template.description = input.description ?? null;
      template.studyType = input.studyType;
      template.sections = input.sections.map((sec) => ({ ...sec, title: requireTitle(sec.title, "section") }));
      template.revision += 1;
      return { ...template };
    },
    templateDuplicate: async (templateId) => {
      const original = find(state.templates, templateId, "template");
      return api.templateCreate({
        name: `${original.name} (copy)`, description: original.description ?? undefined,
        studyType: original.studyType, sections: original.sections.map((sec) => ({ ...sec })),
      });
    },
    templateDelete: async (templateId) => {
      userTemplate(templateId);
      state.templates = state.templates.filter((t) => t.id !== templateId);
    },
    studyBlockCreate: async (input) => {
      find(state.sections, input.sectionId, "section");
      const t = now();
      const block: StudyBlock = {
        id: id(),
        sectionId: input.sectionId,
        blockType: input.blockType,
        position: state.blocks.filter((b) => b.sectionId === input.sectionId).length,
        content: input.content ?? "",
        createdAt: t,
        updatedAt: t,
        revision: 1,
      };
      state.blocks.push(block);
      return block;
    },
    studyBlockUpdate: async (input) => {
      const block = find(state.blocks, input.id, "block");
      if (input.content !== undefined) block.content = input.content;
      block.revision += 1;
      return { ...block };
    },
    studyBlockDelete: async (key) => {
      find(state.blocks, key, "block");
      state.blocks = state.blocks.filter((b) => b.id !== key);
    },
    settingsGet: async () => ({ ...state.settings }),
    settingsUpdate: async (input) => {
      if (input.theme) state.settings.theme = input.theme;
      if (input.scriptureTranslationId !== undefined)
        state.settings.scriptureTranslationId = input.scriptureTranslationId || null;
      if (input.scripturePassage !== undefined) state.settings.scripturePassage = input.scripturePassage || null;
      return { ...state.settings };
    },

    scriptureBooks: async () => BOOKS,
    scriptureGetChapter: async ({ translationId, book, chapter }) => {
      const info = bookByCode.get(book);
      const text = state.text.get(translationId);
      if (!text) throw new ApiError("notFound", "This Bible could not be found. It may have been deleted.");
      if (!info) throw new ApiError("invalidReference", "Unknown book.");
      return {
        translationId,
        book,
        bookName: info.name,
        chapter,
        chapterCount: info.chapterCount,
        superscription: book === "PSA" && chapter === 23 ? "Fixture psalm title." : null,
        verses: text.get(`${book}|${chapter}`) ?? [],
      };
    },
    scriptureGetPassage: async ({ translationId, reference }) => {
      const ref = refFromCanonical(reference, bookByCode);
      if (!ref) throw new ApiError("invalidReference", "Invalid reference.");
      const verses = [...(state.text.get(translationId)?.values() ?? [])]
        .flat()
        .filter((v) => contains(ref, v.canonical.split(".")[0] ?? "", v.chapter, v.verse));
      return { translationId, reference: ref, verses };
    },
    scriptureSearch: async ({ query, translationId, book }) => {
      const needle = query.replace(/"/g, "").trim().toLowerCase();
      if (!needle) throw new ApiError("invalidInput", "Type a word or phrase to search for.");
      const hits = state.bibles
        .filter((b) => !translationId || b.id === translationId)
        .flatMap((b) =>
          [...(state.text.get(b.id)?.values() ?? [])].flat().flatMap((v) => {
            const code = v.canonical.split(".")[0] ?? "";
            if ((book && code !== book) || !v.text.toLowerCase().includes(needle)) return [];
            const reference = refFromCanonical(v.canonical, bookByCode);
            return reference ? [{ reference, translationId: b.id, translationShortName: b.shortName, text: v.text }] : [];
          }),
        );
      return { hits, truncated: false };
    },
    referenceParse: async (text) => parseForTests(text),
    referenceDetect: async (text) => {
      const found = [];
      for (const match of text.matchAll(/\b(?:John|Romans|Rom|Psalm|Ps) \d+(?::\d+(?:-\d+)?)?/g)) {
        try {
          found.push({ text: match[0], start: match.index, end: match.index + match[0].length, reference: parseForTests(match[0]) });
        } catch {
          // Not a passage; skip, as the native detector does.
        }
      }
      return found;
    },

    bibleList: async () => [...state.bibles].sort((a, b) => a.name.localeCompare(b.name)),
    bibleBundledList: async () => [
      { id: "engwebp", name: "World English Bible", shortName: "WEB", language: "English", licenseType: "Public Domain", installed: state.bibles.some((b) => b.isBuiltin) },
    ],
    chooseBibleFiles: async () => state.nextChosenFiles,
    bibleImportPreview: async ({ bundled, paths }) => {
      if (paths?.some((p) => p.endsWith(".pdf"))) {
        throw new ApiError("unsupportedFormat", "PDF files can’t be imported as a structured Bible yet.");
      }
      const result = preview(!!bundled, !!paths?.some((p) => p.includes("broken")));
      state.pendingPreview = { id: result.previewId, bundled: !!bundled };
      return result;
    },
    bibleImportCommit: async (input) => {
      if (state.pendingPreview?.id !== input.previewId) throw new ApiError("invalidInput", "This import has expired.");
      const bundled = state.pendingPreview.bundled;
      const bible = addBible(
        {
          name: input.name,
          shortName: input.shortName,
          language: input.language,
          isBuiltin: bundled,
          sourceOrigin: bundled ? "bundled" : "managed_copy",
          licenseType: input.licenseType ?? null,
        },
        bundled ? "included" : "imported",
      );
      state.pendingPreview = null;
      return bible;
    },
    bibleImportCancel: async () => {
      state.pendingPreview = null;
    },
    bibleRemove: async (bibleId) => {
      state.bibles = state.bibles.filter((b) => b.id !== bibleId);
      state.text.delete(bibleId);
      for (const a of state.annotations) if (a.translationId === bibleId) a.translationId = null;
    },

    annotationList: async (reference) => {
      const range = refFromCanonical(reference, bookByCode);
      return range ? state.annotations.filter((a) => overlaps(a.reference, range)) : [];
    },
    annotationCreate: async (input) => {
      const reference = refFromCanonical(input.reference, bookByCode);
      if (!reference) throw new ApiError("invalidReference", "Invalid reference.");
      const existing = state.annotations.find((a) => a.kind === input.kind && input.kind !== "note" && a.reference.canonical === input.reference);
      if (existing) return existing;
      const t = now();
      const annotation: Annotation = {
        id: id(),
        reference,
        translationId: input.translationId ?? null,
        kind: input.kind,
        content: input.content ?? "",
        createdAt: t,
        updatedAt: t,
        revision: 1,
      };
      state.annotations.push(annotation);
      return annotation;
    },
    annotationUpdate: async ({ id: annotationId, content }) => {
      const annotation = find(state.annotations, annotationId, "note");
      annotation.content = content;
      annotation.revision += 1;
      return { ...annotation };
    },
    annotationDelete: async (annotationId) => {
      state.annotations = state.annotations.filter((a) => a.id !== annotationId);
    },

    studyPassageList: async (studyId) =>
      state.passages
        .filter((p) => p.studyId === studyId)
        .sort((a, b) => Number(b.role === "primary") - Number(a.role === "primary")),
    studyPassageAdd: async ({ studyId, reference, role }) => {
      const ref = refFromCanonical(reference, bookByCode);
      if (!ref) throw new ApiError("invalidReference", "Invalid reference.");
      const existing = state.passages.find((p) => p.studyId === studyId && p.reference.canonical === reference);
      if (existing) return existing;
      const hasPrimary = state.passages.some((p) => p.studyId === studyId && p.role === "primary");
      const chosen = role ?? (hasPrimary ? "related" : "primary");
      if (chosen === "primary") for (const p of state.passages) if (p.studyId === studyId) p.role = "related";
      const passage: StudyPassage = { id: id(), studyId, reference: ref, role: chosen, createdAt: now() };
      state.passages.push(passage);
      return passage;
    },
    studyPassageSetRole: async ({ id: passageId, role }) => {
      const passage = find(state.passages, passageId, "passage");
      if (role === "primary") for (const p of state.passages) if (p.studyId === passage.studyId) p.role = "related";
      passage.role = role;
      return { ...passage };
    },
    studyPassageRemove: async (passageId) => {
      state.passages = state.passages.filter((p) => p.id !== passageId);
    },
    installFixtureBible: (shortName, wording) => addBible({ name: `Fixture ${shortName}`, shortName }, wording),
    installFixtureSource: (fixture) => addSource(fixture),

    libraryList: async ({ sourceType, language }) =>
      library.sources
        .filter((s) => !s.deleted && (!sourceType || s.sourceType === sourceType) && (!language || s.language === language))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .map(toSummary),
    libraryLanguages: async () =>
      [...new Set(library.sources.filter((s) => !s.deleted && s.language).map((s) => s.language as string))].sort(),
    libraryGetSource: async (sourceId) => ({ ...liveSource(sourceId) }),
    chooseSourceFile: async () => library.nextChosenFile,
    libraryImportPreview: async (path) => {
      if (!/\.(pdf|epub|md|markdown|txt)$/i.test(path)) {
        throw new ApiError("unsupportedFormat", "This kind of file can’t be added to the library. Supported: PDF, EPUB, Markdown (.md) and text (.txt).");
      }
      const fixture = fixtureForPath(path);
      const scanned = fixture.segments.length === 0;
      const hash = `hash-${fixture.title}`;
      const duplicate = library.sources.find((s) => !s.deleted && s.contentHash === hash);
      const preview: SourceImportPreview = {
        previewId: id(), fileName: path.split("/").pop() ?? path, format: fixture.format ?? "pdf",
        suggestedTitle: fixture.title, suggestedAuthor: fixture.author ?? null, suggestedLanguage: fixture.language ?? null,
        suggestedPublisher: null, suggestedIsbn: null, suggestedType: "book",
        pageCount: fixture.format === "pdf" ? (scanned ? 12 : 3) : null, chapterCount: fixture.format === "epub" ? 2 : fixture.format === "markdown" ? 1 : null,
        segmentCount: fixture.segments.length, referenceCount: fixture.mentions?.length ?? 0,
        extractionStatus: scanned ? "ocr_required" : "extracted_text",
        problem: scanned ? "This PDF appears to contain scanned pages. OCR support is not available yet." : null,
        problemCode: scanned ? "library.scannedPdf" : null,
        duplicateOf: duplicate ? { id: duplicate.id, title: duplicate.title } : null,
        canImport: !scanned,
      };
      library.pending = { preview, fixture };
      return preview;
    },
    libraryImportCommit: async (input) => {
      const pending = library.pending;
      if (pending?.preview.previewId !== input.previewId) throw new ApiError("invalidInput", "This import has expired. Please choose the file again.");
      if (pending.preview.duplicateOf && !input.allowDuplicate) {
        throw new ApiError("conflict", `This file is already in your library as “${pending.preview.duplicateOf.title}”.`);
      }
      const title = requireTitle(input.title, "source");
      const source = addSource(
        { ...pending.fixture, title, author: input.author, language: input.language, sourceType: input.sourceType },
        { licenceStatus: input.licenceStatus ?? "private", originalFilename: pending.preview.fileName, contentHash: `hash-${pending.fixture.title}` },
      );
      library.pending = null;
      return source;
    },
    libraryImportCancel: async () => {
      library.pending = null;
    },
    libraryRemoveSource: async (sourceId) => {
      const source = liveSource(sourceId);
      source.deleted = true;
      library.segments = library.segments.filter((x) => x.sourceId !== sourceId);
      library.mentions = library.mentions.filter((m) => m.sourceId !== sourceId);
      for (const f of state.findings) {
        for (const c of f.sources) if (c.sourceId === sourceId) Object.assign(c, { removed: true, segmentId: null });
      }
    },
    librarySearch: async ({ query, offset = 0 }) => {
      const words = query.toLowerCase().replace(/["“”]/g, "").split(/\s+/).filter(Boolean);
      const matches = library.segments.filter((x) => words.every((w) => x.text.toLowerCase().includes(w)));
      const hits: LibraryHit[] = matches.slice(offset, offset + 50).map((x) => {
        const source = liveSource(x.sourceId);
        let snippet = x.text;
        for (const w of words) snippet = snippet.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i"), "\u0002$1\u0003");
        return { sourceId: source.id, sourceTitle: source.title, author: source.author, segmentId: x.id, position: x.position, pageNumber: x.pageNumber, locator: x.locator, snippet };
      });
      return { hits, offset, hasMore: matches.length > offset + 50 };
    },
    libraryOpenSegment: async (segmentId) => {
      const segment = find(library.segments, segmentId, "passage");
      const limit = 150;
      const offset = Math.max(0, segment.position - Math.floor(limit / 3));
      return window(segment.sourceId, offset, limit, segmentId);
    },
    sourceGetSegments: async ({ sourceId, offset = 0, limit = 150 }) => {
      liveSource(sourceId);
      return window(sourceId, offset, limit, null);
    },
    sourceGetPassages: async (sourceId) => library.mentions.filter((m) => m.sourceId === sourceId).map(mention),
    librarySourcesForPassage: async (reference) => {
      const range = refFromCanonical(reference, bookByCode);
      return range ? library.mentions.filter((m) => overlaps(m.reference, range)).map(mention) : [];
    },
    findingSourceAdd: async ({ findingId, segmentId }) => {
      const finding = find(state.findings, findingId, "finding");
      if (!finding.sources.some((c) => c.segmentId === segmentId)) finding.sources.push(citationFor(findingId, segmentId));
      return { ...finding };
    },
    findingSourceRemove: async (citationId) => {
      const finding = state.findings.find((f) => f.sources.some((c) => c.id === citationId));
      if (!finding) throw new ApiError("notFound", "This citation could not be found.");
      finding.sources = finding.sources.filter((c) => c.id !== citationId);
      return { ...finding };
    },
  };
  return api;
}
