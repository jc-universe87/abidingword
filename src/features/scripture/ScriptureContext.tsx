import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import i18n from "@/i18n";
import { useApi } from "@/lib/ApiContext";
import { chapterRef, hasVerses, refFromCanonical } from "@/lib/scripture";
import type { AppSettings } from "@/types/domain";
import type { BibleTranslation, BookInfo, ConcordanceMode, LemmaSelection, ScriptureRef, SearchResults } from "@/types/scripture";
import { canGoBack, canGoForward, goBack, goForward, startHistory, visit, type ScriptureHistory } from "./scriptureHistory";

/**
 * The active Scripture passage, shared by the whole app: the Scripture pane
 * shows it, a Study can move it, and later tools (AI, integrations) read it.
 * The translation and passage are saved as settings, so they survive a
 * restart; nothing here lives only in the page.
 */
export interface ScriptureLocation {
  book: string;
  chapter: number;
}

export interface ScriptureSearch {
  query: string;
  /** Limit to the current translation. */
  currentOnly: boolean;
  book: string;
  results: SearchResults | null;
  error: string | null;
  busy: boolean;
}

interface ScriptureValue {
  books: BookInfo[];
  bookByCode: Map<string, BookInfo>;
  /** Bibles readable by passage (every verse-dependent tool uses these). */
  translations: BibleTranslation[];
  translation: BibleTranslation | null;
  /** Every Bible, those read as documents too (v0.23). */
  allTranslations: BibleTranslation[];
  /** Bibles read as documents, not by passage (v0.23). */
  documentBibles: BibleTranslation[];
  /**
   * The document Bible open in the Scripture pane, if any (v0.23). Opening one
   * leaves the passage, history and the Bible read by passage as they are;
   * going to a passage closes it.
   */
  documentBible: BibleTranslation | null;
  openDocumentBible: (id: string | null) => void;
  location: ScriptureLocation;
  /** The passage last navigated to, when it names verses (highlighted). */
  selection: ScriptureRef | null;
  /** The verse the user clicked in the reader, if any. */
  selectedVerse: ScriptureRef | null;
  selectVerse: (canonical: string | null) => void;
  /**
   * What "Link current passage" links: the clicked verse, otherwise the
   * highlighted passage. Null when nothing specific is chosen.
   */
  currentPassage: ScriptureRef | null;
  /** Bumps on every navigation so the reader can scroll to it. */
  navigationId: number;
  search: ScriptureSearch | null;
  setTranslation: (id: string) => void;
  goTo: (ref: ScriptureRef) => void;
  /** The passage the pane is showing now (a chapter, or the passage last gone to). */
  current: ScriptureRef;
  /** Back / Forward through the passages the pane has shown (session only). */
  canGoBack: boolean;
  canGoForward: boolean;
  back: () => void;
  forward: () => void;
  /**
   * The primary passage of the Study that is open, if any: what "Back to …"
   * returns to. Set by the open Study; never written by navigation.
   */
  studyPassage: ScriptureRef | null;
  setStudyPassage: (ref: ScriptureRef | null) => void;
  /** The last request to show the concordance (e.g. from a word study); a new `nonce` is a new request. */
  concordanceRequest: ConcordanceRequest | null;
  openConcordance: (request: Omit<ConcordanceRequest, "nonce">) => void;
  goToChapter: (book: string, chapter: number) => void;
  /** Parses typed text; throws an ApiError with a plain message if invalid. */
  navigateText: (text: string) => Promise<ScriptureRef>;
  reloadTranslations: () => Promise<BibleTranslation[]>;
  runSearch: (input: Pick<ScriptureSearch, "query" | "currentOnly" | "book">) => Promise<void>;
  closeSearch: () => void;
}

export interface ConcordanceRequest {
  query: string;
  /** "lemma" (v0.21): `query` is a lemma or lexical number, or `selection` says exactly which words. */
  mode: ConcordanceMode | "lemma";
  selection?: LemmaSelection;
  /** The translation to look in; the one being read when absent. */
  translationId?: string | null;
  nonce: number;
}

const ScriptureContext = createContext<ScriptureValue | null>(null);

const DEFAULT_LOCATION: ScriptureLocation = { book: "GEN", chapter: 1 };

interface ProviderProps {
  settings: AppSettings;
  books: BookInfo[];
  translations: BibleTranslation[];
  children: ReactNode;
}

export function ScriptureProvider({ settings, books, translations: initial, children }: ProviderProps) {
  const api = useApi();
  const [allTranslations, setAllTranslations] = useState(initial);
  const allRef = useRef(initial);
  const translations = useMemo(() => allTranslations.filter((t) => t.kind !== "document"), [allTranslations]);
  const documentBibles = useMemo(() => allTranslations.filter((t) => t.kind === "document"), [allTranslations]);
  const [translationId, setTranslationId] = useState<string | null>(settings.scriptureTranslationId);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const bookByCode = useMemo(() => new Map(books.map((b) => [b.code, b])), [books]);
  const [saved] = useState(() =>
    settings.scripturePassage ? refFromCanonical(settings.scripturePassage, bookByCode) : null,
  );
  const [location, setLocation] = useState<ScriptureLocation>(
    saved ? { book: saved.book, chapter: saved.startChapter } : DEFAULT_LOCATION,
  );
  const [selection, setSelection] = useState<ScriptureRef | null>(saved && hasVerses(saved) ? saved : null);
  const [navigationId, setNavigationId] = useState(0);
  const [selectedVerse, setSelectedVerse] = useState<ScriptureRef | null>(null);
  const [search, setSearch] = useState<ScriptureSearch | null>(null);
  const [studyPassage, setStudyPassage] = useState<ScriptureRef | null>(null);
  const [concordanceRequest, setConcordanceRequest] = useState<ConcordanceRequest | null>(null);
  const openConcordance = useCallback(
    (request: Omit<ConcordanceRequest, "nonce">) =>
      setConcordanceRequest((current) => ({ ...request, nonce: (current?.nonce ?? 0) + 1 })),
    [],
  );
  // Where the pane has been. The ref holds the latest value so a navigation
  // made in the same tick as another still sees the one before it.
  const [history, setHistoryState] = useState<ScriptureHistory>(() => {
    const info = bookByCode.get(saved?.book ?? DEFAULT_LOCATION.book);
    return startHistory(saved ?? chapterRef(DEFAULT_LOCATION.book, info?.name ?? DEFAULT_LOCATION.book, DEFAULT_LOCATION.chapter, info?.chapterCount ?? 50));
  });
  const historyRef = useRef(history);
  const setHistory = useCallback((next: ScriptureHistory) => {
    historyRef.current = next;
    setHistoryState(next);
  }, []);

  // Falls back to the first installed Bible if the saved one was removed
  // (removal also clears the saved setting in the native core).
  const translation =
    translations.find((t) => t.id === translationId) ?? translations[0] ?? null;

  const persist = useCallback(
    (input: { scriptureTranslationId?: string; scripturePassage?: string }) => {
      api.settingsUpdate(input).catch(() => undefined);
    },
    [api],
  );

  const documentBible = documentBibles.find((t) => t.id === documentId) ?? null;
  const openDocumentBible = useCallback((id: string | null) => setDocumentId(id), []);

  // Choosing a Bible: one read by passage becomes the Bible read; one read as a
  // document opens in the pane without changing which Bible passages are read in.
  const setTranslation = useCallback(
    (id: string) => {
      if (allRef.current.find((t) => t.id === id)?.kind === "document") {
        setDocumentId(id);
        return;
      }
      setDocumentId(null);
      setTranslationId(id);
      persist({ scriptureTranslationId: id });
    },
    [persist],
  );

  // Shows a passage; how it is recorded in the history is the caller's business.
  // A passage is always shown in a Bible read by passage: a document closes.
  const show = useCallback(
    (ref: ScriptureRef) => {
      setDocumentId(null);
      setLocation({ book: ref.book, chapter: ref.startChapter });
      setSelection(hasVerses(ref) || ref.startChapter !== ref.endChapter ? ref : null);
      setSelectedVerse(null);
      setNavigationId((n) => n + 1);
      setSearch(null);
      persist({ scripturePassage: ref.canonical });
    },
    [persist],
  );

  const goTo = useCallback(
    (ref: ScriptureRef) => {
      setHistory(visit(historyRef.current, ref));
      show(ref);
    },
    [setHistory, show],
  );

  const back = useCallback(() => {
    const next = goBack(historyRef.current);
    if (next === historyRef.current) return;
    setHistory(next);
    show(next.current);
  }, [setHistory, show]);

  const forward = useCallback(() => {
    const next = goForward(historyRef.current);
    if (next === historyRef.current) return;
    setHistory(next);
    show(next.current);
  }, [setHistory, show]);

  const goToChapter = useCallback(
    (book: string, chapter: number) => {
      const info = bookByCode.get(book);
      if (!info) return;
      goTo(chapterRef(book, info.name, chapter, info.chapterCount));
    },
    [bookByCode, goTo],
  );

  const navigateText = useCallback(
    async (text: string) => {
      const ref = await api.referenceParse(text, translation?.id);
      goTo(ref);
      return ref;
    },
    [api, goTo, translation],
  );

  const reloadTranslations = useCallback(async () => {
    const list = await api.bibleList();
    allRef.current = list;
    setAllTranslations(list);
    return list;
  }, [api]);

  const runSearch = useCallback(
    async (input: Pick<ScriptureSearch, "query" | "currentOnly" | "book">) => {
      // Search results are verses: they show in the Bible read by passage.
      setDocumentId(null);
      setSearch({ ...input, results: null, error: null, busy: true });
      try {
        const results = await api.scriptureSearch({
          query: input.query,
          translationId: input.currentOnly && translation ? translation.id : undefined,
          book: input.book || undefined,
        });
        setSearch({ ...input, results, error: null, busy: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : i18n.t("scripture.search.failed");
        setSearch({ ...input, results: null, error: message, busy: false });
      }
    },
    [api, translation],
  );

  const closeSearch = useCallback(() => setSearch(null), []);

  const selectVerse = useCallback(
    (canonical: string | null) => setSelectedVerse(canonical ? refFromCanonical(canonical, bookByCode) : null),
    [bookByCode],
  );
  const currentPassage = selectedVerse ?? selection;

  const current = history.current;
  const backAvailable = canGoBack(history);
  const forwardAvailable = canGoForward(history);
  const value = useMemo<ScriptureValue>(
    () => ({
      books,
      bookByCode,
      translations,
      translation,
      allTranslations,
      documentBibles,
      documentBible,
      openDocumentBible,
      location,
      selection,
      selectedVerse,
      selectVerse,
      currentPassage,
      navigationId,
      search,
      setTranslation,
      goTo,
      current,
      canGoBack: backAvailable,
      canGoForward: forwardAvailable,
      back,
      forward,
      studyPassage,
      setStudyPassage,
      concordanceRequest,
      openConcordance,
      goToChapter,
      navigateText,
      reloadTranslations,
      runSearch,
      closeSearch,
    }),
    [books, bookByCode, translations, translation, allTranslations, documentBibles, documentBible, openDocumentBible, location, selection, selectedVerse, selectVerse, currentPassage, navigationId, search, setTranslation, goTo, current, backAvailable, forwardAvailable, back, forward, studyPassage, concordanceRequest, openConcordance, goToChapter, navigateText, reloadTranslations, runSearch, closeSearch],
  );

  return <ScriptureContext.Provider value={value}>{children}</ScriptureContext.Provider>;
}

export function useScripture(): ScriptureValue {
  const value = useContext(ScriptureContext);
  if (!value) throw new Error("useScripture must be used inside <ScriptureProvider>");
  return value;
}
