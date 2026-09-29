import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useApi } from "@/lib/ApiContext";
import { chapterRef, hasVerses, refFromCanonical } from "@/lib/scripture";
import type { AppSettings } from "@/types/domain";
import type { BibleTranslation, BookInfo, ScriptureRef, SearchResults } from "@/types/scripture";

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
  translations: BibleTranslation[];
  translation: BibleTranslation | null;
  location: ScriptureLocation;
  /** The passage last navigated to, when it names verses (highlighted). */
  selection: ScriptureRef | null;
  /** Bumps on every navigation so the reader can scroll to it. */
  navigationId: number;
  search: ScriptureSearch | null;
  setTranslation: (id: string) => void;
  goTo: (ref: ScriptureRef) => void;
  goToChapter: (book: string, chapter: number) => void;
  /** Parses typed text; throws an ApiError with a plain message if invalid. */
  navigateText: (text: string) => Promise<ScriptureRef>;
  reloadTranslations: () => Promise<BibleTranslation[]>;
  runSearch: (input: Pick<ScriptureSearch, "query" | "currentOnly" | "book">) => Promise<void>;
  closeSearch: () => void;
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
  const [translations, setTranslations] = useState(initial);
  const [translationId, setTranslationId] = useState<string | null>(settings.scriptureTranslationId);
  const bookByCode = useMemo(() => new Map(books.map((b) => [b.code, b])), [books]);
  const [saved] = useState(() =>
    settings.scripturePassage ? refFromCanonical(settings.scripturePassage, bookByCode) : null,
  );
  const [location, setLocation] = useState<ScriptureLocation>(
    saved ? { book: saved.book, chapter: saved.startChapter } : DEFAULT_LOCATION,
  );
  const [selection, setSelection] = useState<ScriptureRef | null>(saved && hasVerses(saved) ? saved : null);
  const [navigationId, setNavigationId] = useState(0);
  const [search, setSearch] = useState<ScriptureSearch | null>(null);

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

  const setTranslation = useCallback(
    (id: string) => {
      setTranslationId(id);
      persist({ scriptureTranslationId: id });
    },
    [persist],
  );

  const goTo = useCallback(
    (ref: ScriptureRef) => {
      setLocation({ book: ref.book, chapter: ref.startChapter });
      setSelection(hasVerses(ref) || ref.startChapter !== ref.endChapter ? ref : null);
      setNavigationId((n) => n + 1);
      setSearch(null);
      persist({ scripturePassage: ref.canonical });
    },
    [persist],
  );

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
      const ref = await api.referenceParse(text);
      goTo(ref);
      return ref;
    },
    [api, goTo],
  );

  const reloadTranslations = useCallback(async () => {
    const list = await api.bibleList();
    setTranslations(list);
    return list;
  }, [api]);

  const runSearch = useCallback(
    async (input: Pick<ScriptureSearch, "query" | "currentOnly" | "book">) => {
      setSearch({ ...input, results: null, error: null, busy: true });
      try {
        const results = await api.scriptureSearch({
          query: input.query,
          translationId: input.currentOnly && translation ? translation.id : undefined,
          book: input.book || undefined,
        });
        setSearch({ ...input, results, error: null, busy: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The search could not be completed.";
        setSearch({ ...input, results: null, error: message, busy: false });
      }
    },
    [api, translation],
  );

  const closeSearch = useCallback(() => setSearch(null), []);

  const value = useMemo<ScriptureValue>(
    () => ({
      books,
      bookByCode,
      translations,
      translation,
      location,
      selection,
      navigationId,
      search,
      setTranslation,
      goTo,
      goToChapter,
      navigateText,
      reloadTranslations,
      runSearch,
      closeSearch,
    }),
    [books, bookByCode, translations, translation, location, selection, navigationId, search, setTranslation, goTo, goToChapter, navigateText, reloadTranslations, runSearch, closeSearch],
  );

  return <ScriptureContext.Provider value={value}>{children}</ScriptureContext.Provider>;
}

export function useScripture(): ScriptureValue {
  const value = useContext(ScriptureContext);
  if (!value) throw new Error("useScripture must be used inside <ScriptureProvider>");
  return value;
}
