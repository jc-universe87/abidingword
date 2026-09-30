// Frontend helpers for canonical references. The native core is the
// authority (it validates every reference it receives); these helpers only
// read canonical strings the core produced, to position the reader.
import type { ScriptureRef } from "@/types/scripture";

/** Verse position inside a book, for range comparisons. */
function key(chapter: number, verse: number): number {
  return chapter * 1000 + verse;
}

/** True when chapter:verse of `book` lies inside the reference. */
export function contains(ref: ScriptureRef, book: string, chapter: number, verse: number): boolean {
  if (ref.book !== book) return false;
  const at = key(chapter, verse);
  return key(ref.startChapter, ref.startVerse ?? 0) <= at && at <= key(ref.endChapter, ref.endVerse ?? 999);
}

/** True when the reference names particular verses, not whole chapters. */
export function hasVerses(ref: ScriptureRef): boolean {
  return ref.startVerse !== null || ref.endVerse !== null;
}

interface Parsed {
  book: string;
  startChapter: number;
  startVerse: number | null;
  endChapter: number;
  endVerse: number | null;
}

/** Reads a canonical string such as "JHN.15.1-JHN.15.11" or "ROM.8". */
export function parseCanonical(canonical: string): Parsed | null {
  const point = (part: string) => {
    const [book, chapter, verse, extra] = part.split(".");
    const c = Number(chapter);
    const v = verse === undefined ? null : Number(verse);
    if (!book || extra !== undefined || !Number.isInteger(c) || c < 1) return null;
    if (v !== null && (!Number.isInteger(v) || v < 1)) return null;
    return { book, chapter: c, verse: v };
  };
  const [first, second, extra] = canonical.split("-");
  if (!first || extra !== undefined) return null;
  const start = point(first);
  const end = second === undefined ? start : point(second);
  if (!start || !end || start.book !== end.book) return null;
  return {
    book: start.book,
    startChapter: start.chapter,
    startVerse: start.verse,
    endChapter: end.chapter,
    endVerse: end.verse,
  };
}

/** A whole-chapter reference built on the frontend (e.g. for navigation). */
export function chapterRef(book: string, bookName: string, chapter: number, chapterCount: number): ScriptureRef {
  return {
    canonical: `${book}.${chapter}`,
    display: chapterCount === 1 ? bookName : `${bookName} ${chapter}`,
    book,
    startChapter: chapter,
    startVerse: null,
    endChapter: chapter,
    endVerse: null,
  };
}

/** One psalm is "Psalm 23"; several are "Psalms 23–24". */
export function bookLabel(code: string, name: string, singleChapter: boolean): string {
  return code === "PSA" && singleChapter ? "Psalm" : name;
}

/**
 * Builds a full reference (with its display form) from a canonical string,
 * using the same display rules as the native core: "John 15:1–11",
 * "John 15:1–16:4", "Romans 8", "John 14–16", "Jude 3".
 */
export function refFromCanonical(
  canonical: string,
  books: Map<string, { name: string; chapterCount: number }>,
): ScriptureRef | null {
  const parsed = parseCanonical(canonical);
  const book = parsed ? books.get(parsed.book) : undefined;
  if (!parsed || !book) return null;
  const oneChapter = book.chapterCount === 1;
  const point = (chapter: number, verse: number | null) =>
    verse === null ? String(chapter) : oneChapter ? String(verse) : `${chapter}:${verse}`;
  const { startChapter: sc, startVerse: sv, endChapter: ec, endVerse: ev } = parsed;
  const name = bookLabel(parsed.book, book.name, sc === ec);
  let display: string;
  if (oneChapter && sv === null && ev === null) {
    display = name;
  } else if (sc === ec && sv === ev) {
    display = `${name} ${point(sc, sv)}`;
  } else {
    const end = sc === ec && sv !== null && ev !== null ? String(ev) : point(ec, ev);
    display = `${name} ${point(sc, sv)}–${end}`;
  }
  return { canonical, display, ...parsed };
}
