// An in-memory implementation of the native API for interface tests.
// It mirrors the behaviour the Rust layer guarantees (validation messages,
// template sections, soft delete), not its storage.
import biblicalTheology from "../../resources/templates/biblical-theology-study.json";
import passageStudy from "../../resources/templates/passage-study.json";
import systematicTheology from "../../resources/templates/systematic-theology-study.json";
import teachingStudy from "../../resources/templates/teaching-study.json";
import topicalStudy from "../../resources/templates/topical-study.json";
import wordStudy from "../../resources/templates/word-study.json";
import i18n from "i18next";
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
  AnchorInput,
  Annotation,
  AnnotationAnchor,
  BibleTranslation,
  ImportPreview,
  LemmaResult,
  MorphDescribed,
  MorphScheme,
  ScriptureRef,
  VerseWord,
  StudyPassage,
  VerseText,
  WordReport,
} from "@/types/scripture";
import { contains, refFromCanonical } from "@/lib/scripture";
import type {
  ContentsItem,
  EpubItem,
  EpubStructureItem,
  SourceLink,
  FindingCitation,
  LibraryHit,
  PassageMatchKind,
  PassageMention,
  Source,
  SourceImportPreview,
  SourceSegment,
  SourceSummary,
  SourceAnnotation,
  AnnotationPoint,
  CitationPlace,
  CreateFindingFromSource,
  TextPoint,
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

import { assistantFacts, newTeachingState, teachingApi, type TeachingState } from "./memoryTeaching";
import { inquiryApi, newInquiryState, type InquiryState } from "./memoryInquiry";
import { newPresentationState, presentationApi, type PresentationState } from "./memoryPresentation";
import { newPortabilityState, portabilityApi, type PortabilityState } from "./memoryPortability";

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
  /** Calls to libraryPassageSourceLocations, for tests of lazy loading. */
  libraryLocationsCalls: { sourceId: string; reference: string }[];
  /** Calls to scriptureConcordance, for tests. */
  concordanceCalls: { translationId: string; query: string; mode: string; book?: string }[];
  /** Calls to libraryDetectReferences (how many texts each), for tests of formatted pages. */
  detectCalls: number[];
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
    /** translation id → canonical verse → annotated words (v0.21). */
    words: Map<string, Map<string, VerseWord[]>>;
    annotations: Annotation[];
    passages: StudyPassage[];
    /** What the next "choose files" dialog returns (null = cancelled). */
    nextChosenFiles: string[] | null;
    /** The word annotations the next Bible import preview reports (v0.21). */
    nextPreviewWords: WordReport | null;
    findings: Finding[];
    relations: { id: string; from: string; to: string; relationType: StudyRelation["relationType"]; createdAt: string }[];
    templates: StudyTemplate[];
    pendingPreview: { id: string; bundled: boolean } | null;
    library: {
      /** Removed sources stay (deleted: true) as citation tombstones. */
      sources: (Source & { deleted: boolean })[];
      segments: (SourceSegment & { sourceId: string })[];
      mentions: { sourceId: string; segmentId: string; reference: ScriptureRef; matchedText: string }[];
      /** Links derived from headings: a section's opening place, and the places inside it. */
      links: { sourceId: string; segmentId: string; origin: "section" | "inherited"; reference: ScriptureRef; matchedText: string; heading: string; openerSegmentId: string }[];
      /** What the next "choose a file" dialog returns (null = cancelled). */
      nextChosenFile: string | null;
      /** Web addresses handed to the system browser (never really opened in tests), and whether opening fails. */
      openedLinks: string[];
      openLinkFails: boolean;
      pending: { preview: SourceImportPreview; fixture: SourceFixture } | null;
      /** Source annotations (v0.14); removed ones stay with `deleted`. */
      annotations: (SourceAnnotation & { deleted: boolean })[];
    };
    /** Teaching preparations and the scripted assistant (v0.16). */
    teaching: TeachingState;
    /** Study and research help (v0.20), scripted by the test. */
    inquiry: InquiryState;
    /** Presentations, exports and the audience screen (v0.18). */
    presentation: PresentationState;
    /** Project packages and backups (v0.19). */
    portability: PortabilityState;
  };
  /** Installs a fixture Bible directly (test setup). */
  installFixtureBible(shortName: string, wording: string): BibleTranslation;
  /** Sets one verse's text in an installed fixture Bible (test setup). */
  setVerseText(bibleId: string, canonical: string, text: string): void;
  /**
   * Annotates words of a verse in an installed fixture Bible (test setup,
   * v0.21): each word is found in the verse text in order.
   */
  installFixtureWords(bibleId: string, canonical: string, words: FixtureWord[], scheme?: MorphScheme): void;
  /** Adds a source to the library directly (test setup). */
  installFixtureSource(fixture: SourceFixture): Source;
}

/** An annotated word for a fixture Bible (constructed test data). */
export interface FixtureWord {
  surface: string;
  lemma?: string;
  strong?: string;
  morph?: string;
  described?: MorphDescribed;
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
  /**
   * Sections whose heading names a passage: the segment the section opens on,
   * the passage, the reference as written in the heading, the heading, and the
   * last segment of the section (the segments after the first inherit it).
   */
  sections?: { segment: number; reference: string; matchedText: string; heading: string; through?: number }[];
  /** The contents an EPUB carries (segment targets), as the core would return them. */
  contents?: ContentsItem[];
  /** Generated contents (headings found in the source), as the core would return them for a source without its own. */
  generatedContents?: ContentsItem[];
  /** Links in the text that lead elsewhere in the same source, as the core would return them. */
  links?: SourceLink[];
  /** A formatted view (an EPUB's documents or a DOCX's parts, by id); a source without it has no Original view. */
  formatted?: { kind?: "epub" | "docx"; structure: EpubStructureItem[]; items: Record<string, EpubItem> };
}

/**
 * What a library file "contains" in tests, by path: "scanned" → a PDF with
 * no text layer; ".rtf" → unsupported; anything else → a small PDF.
 */
function fixtureForPath(path: string): SourceFixture {
  const name = path.split("/").pop() ?? path;
  const format = path.endsWith(".epub") ? "epub" : path.endsWith(".docx") ? "docx" : path.endsWith(".md") ? "markdown" : path.endsWith(".txt") ? "text" : "pdf";
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
  galatians: "GAL", gal: "GAL", ephesians: "EPH", eph: "EPH",
  // A few other-language names, as the shared resolver reads them in any interface language.
  johannes: "JHN", joh: "JHN", jean: "JHN", juan: "JHN", "joão": "JHN", "요한복음": "JHN",
};

/**
 * "Jn" as the shared resolver reads it (scripture::resolve): Jonah in
 * Portuguese, John in English, French and Spanish; the Bible's language
 * decides first, then the interface language, then the common reading (John).
 */
const JN_BY_LANGUAGE: Record<string, string> = { pt: "JON", en: "JHN", fr: "JHN", es: "JHN" };

/** A deliberately small stand-in for the native resolver. `languages`: the Bible's, then the interface's. */
function parseForTests(text: string, languages: (string | null | undefined)[] = []): ScriptureRef {
  // Ranges with any ordinary dash, spaced or not, as the core reads them
  // (src-tauri/src/scripture/parser.rs; tests/reference_dashes.rs).
  const match = /^\s*([1-3]?\s?[\p{L}]+)\s*(\d+)(?:[:,](\d+)(?:\s*[-\u2010-\u2014]\s*(\d+)(?::(\d+))?)?)?\s*$/iu.exec(
    text.replace(/(\d+)장\s*(\d+)절/, "$1:$2"),
  );
  const written = (match?.[1] ?? "").toLowerCase();
  const decider = languages.map((l) => l?.split(/[-_]/)[0]).find((l) => l && JN_BY_LANGUAGE[l]);
  // Neither language decides: the common reading (John in three of the four).
  const book = written === "jn" ? (decider ? JN_BY_LANGUAGE[decider] : "JHN") : match ? ALIASES[written] : undefined;
  const info = book ? bookByCode.get(book) : undefined;
  const chapter = Number(match?.[2]);
  if (!match || !book || !info || chapter < 1 || chapter > info.chapterCount) {
    throw new ApiError(
      "invalidReference",
      `“${text.trim()}” is not a passage I recognise. Try a form like “John 15” or “Rom 8:1-17”.`,
    );
  }
  const [v1, n2, v2] = [match[3], match[4], match[5]];
  // "15:1-11" ends at verse 11; "15:1-16:4" at chapter 16, verse 4.
  const canonical = v1
    ? n2
      ? v2
        ? `${book}.${chapter}.${v1}-${book}.${n2}.${v2}`
        : `${book}.${chapter}.${v1}-${book}.${chapter}.${n2}`
      : `${book}.${chapter}.${v1}`
    : `${book}.${chapter}`;
  const ref = refFromCanonical(canonical, bookByCode);
  if (!ref) throw new ApiError("invalidReference", "Invalid reference.");
  return ref;
}

// Concordance, as the core does it (src-tauri/src/scripture/concordance.rs).
const GREEK = /[\u0370-\u03FF\u1F00-\u1FFF]/;
const HEBREW = /[\u0590-\u05FF\uFB1D-\uFB4F]/;
/** The core's lemma folding (concordance::normalize): no marks, lower case, final sigma. */
function lemmaFold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/\u2060|\u200C|\u200D|\u00AD/g, "").toLowerCase().replace(/ς/g, "σ").normalize("NFC");
}

function concordanceForm(token: string): string {
  const lower = token.normalize("NFC").toLowerCase();
  if (GREEK.test(lower)) return lower.normalize("NFD").replace(/\p{M}/gu, "").replace(/ς/g, "σ").normalize("NFC");
  if (HEBREW.test(lower)) return lower.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  return lower;
}
function concordanceTokens(text: string): { start: number; end: number; form: string }[] {
  return [...text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)].map((m) => ({ start: m.index, end: m.index + m[0].length, form: concordanceForm(m[0]) }));
}
function concordanceFind(text: string, wanted: string[]): [number, number][] {
  const toks = concordanceTokens(text);
  const out: [number, number][] = [];
  for (let i = 0; i + wanted.length <= toks.length; ) {
    if (wanted.every((w, k) => toks[i + k]!.form === w)) {
      out.push([toks[i]!.start, toks[i + wanted.length - 1]!.end]);
      i += wanted.length;
    } else i += 1;
  }
  return out;
}

function overlaps(a: ScriptureRef, b: ScriptureRef): boolean {
  if (a.book !== b.book) return false;
  const key = (c: number, v: number) => c * 1000 + v;
  return (
    key(a.startChapter, a.startVerse ?? 0) <= key(b.endChapter, b.endVerse ?? 999) &&
    key(b.startChapter, b.startVerse ?? 0) <= key(a.endChapter, a.endVerse ?? 999)
  );
}

// --- relevance: a port of library/relevance.rs (keep both in step) -------------------------------

type Fit = "exact" | "narrow" | "chapter" | "overlap" | "wide" | "broad";
const FITS: Fit[] = ["exact", "narrow", "chapter", "overlap", "wide", "broad"];
type Context = "neutral" | "about" | "elsewhere";

const loKey = (r: ScriptureRef) => r.startChapter * 1000 + (r.startVerse ?? 0);
const hiKey = (r: ScriptureRef) => r.endChapter * 1000 + (r.endVerse ?? 999);

function kindOf(active: ScriptureRef, link: ScriptureRef): PassageMatchKind | null {
  if (active.book !== link.book) return null;
  const [as, ae, ls, le] = [loKey(active), hiKey(active), loKey(link), hiKey(link)];
  if (!(ls <= ae && le >= as)) return null;
  if (as === ls && ae === le) return "exact";
  if ((ls <= as && le >= ae) || (as <= ls && ae >= le)) return "contained";
  return "overlap";
}

function fitOf(active: ScriptureRef, link: ScriptureRef): Fit | null {
  const kind = kindOf(active, link);
  if (!kind) return null;
  if (kind === "exact") return "exact";
  const [as, ae, ls, le] = [loKey(active), hiKey(active), loKey(link), hiKey(link)];
  if (as <= ls && ae >= le) return "narrow"; // inside the passage
  const chapters = link.endChapter - link.startChapter + 1;
  const wholeStart = ls % 1000 === 0;
  const wholeEnd = le % 1000 === 999;
  const scale = chapters === 1 ? (wholeStart && wholeEnd ? "chapter" : "verses") : chapters === 2 && !wholeStart && !wholeEnd ? "verses" : chapters <= 3 ? "wide" : "broad";
  const encloses = ls <= as && le >= ae;
  if (scale === "broad") return "broad";
  if (scale === "wide") return "wide";
  if (scale === "chapter" && encloses) return "chapter";
  if (scale === "verses" && encloses) return "narrow";
  return "overlap";
}

function contextOf(active: ScriptureRef, sections: ScriptureRef[]): Context {
  if (sections.length === 0) return "neutral";
  const fits = sections.flatMap((s) => {
    const f = fitOf(active, s);
    return f ? [f] : [];
  });
  if (fits.some((f) => FITS.indexOf(f) <= FITS.indexOf("overlap"))) return "about";
  return fits.length > 0 ? "neutral" : "elsewhere";
}

function classOf(origin: "explicit" | "section" | "manual", context: Context, fit: Fit): number {
  if (fit === "broad") return 6;
  if (origin === "explicit" && context === "elsewhere") return 5;
  const about = origin === "section" || context === "about";
  if (origin === "manual") return fit === "wide" ? 4 : 0;
  if (about) return fit === "exact" || fit === "narrow" ? 1 : fit === "chapter" || fit === "overlap" ? 3 : 4;
  return fit === "exact" || fit === "narrow" ? 2 : 4;
}

export function createMemoryApi(overrides: Partial<AppInfo> = {}): MemoryApi {
  const stamp = now();
  const state: MemoryApi["state"] = {
    info: {
      version: "0.1.0",
      updatesEnabled: false,
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
    words: new Map(),
    annotations: [],
    passages: [],
    nextChosenFiles: null,
    nextPreviewWords: null,
    pendingPreview: null,
    library: { sources: [], segments: [], mentions: [], links: [], nextChosenFile: null, openedLinks: [], openLinkFails: false, pending: null, annotations: [] },
    findings: [],
    relations: [],
    teaching: newTeachingState(),
    inquiry: newInquiryState(),
    presentation: newPresentationState(),
    portability: newPortabilityState(),
    templates: BUILTIN_TEMPLATES.map((t) => ({
      id: `tpl-${t.key}`,
      key: t.key,
      name: t.name,
      description: t.description,
      studyType: t.studyType as StudyType,
      isBuiltin: true,
      sections: t.sections as TemplateSection[],
      createdAt: stamp,
      updatedAt: stamp,
      revision: 1,
    })),
  };

  const touch = (studyId: string) => {
    const study = state.studies.find((s) => s.id === studyId);
    if (study) study.updatedAt = now();
  };
  const requireDistinctKeys = (sections: TemplateSection[]) => {
    const keys = sections.map((sec) => sec.key?.trim()).filter(Boolean);
    if (new Set(keys).size !== keys.length) throw new ApiError("invalidInput", "Two parts of the template are the same part. Remove one of them.");
  };
  const addSection = (studyId: string, section: TemplateSection, position: number) => {
    const t = now();
    const sectionId = id();
    state.sections.push({
      id: sectionId, studyId, key: section.key ?? null, title: section.title, guidance: section.guidance ?? null, phase: section.phase ?? null,
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

  /** Every annotated word of a Bible, or the core's refusal when it has none. */
  const annotatedWords = (translationId: string): VerseWord[] => {
    const bible = state.bibles.find((b) => b.id === translationId);
    if (!bible) throw new ApiError("notFound", "This Bible could not be found.");
    if (!bible.words) {
      throw new ApiError("invalidInput", "This Bible has no word annotations (lemmas or grammar), so this search is not available for it. The ordinary concordance still works.", "words.unavailable");
    }
    return [...(state.words.get(translationId)?.values() ?? [])].flat();
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
  // Phrase anchors, as the core builds them: the selected part of each
  // covered verse joined with one space; drawn only where the covered
  // verses' text is identical (the core compares hashes).
  const anchorTexts = new Map<string, string[]>();
  const coveredVerses = (translationId: string, start: string, end: string) => {
    const [book, chapter, from] = start.split(".");
    const [endBook, endChapter, to] = end.split(".");
    if (book !== endBook || chapter !== endChapter) {
      throw new ApiError("invalidInput", "A marked phrase must stay within one chapter.");
    }
    const verses = state.text.get(translationId)?.get(`${book}|${chapter}`) ?? [];
    return { book, chapter, from: Number(from), to: Number(to), verses: verses.filter((v) => v.verse >= Number(from) && v.verse <= Number(to)) };
  };
  const resolveAnchor = (input: AnchorInput) => {
    const bible = state.bibles.find((b) => b.id === input.translationId);
    if (!bible) throw new ApiError("notFound", "This Bible could not be found. It may have been deleted.");
    const { book, chapter, from, to, verses } = coveredVerses(input.translationId, input.start.verse, input.end.verse);
    const mismatch = new ApiError("invalidInput", "The selected words do not match the text of this translation.");
    if (verses[0]?.verse !== from || verses[verses.length - 1]?.verse !== to) throw mismatch;
    const parts = verses.map((v) => {
      const a = v.verse === from ? input.start.offset : 0;
      const b = v.verse === to ? input.end.offset : v.text.length;
      if (a > b || b > v.text.length) throw mismatch;
      return v.text.slice(a, b);
    });
    const quote = parts.filter(Boolean).join(" ");
    if (quote !== input.quote || !quote.trim()) throw mismatch;
    const anchor: AnnotationAnchor = {
      start: input.start,
      end: input.end,
      quote,
      translationShortName: bible.shortName,
      shown: true,
    };
    const reference = from === to ? `${book}.${chapter}.${from}` : `${book}.${chapter}.${from}-${book}.${chapter}.${to}`;
    return { anchor, reference, texts: verses.map((v) => v.text) };
  };
  const wordingMatches = (annotationId: string, translationId: string | undefined) => {
    const annotation = state.annotations.find((a) => a.id === annotationId);
    const saved = anchorTexts.get(annotationId);
    if (!translationId || !annotation?.anchor || !saved) return false;
    const { verses } = coveredVerses(translationId, annotation.anchor.start.verse, annotation.anchor.end.verse);
    return verses.length === saved.length && verses.every((v, i) => v.text === saved[i]);
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
  const contentsOf = new Map<string, ContentsItem[]>();
  const generatedOf = new Map<string, ContentsItem[]>();
  const linksOf = new Map<string, SourceLink[]>();
  const formattedOf = new Map<string, NonNullable<SourceFixture["formatted"]>>();
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
    for (const s of fixture.sections ?? []) {
      const reference = refFromCanonical(s.reference, bookByCode);
      const opener = segmentIds[s.segment];
      if (!reference || !opener) continue;
      library.links.push({ sourceId, segmentId: opener, origin: "section", reference, matchedText: s.matchedText, heading: s.heading, openerSegmentId: opener });
      for (let i = s.segment + 1; i <= (s.through ?? s.segment); i++) {
        const inside = segmentIds[i];
        if (inside) library.links.push({ sourceId, segmentId: inside, origin: "inherited", reference, matchedText: s.matchedText, heading: s.heading, openerSegmentId: opener });
      }
    }
    const pages = fixture.segments.map((x) => x.pageNumber ?? 0);
    const source: Source & { deleted: boolean } = {
      id: sourceId, title: fixture.title, subtitle: null, author: fixture.author ?? null, publisher: null, edition: null,
      publicationYear: null, isbn: null, doi: null, language: fixture.language ?? null,
      sourceType: fixture.sourceType ?? (format === "pdf" || format === "epub" ? "book" : format === "docx" ? "document" : "notes"),
      licenceStatus: "private", licence: null, notes: null, format, originalFilename: `${fixture.title}.${format}`,
      extractionStatus: format === "pdf" ? "extracted_text" : "digital_text",
      pageCount: format === "pdf" ? Math.max(0, ...pages) : null,
      originalView: format === "pdf" ? { kind: "pdf" } : fixture.formatted ? { kind: fixture.formatted.kind ?? "epub" } : null, segmentCount: fixture.segments.length,
      passageCount: fixture.mentions?.length ?? 0, contentHash: `hash-${fixture.title}`, createdAt: t, updatedAt: t,
      deleted: false, ...extra,
    };
    library.sources.push(source);
    if (fixture.contents) contentsOf.set(sourceId, fixture.contents);
    if (fixture.generatedContents) generatedOf.set(sourceId, fixture.generatedContents);
    if (fixture.links) linksOf.set(sourceId, fixture.links);
    if (fixture.formatted) formattedOf.set(sourceId, fixture.formatted);
    return source;
  };
  const toSummary = (s: Source): SourceSummary => ({
    id: s.id, title: s.title, author: s.author, sourceType: s.sourceType, format: s.format, language: s.language, createdAt: s.createdAt,
  });
  const segmentsOf = (sourceId: string) => library.segments.filter((x) => x.sourceId === sourceId).sort((a, b) => a.position - b.position);
  // Stands in for a PDF file (the tests' viewer is a fake engine; nothing parses these bytes).
  const originalBytes = new TextEncoder().encode("%PDF-1.4 synthetic test file");
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
    return { id: id(), findingId, sourceId: source.id, segmentId, title: source.title, author: source.author, locator: segment.locator, removed: false,
        unavailable: false, quote: null, section: segment.sectionPath, annotationId: null };
  };
  // Where each v0.15 citation was (the core keeps this as its anchor), for opening it again.
  const citationPlaces = new Map<string, { words: CitationPlace["words"]; segmentId: string | null; page: number | null; fraction: number | null }>();

  // Mirrors db::library::passage_sources and library/relevance.rs: rank = (class, origin, fit,
  // closeness); a mention's class reads the headings of the section it lies in; links that share no
  // verse are not offered; one place per segment; places consolidated per section; sources by best
  // place, then "about the passage", then title. `all` is every place (the expanded list).
  const rankedSources = (reference: string) => {
      const active = refFromCanonical(reference, bookByCode);
      if (!active) return [];
      const width = (r: ScriptureRef) => hiKey(r) - loKey(r);
      type Place = { sourceId: string; segmentId: string; origin: "explicit" | "section"; reference: ScriptureRef; matchedText: string; heading: string | null };
      const places: Place[] = [
        ...library.mentions.map((m) => ({ sourceId: m.sourceId, segmentId: m.segmentId, origin: "explicit" as const, reference: m.reference, matchedText: m.matchedText, heading: null as string | null })),
        ...library.links.filter((l) => l.origin === "section").map((l) => ({ sourceId: l.sourceId, segmentId: l.segmentId, origin: "section" as const, reference: l.reference, matchedText: l.matchedText, heading: l.heading as string | null })),
      ];
      const sectionLinksOf = (segmentId: string) => library.links.filter((l) => l.segmentId === segmentId);
      const openerOf = (p: Place) => (p.origin === "section" ? p.segmentId : (sectionLinksOf(p.segmentId).at(-1)?.openerSegmentId ?? p.segmentId));
      const scored = places.flatMap((p) => {
        const kind = kindOf(active, p.reference);
        const fit = fitOf(active, p.reference);
        const source = library.sources.find((s) => s.id === p.sourceId && !s.deleted);
        if (!kind || !fit || !source) return [];
        const context = p.origin === "explicit" ? contextOf(active, sectionLinksOf(p.segmentId).map((l) => l.reference)) : "neutral";
        const rank = [classOf(p.origin, context, fit), p.origin === "section" ? 1 : 2, FITS.indexOf(fit), Math.abs(width(active) - width(p.reference))];
        return [{ ...p, kind, fit, source, rank, opener: openerOf(p), position: library.segments.find((x) => x.id === p.segmentId)?.position ?? 0 }];
      });
      type Scored = (typeof scored)[number];
      const order = (a: Scored, b: Scored) => {
        for (let i = 0; i < 4; i++) if (a.rank[i] !== b.rank[i]) return a.rank[i]! - b.rank[i]!;
        return 0;
      };
      const bySource = new Map<string, Scored[]>();
      for (const p of scored) bySource.set(p.sourceId, [...(bySource.get(p.sourceId) ?? []), p]);
      return [...bySource.values()]
        .map((list) => {
          // one place per segment, best first
          const best = new Map<string, Scored>();
          for (const p of [...list].sort(order)) if (!best.has(p.segmentId)) best.set(p.segmentId, p);
          const sorted = [...best.values()].sort((a, b) => order(a, b) || a.position - b.position);
          // consolidate within a section: what an earlier, at-least-as-good place already shows is dropped
          const kept: Scored[] = [];
          for (const p of sorted) {
            const redundant = kept.some((k) => k.opener === p.opener && FITS.indexOf(k.fit) <= FITS.indexOf(p.fit) && (k.origin === "section" || k.reference.canonical === p.reference.canonical));
            if (!redundant) kept.push(p);
          }
          const source = kept[0]!.source;
          const about = list.some((p) => p.origin === "section" && p.rank[0]! <= 3);
          return {
            kept,
            about,
            all: kept.map((p) => ({
              segmentId: p.segmentId, locator: find(library.segments, p.segmentId, "segment").locator, origin: p.origin, matchKind: p.kind,
              reference: p.reference, matchedText: p.matchedText, sectionHeading: p.heading,
            })),
            group: {
              sourceId: source.id, sourceTitle: source.title, author: source.author,
              locations: kept.slice(0, 3).map((p) => ({
                segmentId: p.segmentId, locator: find(library.segments, p.segmentId, "segment").locator, origin: p.origin, matchKind: p.kind,
                reference: p.reference, matchedText: p.matchedText, sectionHeading: p.heading,
              })),
              moreLocations: Math.max(0, kept.length - 3),
            },
          };
        })
        .sort((a, b) => order(a.kept[0]!, b.kept[0]!) || Number(b.about) - Number(a.about) || a.group.sourceTitle.localeCompare(b.group.sourceTitle))
        .slice(0, 30);
  };
  const api: MemoryApi = {
    ...presentationApi(state.presentation, { id, now, api: () => api }),
    ...portabilityApi(state.portability, {
      projects: () => state.projects,
      createProject: async (title, description) => {
        const project = await api.projectCreate({ workspaceId: state.workspace.id, title, description: description ?? undefined });
        return project;
      },
      counts: (projectId) => {
        const studies = state.studies.filter((s) => s.projectId === projectId);
        const ids = new Set(studies.map((s) => s.id));
        return {
          studies: studies.length,
          teachings: state.teaching.preparations.filter((p) => ids.has(p.studyId)).length,
          notes: state.findings.filter((f) => ids.has(f.studyId)).length,
        };
      },
      api: () => api,
    }),
    ...teachingApi(state.teaching, {
      id,
      now,
      findings: () => state.findings,
      studyExists: (studyId) => void find(state.studies, studyId, "study"),
      studyPassages: () => state.passages,
      ref: (canonical) => refFromCanonical(canonical, bookByCode),
    }),
    ...inquiryApi(state.inquiry, {
      config: () => state.teaching.assistant.config,
      label: () => assistantFacts(state.teaching).label,
      remote: () => assistantFacts(state.teaching).remote,
      hasKey: () => assistantFacts(state.teaching).hasKey,
      study: (studyId) => find(state.studies, studyId, "study"),
      sections: () => state.sections,
      blocks: () => state.blocks,
      findings: () => state.findings,
      passages: () => state.passages,
      source: (sourceId) => liveSource(sourceId),
      segments: (sourceId) => library.segments.filter((x) => x.sourceId === sourceId).sort((a, b) => a.position - b.position),
      api: () => api,
    }),
    libraryLocationsCalls: [],
    concordanceCalls: [],
    detectCalls: [],
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
      // As the core does: an empty description clears it.
      if (input.description !== undefined) project.description = input.description.trim() ? input.description : null;
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
      // As the core: optional parts are offered later, retired ones are kept only for old studies.
      (template?.sections.filter((sec) => !sec.optional && !sec.retired) ?? [{ title: "Notes" }]).forEach((section, position) => addSection(study.id, section, position));
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
      if (input.phase !== undefined) section.phase = input.phase || null;
      return { ...section, blocks: state.blocks.filter((b) => b.sectionId === section.id) };
    },
    studySectionCreate: async ({ studyId, title, guidance, key, phase }) => {
      // As the core: a key is a plain word, and a study never has the same part twice.
      if (key?.trim() && !/^[a-z0-9-]{1,64}$/.test(key.trim())) throw new ApiError("invalidInput", "This part's key is not valid.");
      if (key?.trim() && sectionsOf(studyId).some((sec) => sec.key === key.trim())) throw new ApiError("conflict", "This study already has that part.");
      const sectionId = addSection(studyId, { title: requireTitle(title, "section"), guidance, key: key?.trim() || null, phase: phase ?? null }, sectionsOf(studyId).length);
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
      if (!input.sections.some((sec) => !sec.optional)) throw new ApiError("invalidInput", "A template needs at least one part to start with.");
      requireDistinctKeys(input.sections);
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
      requireDistinctKeys(input.sections);
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
        studyType: original.studyType, sections: original.sections.filter((sec) => !sec.retired).map((sec) => ({ ...sec })),
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
    // As the core (db::bibles::material_passages): only the chosen Bible; a verse it lacks is named.
    materialScripture: async ({ translationId, references }) => {
      const bible = state.bibles.find((b) => b.id === translationId);
      if (!bible) throw new ApiError("notFound", "This Bible is no longer installed.");
      const passages = await Promise.all(
        references.map(async (canonical) => {
          const { reference, verses } = await api.scriptureGetPassage({ translationId, reference: canonical });
          const missing: string[] = [];
          if (reference.startVerse !== null && reference.endVerse !== null && reference.startChapter === reference.endChapter) {
            for (let v = reference.startVerse; v <= reference.endVerse; v++) if (!verses.some((x) => x.chapter === reference.startChapter && x.verse === v)) missing.push(`${reference.startChapter}:${v}`);
          }
          return { canonical, verses, missing };
        }),
      );
      return { translationId, name: bible.name, shortName: bible.shortName, copyrightNotice: bible.copyrightNotice ?? null, passages };
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
    scriptureConcordance: async ({ translationId, query, mode, book }) => {
      api.concordanceCalls.push({ translationId, query, mode, book });
      const wanted = concordanceTokens(query.slice(0, 200)).map((t) => t.form);
      if (wanted.length === 0) throw new ApiError("invalidInput", "Type a word to look for.");
      if (mode === "word" && wanted.length > 1) throw new ApiError("invalidInput", "That is more than one word. Choose Phrase to look for words together.");
      if (!state.bibles.some((b) => b.id === translationId)) throw new ApiError("notFound", "This Bible could not be found.");
      const verses = [...(state.text.get(translationId)?.values() ?? [])].flat().sort((a, b) => {
        const ka = refFromCanonical(a.canonical, bookByCode);
        const kb = refFromCanonical(b.canonical, bookByCode);
        const ord = (r: ScriptureRef | null) => (r ? (bookByCode.get(r.book)?.ordinal ?? 0) * 1e6 + r.startChapter * 1e3 + (r.startVerse ?? 0) : 0);
        return ord(ka) - ord(kb);
      });
      const found = verses.flatMap((v) => {
        const matches = concordanceFind(v.text, wanted);
        const reference = refFromCanonical(v.canonical, bookByCode);
        return matches.length && reference ? [{ reference, text: v.text, matches }] : [];
      });
      const books = new Map<string, { verses: number; occurrences: number }>();
      for (const h of found) {
        const b = books.get(h.reference.book) ?? { verses: 0, occurrences: 0 };
        books.set(h.reference.book, { verses: b.verses + 1, occurrences: b.occurrences + h.matches.length });
      }
      const listed = book ? found.filter((h) => h.reference.book === book) : found.length <= 200 ? found : [];
      return {
        query, mode, translationId,
        verses: found.length,
        occurrences: found.reduce((n, h) => n + h.matches.length, 0),
        books: [...books.entries()].map(([code, c]) => ({ code, name: bookByCode.get(code)?.name ?? code, ...c })),
        hits: listed,
        hitsComplete: Boolean(book) || found.length <= 200,
      };
    },
    scriptureLemmaEntries: async ({ translationId, text }) => {
      const all = annotatedWords(translationId);
      const typed = text.trim();
      if (!typed) throw new ApiError("invalidInput", "Type a lemma or a lexical number to look for.");
      const fold = lemmaFold(typed);
      const found = all.filter((w) => w.lemma === typed || (w.lemma && lemmaFold(w.lemma) === fold) || w.lexicalIds.some((id) => id.toLowerCase() === typed.toLowerCase()));
      const entries = new Map<string, { lemma: string | null; strong: string | null; forms: Map<string, number>; occurrences: number }>();
      for (const w of found) {
        const key = `${w.lemma}|${w.strong}`;
        const e = entries.get(key) ?? { lemma: w.lemma, strong: w.strong, forms: new Map(), occurrences: 0 };
        e.occurrences += 1;
        e.forms.set(w.surface, (e.forms.get(w.surface) ?? 0) + 1);
        entries.set(key, e);
      }
      return [...entries.values()]
        .sort((a, b) => b.occurrences - a.occurrences || String(a.lemma).localeCompare(String(b.lemma)) || String(a.strong).localeCompare(String(b.strong)))
        .map((e) => ({ lemma: e.lemma, strong: e.strong, occurrences: e.occurrences, forms: [...e.forms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f]) => f) }));
    },
    scriptureLemmaSearch: async ({ translationId, selection, morph = [], book }) => {
      const bible = state.bibles.find((b) => b.id === translationId);
      annotatedWords(translationId);
      const verses = [...(state.words.get(translationId)?.entries() ?? [])];
      const selected = (w: VerseWord) =>
        selection.kind === "entry" ? w.lemma === selection.lemma && w.strong === selection.strong
          : selection.kind === "lemma" ? w.lemma === selection.lemma
            : w.lexicalIds.some((id) => id.toLowerCase() === selection.id.trim().toLowerCase());
      const order = (canonical: string) => {
        const r = refFromCanonical(canonical, bookByCode);
        return r ? (bookByCode.get(r.book)?.ordinal ?? 0) * 1e6 + r.startChapter * 1e3 + (r.startVerse ?? 0) : 0;
      };
      verses.sort((a, b) => order(a[0]) - order(b[0]));
      const forms = new Map<string, number>();
      const codes = new Map<string, { count: number; described: MorphDescribed | null }>();
      let withoutMorphology = 0;
      const kept: { canonical: string; words: VerseWord[] }[] = [];
      for (const [canonical, words] of verses) {
        const mine = words.filter(selected);
        for (const w of mine) {
          forms.set(w.surface, (forms.get(w.surface) ?? 0) + 1);
          if (w.morph) codes.set(w.morph, { count: (codes.get(w.morph)?.count ?? 0) + 1, described: w.described });
          else withoutMorphology += 1;
        }
        const filtered = mine.filter((w) => morph.length === 0 || (w.morph !== null && morph.includes(w.morph)));
        if (filtered.length) kept.push({ canonical, words: filtered });
      }
      const books = new Map<string, { verses: number; occurrences: number }>();
      for (const k of kept) {
        const code = k.canonical.split(".")[0] ?? "";
        const b = books.get(code) ?? { verses: 0, occurrences: 0 };
        books.set(code, { verses: b.verses + 1, occurrences: b.occurrences + k.words.length });
      }
      const listed = book ? kept.filter((k) => k.canonical.startsWith(`${book}.`)) : kept.length <= 200 ? kept : [];
      const hits = listed.flatMap((k) => {
        const [code, chapter] = k.canonical.split(".");
        const text = state.text.get(translationId)?.get(`${code}|${Number(chapter)}`)?.find((v) => v.canonical === k.canonical)?.text;
        const reference = refFromCanonical(k.canonical, bookByCode);
        return text && reference ? [{ reference, text, matches: k.words.map((w) => [w.start, w.end] as [number, number]) }] : [];
      });
      const result: LemmaResult = {
        selection, translationId,
        occurrences: kept.reduce((n, k) => n + k.words.length, 0),
        verses: kept.length,
        books: [...books.entries()].map(([code, c]) => ({ code, name: bookByCode.get(code)?.name ?? code, ...c })),
        hits,
        hitsComplete: Boolean(book) || kept.length <= 200,
        forms: [...forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([form, count]) => ({ form, count })),
        morphology: [...codes.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).map(([code, c]) => ({ code, count: c.count, described: bible?.words?.morphScheme === "oshb" ? c.described : null })),
        withoutMorphology,
        morphScheme: bible?.words?.morphScheme ?? "none",
        morphAttribute: bible?.words?.morphAttribute ?? null,
      };
      return result;
    },
    scriptureVerseWords: async ({ translationId, verse }) => {
      const all = annotatedWords(translationId);
      const scheme = state.bibles.find((b) => b.id === translationId)?.words?.morphScheme;
      return (state.words.get(translationId)?.get(verse) ?? []).map((w) => ({
        ...w,
        described: scheme === "oshb" ? w.described : null,
        entryOccurrences: all.filter((o) => o.lemma === w.lemma && o.strong === w.strong).length,
      }));
    },
    referenceParse: async (text, translationId) =>
      parseForTests(text, [state.bibles.find((b) => b.id === translationId)?.languageCode, i18n.language]),
    referenceDetect: async (text) => {
      const found = [];
      for (const match of text.matchAll(/\b(?:John|Romans|Rom|Psalm|Ps) \d+(?::\d+(?:\s*[-\u2010-\u2014]\s*\d+(?::\d+)?)?)?/g)) {
        try {
          found.push({ text: match[0], start: match.index, end: match.index + match[0].length, reference: parseForTests(match[0]) });
        } catch {
          // Not a passage; skip, as the native detector does.
        }
      }
      return found;
    },

    bibleList: async () => [...state.bibles].sort((a, b) => a.name.localeCompare(b.name)),
    // As the core lists them (src-tauri/src/scripture/bundled.rs).
    bibleBundledList: async () =>
      [
        { id: "engbsb", name: "Berean Standard Bible", shortName: "BSB", language: "English", languageCode: "en", licenseType: "Public Domain" },
        { id: "engwebp", name: "World English Bible", shortName: "WEB", language: "English", languageCode: "en", licenseType: "Public Domain" },
        { id: "deu1912", name: "Lutherbibel 1912", shortName: "LUT1912", language: "Deutsch", languageCode: "de", licenseType: "Public Domain" },
        { id: "deu1951", name: "Schlachter-Bibel 1951", shortName: "SCH1951", language: "Deutsch", languageCode: "de", licenseType: "CC BY 4.0" },
        { id: "deuelo", name: "Elberfelder 1905 (unrevidiert)", shortName: "ELB1905", language: "Deutsch", languageCode: "de", licenseType: "Public Domain" },
        { id: "kor1961", name: "성경전서 개역한글판", shortName: "KRV", language: "한국어", languageCode: "ko", licenseType: "Public Domain" },
        { id: "fraLSG", name: "Louis Segond 1910", shortName: "LSG", language: "Français", languageCode: "fr", licenseType: "Public Domain" },
        { id: "spaRV1909", name: "Santa Biblia — Reina Valera 1909", shortName: "RV1909", language: "Español", languageCode: "es", licenseType: "Public Domain" },
        { id: "porbr2018", name: "Bíblia Livre", shortName: "BLIVRE", language: "Português", languageCode: "pt", licenseType: "CC BY 4.0" },
      ].map((b) => ({ ...b, installed: state.bibles.some((i) => i.isBuiltin && i.shortName === b.shortName) })),
    chooseBibleFiles: async () => state.nextChosenFiles,
    bibleImportPreview: async ({ bundled, paths }) => {
      if (paths?.some((p) => p.endsWith(".pdf"))) {
        throw new ApiError("unsupportedFormat", "PDF files can’t be imported as a structured Bible yet.");
      }
      const result = preview(!!bundled, !!paths?.some((p) => p.includes("broken")));
      // As the core reads a DBL metadata.xml or Paratext Settings.xml beside the USFM.
      const tagged = paths?.map((p) => /with-metadata-([a-z-]+)\./i.exec(p)?.[1]).find(Boolean);
      if (tagged) result.suggested = { ...result.suggested, languageCode: tagged };
      if (state.nextPreviewWords) result.words = state.nextPreviewWords;
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
          // As the core: only a tag the person (or the files' metadata) gave.
          languageCode: input.languageCode ?? null,
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
    // As the core (scripture::data_packs): a few of the 100, enough for tests.
    bibleLanguageOptions: async () => [
      { code: "en", name: "English", native: "English" },
      { code: "de", name: "German", native: "Deutsch" },
      { code: "ko", name: "Korean", native: "한국어" },
      { code: "pt", name: "Portuguese", native: "português" },
      { code: "it", name: "Italian", native: "italiano" },
    ],
    bibleSetLanguage: async ({ id: bibleId, language, languageCode }) => {
      const bible = state.bibles.find((b) => b.id === bibleId);
      if (!bible) throw new ApiError("notFound", "Bible not found");
      if (!language.trim()) throw new ApiError("invalidInput", "A language is needed.");
      if (languageCode !== null && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(languageCode.trim())) {
        throw new ApiError("invalidInput", `“${languageCode}” is not a language this app knows.`);
      }
      bible.language = language.trim();
      bible.languageCode = languageCode?.trim() || null;
      return { ...bible };
    },
    bibleRemove: async (bibleId) => {
      state.bibles = state.bibles.filter((b) => b.id !== bibleId);
      state.text.delete(bibleId);
      for (const a of state.annotations) if (a.translationId === bibleId) a.translationId = null;
    },

    annotationList: async (reference, translationId) => {
      const range = refFromCanonical(reference, bookByCode);
      if (!range) return [];
      return state.annotations
        .filter((a) => overlaps(a.reference, range))
        .map((a) => (a.anchor ? { ...a, anchor: { ...a.anchor, shown: wordingMatches(a.id, translationId) } } : a));
    },
    annotationMarksList: async (query) => {
      const key = (r: ScriptureRef) => (bookByCode.get(r.book)?.ordinal ?? 0) * 1_000_000 + r.startChapter * 1000 + (r.startVerse ?? 0);
      const needle = query.query?.trim().toLowerCase();
      const wanted = needle ? "note" : query.kind;
      const matching = state.annotations
        .filter((a) => (!wanted || a.kind === wanted) && (!query.book || a.reference.book === query.book))
        .filter((a) => !query.color || (a.kind === "highlight" && a.color === query.color))
        .filter((a) => !needle || a.content.toLowerCase().includes(needle))
        .sort((a, b) => key(a.reference) - key(b.reference) || a.createdAt.localeCompare(b.createdAt));
      const offset = query.offset ?? 0;
      const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
      const marks = matching
        .slice(offset, offset + limit)
        .map((a) => (a.anchor ? { ...a, anchor: { ...a.anchor, shown: wordingMatches(a.id, query.translationId) } } : a));
      return { marks, offset, hasMore: matching.length > offset + limit };
    },
    annotationCreate: async (input) => {
      const reference = refFromCanonical(input.reference, bookByCode);
      if (!reference) throw new ApiError("invalidReference", "Invalid reference.");
      if (input.color && input.kind !== "highlight") throw new ApiError("invalidInput", "Only highlights have a colour.");
      const color = input.kind === "highlight" ? (input.color ?? "amber") : null;
      const resolved = input.anchor ? resolveAnchor(input.anchor) : null;
      if (resolved && resolved.reference !== input.reference) {
        throw new ApiError("invalidInput", "The selected words are not in this passage.");
      }
      const existing = state.annotations.find(
        (a) =>
          a.kind === input.kind &&
          input.kind !== "note" &&
          a.reference.canonical === input.reference &&
          JSON.stringify(a.anchor && [a.anchor.start, a.anchor.end]) ===
            JSON.stringify(resolved && [resolved.anchor.start, resolved.anchor.end]),
      );
      if (existing) {
        if (color) existing.color = color;
        return { ...existing };
      }
      const t = now();
      const annotation: Annotation = {
        id: id(),
        reference,
        translationId: input.anchor?.translationId ?? input.translationId ?? null,
        kind: input.kind,
        content: input.content ?? "",
        color,
        anchor: resolved?.anchor ?? null,
        createdAt: t,
        updatedAt: t,
        revision: 1,
      };
      if (resolved) anchorTexts.set(annotation.id, resolved.texts);
      state.annotations.push(annotation);
      return annotation;
    },
    annotationUpdate: async ({ id: annotationId, content, color }) => {
      const annotation = find(state.annotations, annotationId, "note");
      if (color && annotation.kind !== "highlight") throw new ApiError("invalidInput", "Only highlights have a colour.");
      if (content !== undefined) annotation.content = content;
      if (color) annotation.color = color;
      annotation.revision += 1;
      return { ...annotation };
    },
    annotationDelete: async (annotationId) => {
      state.annotations = state.annotations.filter((a) => a.id !== annotationId);
    },
    annotationAnchorCheck: async (input) => resolveAnchor(input).anchor,

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
    setVerseText: (bibleId, canonical, text) => {
      const chapters = state.text.get(bibleId);
      if (!chapters) throw new Error(`No fixture Bible ${bibleId}`);
      const [book, chapter, verse] = canonical.split(".");
      const key = `${book}|${Number(chapter)}`;
      const list = chapters.get(key) ?? [];
      const existing = list.find((v) => v.canonical === canonical);
      if (existing) existing.text = text;
      else chapters.set(key, [...list, { canonical, chapter: Number(chapter), verse: Number(verse), text }].sort((a, b) => a.verse - b.verse));
    },
    installFixtureWords: (bibleId, canonical, words, scheme = "raw") => {
      const bible = state.bibles.find((b) => b.id === bibleId);
      const [book, chapter] = canonical.split(".");
      const verse = state.text.get(bibleId)?.get(`${book}|${Number(chapter)}`)?.find((v) => v.canonical === canonical);
      if (!bible || !verse) throw new Error(`No fixture verse ${canonical} in ${bibleId}`);
      let from = 0;
      const placed: VerseWord[] = words.map((w, position) => {
        const start = verse.text.indexOf(w.surface, from);
        if (start < 0) throw new Error(`“${w.surface}” is not in ${canonical}`);
        from = start + w.surface.length;
        const lexicalIds = [...new Set((w.strong ?? "").split(/[,:]/).map((p) => p.trim()).filter(Boolean))];
        return {
          position, start, end: from, surface: w.surface, shape: "word",
          lemma: w.lemma ?? null, strong: w.strong ?? null, lexicalIds, morph: w.morph ?? null,
          described: w.described ?? null, entryOccurrences: 0,
        };
      });
      const verses = state.words.get(bibleId) ?? new Map<string, VerseWord[]>();
      verses.set(canonical, placed);
      state.words.set(bibleId, verses);
      const all = [...verses.values()].flat();
      bible.words = {
        wordCount: all.length,
        verseCount: verses.size,
        lemmas: all.some((w) => w.lemma),
        lexicalIds: all.some((w) => w.strong),
        morphology: all.some((w) => w.morph),
        morphScheme: all.some((w) => w.morph) ? scheme : "none",
        morphAttribute: all.some((w) => w.morph) ? "x-morph" : null,
        sourceFormat: "usfm",
      };
    },
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
      if (!/\.(pdf|epub|docx|md|markdown|txt)$/i.test(path)) {
        throw new ApiError("unsupportedFormat", "This kind of file can’t be added to the library. Supported: PDF, EPUB, Word (.docx), Markdown (.md) and text (.txt).");
      }
      const fixture = fixtureForPath(path);
      const scanned = fixture.segments.length === 0;
      const hash = `hash-${fixture.title}`;
      const duplicate = library.sources.find((s) => !s.deleted && s.contentHash === hash);
      const preview: SourceImportPreview = {
        previewId: id(), fileName: path.split("/").pop() ?? path, format: fixture.format ?? "pdf",
        suggestedTitle: fixture.title, suggestedAuthor: fixture.author ?? null, suggestedLanguage: fixture.language ?? null,
        suggestedPublisher: null, suggestedIsbn: null, suggestedType: "book",
        pageCount: fixture.format === "pdf" ? (scanned ? 12 : 3) : null, chapterCount: fixture.format === "epub" || fixture.format === "docx" ? 2 : fixture.format === "markdown" ? 1 : null,
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
      library.links = library.links.filter((l) => l.sourceId !== sourceId);
      for (const a of library.annotations) if (a.sourceId === sourceId) a.deleted = true;
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
    sourceGetSegments: async ({ sourceId, offset = 0, limit = 150, aroundPage }) => {
      liveSource(sourceId);
      if (aroundPage !== undefined) {
        const first = segmentsOf(sourceId).find((x) => (x.pageNumber ?? 0) >= aroundPage);
        if (first) return window(sourceId, Math.max(0, first.position - Math.floor(limit / 3)), limit, null);
      }
      return window(sourceId, offset, limit, null);
    },
    librarySourceContents: async (sourceId) => {
      liveSource(sourceId);
      return contentsOf.get(sourceId) ?? [];
    },
    libraryGeneratedContents: async (sourceId) => {
      liveSource(sourceId);
      return generatedOf.get(sourceId) ?? [];
    },
    // As the core: where each stored mention is in its segment's text (the n-th time it is written there).
    librarySourceReferences: async (sourceId) => {
      liveSource(sourceId);
      const out: { position: number; start: number; end: number; reference: ScriptureRef }[] = [];
      const from = new Map<string, number>();
      for (const m of library.mentions.filter((x) => x.sourceId === sourceId)) {
        const segment = library.segments.find((s) => s.id === m.segmentId);
        if (!segment) continue;
        const key = `${m.segmentId}|${m.matchedText}`;
        const start = segment.text.indexOf(m.matchedText, from.get(key) ?? 0);
        if (start < 0) continue;
        from.set(key, start + m.matchedText.length);
        out.push({ position: segment.position, start, end: start + m.matchedText.length, reference: m.reference });
      }
      return out.sort((a, b) => a.position - b.position || a.start - b.start);
    },
    // As the core: explicit references in each text; with a scope, a bookless one ("15:4") where the stored
    // mentions of that part resolved the same visible text to exactly one passage.
    libraryDetectReferences: async (sourceId, texts, scope) => {
      liveSource(sourceId);
      api.detectCalls.push(texts.length);
      const inScope = (segmentId: string) => {
        const segment = library.segments.find((x) => x.id === segmentId);
        if (!segment || !scope) return false;
        if (scope.page !== undefined) return segment.pageNumber === scope.page;
        return scope.from !== undefined && scope.to !== undefined && segment.position >= scope.from && segment.position < scope.to;
      };
      const resolved = new Map<string, ScriptureRef | null>();
      for (const m of library.mentions.filter((x) => x.sourceId === sourceId && !/\p{L}{2}/u.test(x.matchedText) && inScope(x.segmentId))) {
        const seen = resolved.get(m.matchedText);
        resolved.set(m.matchedText, seen === undefined || seen?.canonical === m.reference.canonical ? m.reference : null);
      }
      return Promise.all(
        texts.map(async (text) => {
          const found = await api.referenceDetect(text);
          for (const [visible, reference] of resolved) {
            if (!reference) continue;
            for (let at = text.indexOf(visible); at >= 0; at = text.indexOf(visible, at + visible.length)) {
              const end = at + visible.length;
              if (/\d/.test(text[at - 1] ?? "") || /\d/.test(text[end] ?? "")) continue;
              if (found.some((f) => at < f.end && f.start < end)) continue;
              found.push({ text: visible, start: at, end, reference });
            }
          }
          return found.sort((a, b) => a.start - b.start);
        }),
      );
    },
    // As the core (library::find): case, accents and whitespace runs ignored, Hangul syllables whole, UTF-16 ranges.
    librarySourceFind: async (sourceId, query) => {
      liveSource(sourceId);
      const needle = foldForFind(query.trim()).chars.join("");
      const matches: { position: number; pageNumber: number | null; start: number; end: number }[] = [];
      if (!needle) return { matches, total: 0, truncated: false };
      for (const segment of segmentsOf(sourceId)) {
        const { chars, spans } = foldForFind(segment.text);
        const n = [...needle].length;
        for (let i = 0; i + n <= chars.length; ) {
          if (chars.slice(i, i + n).join("") === needle) {
            matches.push({ position: segment.position, pageNumber: segment.pageNumber ?? null, start: spans[i]![0], end: spans[i + n - 1]![1] });
            i += n;
          } else i += 1;
        }
      }
      return { matches, total: matches.length, truncated: false };
    },
    librarySourceLinks: async (sourceId) => {
      liveSource(sourceId);
      return linksOf.get(sourceId) ?? [];
    },
    libraryEpubStructure: async (sourceId) => {
      liveSource(sourceId);
      const formatted = formattedOf.get(sourceId);
      if (!formatted) throw new ApiError("invalidInput", "This source has no original view.");
      return formatted.structure;
    },
    libraryEpubItem: async (sourceId, item) => {
      liveSource(sourceId);
      const found = formattedOf.get(sourceId)?.items[item];
      if (!found) throw new ApiError("invalidInput", "The original of this source can’t be opened.");
      return found;
    },
    openExternalLink: async (url) => {
      library.openedLinks.push(url);
      if (library.openLinkFails) throw new Error("synthetic: the system could not open the link");
    },
    libraryDocxStructure: async (sourceId) => {
      liveSource(sourceId);
      const formatted = formattedOf.get(sourceId);
      if (!formatted) throw new ApiError("invalidInput", "This source has no original view.");
      return formatted.structure;
    },
    libraryDocxItem: async (sourceId, item) => {
      liveSource(sourceId);
      const found = formattedOf.get(sourceId)?.items[item];
      if (!found) throw new ApiError("invalidInput", "The original of this source can’t be opened.");
      return found;
    },
    libraryOriginalInfo: async (sourceId) => {
      const source = liveSource(sourceId);
      if (!source.originalView) throw new ApiError("invalidInput", "This source has no original view.");
      return { kind: "pdf", sizeBytes: originalBytes.length };
    },
    libraryOriginalRead: async (sourceId, offset, length) => {
      liveSource(sourceId);
      return originalBytes.slice(offset, offset + length);
    },
    sourceGetPassages: async (sourceId) => library.mentions.filter((m) => m.sourceId === sourceId).map(mention),
    // Mirrors db::library::passage_sources and library/relevance.rs: rank = (class, origin, fit,
    // closeness); a mention's class reads the headings of the section it lies in; links that share no
    // verse are not offered; one place per segment; places consolidated per section; sources by best
    // place, then "about the passage", then title.
    libraryPassageSources: async (reference) => rankedSources(reference).map((x) => x.group),
    libraryPassageSourceLocations: async (sourceId, reference) => {
      api.libraryLocationsCalls.push({ sourceId, reference });
      return rankedSources(reference).find((x) => x.group.sourceId === sourceId)?.all.slice(0, 200) ?? [];
    },
    sourceSegmentPassageLinks: async (segmentId) => {
      const rank = { explicit: 0, section: 1, inherited: 2 } as const;
      return [
        ...library.mentions.filter((m) => m.segmentId === segmentId).map((m) => ({ origin: "explicit" as const, reference: m.reference, matchedText: m.matchedText, sectionHeading: null, sectionSegmentId: null })),
        ...library.links.filter((l) => l.segmentId === segmentId).map((l) => ({ origin: l.origin, reference: l.reference, matchedText: l.matchedText, sectionHeading: l.heading, sectionSegmentId: l.openerSegmentId })),
      ].sort((a, b) => rank[a.origin] - rank[b.origin]);
    },
    // Source annotations (v0.14), as the core keeps them: quotes checked against the stored text
    // (segments joined with "\n"), one bookmark per place, same-colour highlights merged and other
    // highlights wholly covered by a new one removed. Recovery after text changes is the core's.
    sourceAnnotationList: async (sourceId) => {
      liveSource(sourceId);
      const at = (a: SourceAnnotation) => [a.start?.position ?? a.position ?? 0, a.start?.offset ?? 0];
      return library.annotations
        .filter((a) => a.sourceId === sourceId && !a.deleted)
        .map(shown)
        .sort((a, b) => at(a)[0]! - at(b)[0]! || at(a)[1]! - at(b)[1]!);
    },
    sourceAnnotationCreate: async (input) => {
      liveSource(input.sourceId);
      const segment = (segmentId: string) => {
        const found = library.segments.find((x) => x.id === segmentId && x.sourceId === input.sourceId);
        if (!found) throw new ApiError("invalidInput", "The selected words do not match the text of this source.");
        return found;
      };
      const stamp = new Date().toISOString();
      const base = { id: id(), sourceId: input.sourceId, kind: input.kind, color: null, content: input.content ?? "", quote: null, start: null, end: null, fraction: null, state: "exact" as const, createdAt: stamp, updatedAt: stamp, revision: 1, deleted: false };
      if (input.start && input.end && input.quote !== undefined) {
        if (input.kind === "bookmark") throw new ApiError("invalidInput", "A bookmark marks a place, not words.");
        const first = segment(input.start.segmentId);
        const last = segment(input.end.segmentId);
        const covered = library.segments
          .filter((x) => x.sourceId === input.sourceId && x.position >= first.position && x.position <= last.position)
          .sort((a, b) => a.position - b.position);
        const line = covered.map((x) => x.text).join("\n");
        const from = input.start.offset;
        const to = line.length - (last.text.length - input.end.offset);
        if (line.slice(from, to) !== input.quote) throw new ApiError("invalidInput", "The selected words do not match the text of this source.");
        const made: SourceAnnotation & { deleted: boolean } = {
          ...base,
          color: input.kind === "highlight" ? (input.color ?? "amber") : null,
          quote: input.quote,
          start: { segmentId: first.id, position: first.position, offset: input.start.offset },
          end: { segmentId: last.id, position: last.position, offset: input.end.offset },
          position: first.position,
          pageNumber: first.pageNumber,
          locator: first.locator,
          sectionPath: first.sectionPath,
        };
        if (input.kind === "highlight") {
          const key = (p: AnnotationPoint) => p.position * 1_000_000 + (p.offset ?? 0);
          for (const other of library.annotations) {
            if (other.deleted || other.kind !== "highlight" || other.sourceId !== input.sourceId || !other.start || !other.end) continue;
            if (key(other.end) < key(made.start!) || key(other.start) > key(made.end!)) continue;
            if (other.color === made.color) {
              if (key(other.start) < key(made.start!)) made.start = other.start;
              if (key(other.end) > key(made.end!)) made.end = other.end;
              other.deleted = true;
            } else if (key(other.start) >= key(made.start!) && key(other.end) <= key(made.end!)) {
              other.deleted = true;
            }
          }
          const lines = library.segments
            .filter((x) => x.sourceId === input.sourceId && x.position >= made.start!.position && x.position <= made.end!.position)
            .sort((a, b) => a.position - b.position);
          const tail = lines[lines.length - 1]!.text.length - made.end!.offset!;
          const joined = lines.map((x) => x.text).join("\n");
          made.quote = joined.slice(made.start!.offset!, joined.length - tail);
        }
        library.annotations.push(made);
        return shown(made);
      }
      if (input.kind === "highlight") throw new ApiError("invalidInput", "Select some words of the source first.");
      const place = input.place ?? {};
      const at = place.segmentId ? segment(place.segmentId) : null;
      if (input.kind === "bookmark") {
        const existing = library.annotations.find(
          (a) => !a.deleted && a.kind === "bookmark" && a.sourceId === input.sourceId && (at ? a.start?.segmentId === at.id : !a.start && a.pageNumber === place.page),
        );
        if (existing) {
          return shown(existing);
        }
      }
      const made: SourceAnnotation & { deleted: boolean } = {
        ...base,
        start: at ? { segmentId: at.id, position: at.position, offset: null } : null,
        position: at?.position ?? null,
        pageNumber: place.page ?? at?.pageNumber ?? null,
        fraction: place.fraction ?? null,
        locator: at?.locator ?? (place.page !== undefined ? `p. ${place.page}` : null),
        sectionPath: at?.sectionPath ?? null,
      };
      library.annotations.push(made);
      return shown(made);
    },
    sourceAnnotationUpdate: async ({ id: annotationId, content, color }) => {
      const found = library.annotations.find((a) => a.id === annotationId && !a.deleted);
      if (!found) throw new ApiError("notFound", "This mark could not be found.");
      if (content !== undefined) found.content = content;
      if (color !== undefined) found.color = color;
      found.revision += 1;
      found.updatedAt = new Date().toISOString();
      return shown(found);
    },
    sourceMarksList: async ({ kind, sourceId, color, query, limit = 30, offset = 0 }) => {
      const needle = query?.trim().toLowerCase();
      const wanted = needle ? "note" : kind;
      const titleOf = (id: string) => library.sources.find((x) => x.id === id);
      const all = library.annotations
        .filter((a) => !a.deleted && !titleOf(a.sourceId)?.deleted)
        .filter((a) => (!wanted || a.kind === wanted) && (!sourceId || a.sourceId === sourceId) && (!color || (a.kind === "highlight" && a.color === color)))
        .filter((a) => !needle || a.content.toLowerCase().includes(needle))
        .map((a) => ({ ...shown(a), sourceTitle: titleOf(a.sourceId)!.title, sourceAuthor: titleOf(a.sourceId)!.author }))
        .sort(
          (a, b) =>
            a.sourceTitle.localeCompare(b.sourceTitle) ||
            Number(a.state === "unresolved") - Number(b.state === "unresolved") ||
            (a.start?.position ?? a.position ?? 0) - (b.start?.position ?? b.position ?? 0) ||
            (a.start?.offset ?? 0) - (b.start?.offset ?? 0),
        );
      return { marks: all.slice(offset, offset + limit), offset, hasMore: all.length > offset + limit };
    },
    sourceMarksSources: async () => {
      const counts = new Map<string, number>();
      for (const a of library.annotations) {
        const source = library.sources.find((x) => x.id === a.sourceId);
        if (!a.deleted && source && !source.deleted) counts.set(a.sourceId, (counts.get(a.sourceId) ?? 0) + 1);
      }
      return [...counts]
        .map(([sourceId, count]) => ({ sourceId, title: library.sources.find((x) => x.id === sourceId)!.title, count }))
        .sort((a, b) => a.title.localeCompare(b.title));
    },
    sourceAnnotationDelete: async (annotationId) => {
      const found = library.annotations.find((a) => a.id === annotationId && !a.deleted);
      if (!found) throw new ApiError("notFound", "This mark could not be found.");
      found.deleted = true;
    },
    findingSourceAdd: async ({ findingId, segmentId }) => {
      const finding = find(state.findings, findingId, "finding");
      if (!finding.sources.some((c) => c.segmentId === segmentId)) finding.sources.push(citationFor(findingId, segmentId));
      return { ...finding };
    },
    // As the core: the words are checked against the stored text (paragraphs joined with "\n"); a
    // mark gives its own words or place (a bookmark has nothing to add); nothing written takes the quote.
    findingCreateFromSource: async (input) => {
      find(state.studies, input.studyId, "study");
      const changed = () => new ApiError("invalidInput", "The selected words do not match the text of this source.");
      let sourceId = input.sourceId;
      let words: { start: TextPoint; end: TextPoint; quote: string } | null = null;
      let place: CreateFindingFromSource["place"] | null = null;
      let fromMark: (SourceAnnotation & { deleted: boolean }) | undefined;
      if (input.annotationId) {
        fromMark = library.annotations.find((a) => a.id === input.annotationId && !a.deleted);
        if (!fromMark) throw new ApiError("notFound", "This mark could not be found.");
        if (fromMark.kind === "bookmark") throw new ApiError("invalidInput", "A bookmark marks a place; it has nothing to add to a study.");
        sourceId = fromMark.sourceId;
        if (fromMark.quote !== null && fromMark.start && fromMark.end) {
          words = { start: { segmentId: fromMark.start.segmentId, offset: fromMark.start.offset! }, end: { segmentId: fromMark.end.segmentId, offset: fromMark.end.offset! }, quote: fromMark.quote };
        } else if (fromMark.quote === null) {
          place = { segmentId: fromMark.start?.segmentId, page: fromMark.start ? undefined : (fromMark.pageNumber ?? undefined), fraction: fromMark.fraction ?? undefined };
        }
      } else if (input.start && input.end && input.quote !== undefined) {
        words = { start: input.start, end: input.end, quote: input.quote };
      } else {
        place = input.place ?? null;
      }
      const source = liveSource(sourceId ?? "");
      const segmentOf = (segmentId: string | undefined) => library.segments.find((x) => x.id === segmentId && x.sourceId === source.id);
      let quote: string | null = fromMark?.quote ?? null;
      let first: SourceSegment | undefined;
      let placeOut: { words: CitationPlace["words"]; segmentId: string | null; page: number | null; fraction: number | null } = { words: null, segmentId: null, page: null, fraction: null };
      let locator: string | null = fromMark?.locator ?? null;
      let section: string | null = fromMark?.sectionPath ?? null;
      if (words) {
        first = segmentOf(words.start.segmentId);
        const last = segmentOf(words.end.segmentId);
        if (!first || !last || last.position < first.position) throw changed();
        const line = library.segments.filter((x) => x.sourceId === source.id && x.position >= first!.position && x.position <= last.position).sort((a, b) => a.position - b.position);
        const joined = line.map((x) => x.text).join("\n");
        if (joined.slice(words.start.offset, joined.length - (last.text.length - words.end.offset)) !== words.quote) throw changed();
        quote = words.quote;
        placeOut = { words: { startSegmentId: first.id, startOffset: words.start.offset, endSegmentId: last.id, endOffset: words.end.offset }, segmentId: first.id, page: null, fraction: null };
        locator = first.locator;
        section = first.sectionPath;
      } else if (place?.segmentId) {
        first = segmentOf(place.segmentId);
        if (!first) throw new ApiError("invalidInput", "This place is no longer in the source.");
        placeOut = { words: null, segmentId: first.id, page: null, fraction: null };
        locator = first.locator;
        section = first.sectionPath;
      } else if (place?.page !== undefined) {
        placeOut = { words: null, segmentId: null, page: place.page, fraction: place.fraction ?? null };
        locator = `p. ${place.page}`;
      } else if (quote === null) {
        throw new ApiError("invalidInput", "Select some words of the source first.");
      }
      const written = (input.content ?? "").trim();
      const content = written || quote;
      if (!content) throw new ApiError("invalidInput", "Write something to add first.");
      if (input.sectionId) {
        const section = state.sections.find((x) => x.id === input.sectionId);
        if (!section || section.studyId !== input.studyId) throw new ApiError("invalidInput", "That part belongs to another study.");
      }
      const t = now();
      const finding: Finding = {
        id: id(), studyId: input.studyId, sectionId: input.sectionId || null, findingType: input.findingType as Finding["findingType"],
        content, sortOrder: state.findings.filter((f) => f.studyId === input.studyId).length,
        parentId: null, passages: [], tags: [], sources: [], createdAt: t, updatedAt: t, revision: 1,
      };
      const citation: FindingCitation = {
        id: id(), findingId: finding.id, sourceId: source.id, segmentId: placeOut.segmentId, title: source.title, author: source.author,
        locator: locator || null, removed: false,
        unavailable: false, quote, section: section || null, annotationId: input.annotationId ?? null,
      };
      citationPlaces.set(citation.id, placeOut);
      finding.sources.push(citation);
      state.findings.push(finding);
      touch(input.studyId);
      return { ...finding, sources: [...finding.sources] };
    },
    findingSourceLocate: async (citationId) => {
      const finding = state.findings.find((f) => f.sources.some((c) => c.id === citationId));
      const citation = finding?.sources.find((c) => c.id === citationId);
      if (!citation) throw new ApiError("notFound", "This citation could not be found.");
      if (citation.removed || citation.sourceId === null || library.sources.find((x) => x.id === citation.sourceId)?.deleted) return null;
      const sourceId = citation.sourceId;
      const known = citationPlaces.get(citationId);
      const live = (segmentId: string | null) => (segmentId && library.segments.some((x) => x.id === segmentId) ? segmentId : null);
      if (!known) return { sourceId, segmentId: live(citation.segmentId), words: null, page: null, fraction: null };
      return { sourceId, segmentId: live(known.segmentId), words: live(known.segmentId) ? known.words : null, page: known.page, fraction: known.fraction };
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

/** A stored source annotation as the core returns it (without the test's own `deleted` flag). */
function shown(stored: SourceAnnotation & { deleted: boolean }): SourceAnnotation {
  const copy: Partial<SourceAnnotation & { deleted: boolean }> = { ...stored };
  delete copy.deleted;
  return copy as SourceAnnotation;
}

/** The core's find folding (library::find::fold), for the in-memory librarySourceFind. */
function foldForFind(text: string): { chars: string[]; spans: [number, number][] } {
  const chars: string[] = [];
  const spans: [number, number][] = [];
  let at = 0;
  for (const c of text) {
    const range: [number, number] = [at, at + c.length];
    at += c.length;
    if (/\s/u.test(c)) {
      if (chars[chars.length - 1] === " ") spans[spans.length - 1]![1] = range[1];
      else {
        chars.push(" ");
        spans.push(range);
      }
      continue;
    }
    const parts = /[\uAC00-\uD7A3]/u.test(c) ? [c] : [...c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()];
    for (const f of parts) {
      chars.push(f === "ς" ? "σ" : f);
      spans.push(range);
    }
  }
  return { chars, spans };
}
