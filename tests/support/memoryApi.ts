// An in-memory implementation of the native API for interface tests.
// It mirrors the behaviour the Rust layer guarantees (validation messages,
// template sections, soft delete), not its storage.
import template from "../../resources/templates/passage-study.json";
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
    pendingPreview: { id: string; bundled: boolean } | null;
  };
  /** Installs a fixture Bible directly (test setup). */
  installFixtureBible(shortName: string, wording: string): BibleTranslation;
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
      ...(broken ? [{ severity: "error" as const, book: "JHN", chapter: 15, message: "John 15:1 appears twice." }] : []),
      { severity: "warning", book: "JHN", chapter: null, message: "John: 3 of 21 chapters found (missing: 1, 2, 3 and 15 more)." },
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
    studyList: async (projectId) => state.studies.filter((s) => s.projectId === projectId),
    studyGet: async (key) => detail(key),
    studyCreate: async (input) => {
      find(state.projects, input.projectId, "project");
      const t = now();
      const study: Study = {
        id: id(),
        projectId: input.projectId,
        templateId: null,
        title: requireTitle(input.title, "study"),
        createdAt: t,
        updatedAt: t,
        revision: 1,
      };
      state.studies.push(study);
      template.sections.forEach((s, position) => {
        const sectionId = id();
        state.sections.push({
          id: sectionId,
          studyId: study.id,
          key: s.key,
          title: s.title,
          guidance: s.guidance,
          position,
          blocks: [],
          createdAt: t,
          updatedAt: t,
          revision: 1,
        });
        state.blocks.push({
          id: id(),
          sectionId,
          blockType: "paragraph",
          position: 0,
          content: "",
          createdAt: t,
          updatedAt: t,
          revision: 1,
        });
      });
      return detail(study.id);
    },
    studyUpdate: async (input) => {
      const study = find(state.studies, input.id, "study");
      if (input.title !== undefined) study.title = requireTitle(input.title, "study");
      study.revision += 1;
      return { ...study };
    },
    studySectionList: async (studyId) => sectionsOf(studyId),
    studySectionUpdate: async (input) => {
      const section = find(state.sections, input.id, "section");
      if (input.title !== undefined) section.title = requireTitle(input.title, "section");
      return { ...section, blocks: state.blocks.filter((b) => b.sectionId === section.id) };
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

    studyPassageList: async (studyId) => state.passages.filter((p) => p.studyId === studyId),
    studyPassageAdd: async ({ studyId, reference }) => {
      const ref = refFromCanonical(reference, bookByCode);
      if (!ref) throw new ApiError("invalidReference", "Invalid reference.");
      const existing = state.passages.find((p) => p.studyId === studyId && p.reference.canonical === reference);
      if (existing) return existing;
      const passage: StudyPassage = { id: id(), studyId, reference: ref, createdAt: now() };
      state.passages.push(passage);
      return passage;
    },
    studyPassageRemove: async (passageId) => {
      state.passages = state.passages.filter((p) => p.id !== passageId);
    },
    installFixtureBible: (shortName, wording) => addBible({ name: `Fixture ${shortName}`, shortName }, wording),
  };
  return api;
}
