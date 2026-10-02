// Bible book names and passage labels in the interface language.
// Canonical references (JHN.15.7) and the reference parser are unchanged:
// this is display only (docs/i18n.md, "Bible book names").
import i18n from "i18next";
import type { ScriptureRef } from "@/types/scripture";

function translate(key: string, fallback: string): string {
  return (i18n.t as (key: string, options: Record<string, unknown>) => string)(key, { defaultValue: fallback });
}

/** The book's name in the interface language, e.g. JHN → "Johannes" in German. */
export function bookName(code: string, fallback = code): string {
  return translate(`books.name.${code}`, fallback);
}

/** One psalm is "Psalm 23" (in each language's form); several use the book name. */
export function bookLabel(code: string, singleChapter: boolean, fallback = code): string {
  return code === "PSA" && singleChapter ? translate("books.psalm", "Psalm") : bookName(code, fallback);
}

/**
 * A passage as the reader sees it, with the same rules as the native core:
 * "John 15:1–11", "John 15:1–16:4", "Romans 8", "John 14–16", "Jude 3",
 * using the book name and chapter–verse separator of the interface
 * language. `chapterCount` tells one-chapter books apart (Jude 3 is a verse).
 */
export function referenceLabel(ref: ScriptureRef, chapterCount?: number): string {
  const oneChapter = chapterCount === 1 || ONE_CHAPTER_BOOKS.has(ref.book);
  const separator = translate("books.verseSeparator", ":");
  const point = (chapter: number, verse: number | null) =>
    verse === null ? String(chapter) : oneChapter ? String(verse) : `${chapter}${separator}${verse}`;
  const { startChapter: sc, startVerse: sv, endChapter: ec, endVerse: ev } = ref;
  const name = bookLabel(ref.book, sc === ec, ref.book);
  if (oneChapter && sv === null && ev === null) return name;
  if (sc === ec && sv === ev) return `${name} ${point(sc, sv)}`;
  const end = sc === ec && sv !== null && ev !== null ? String(ev) : point(ec, ev);
  return `${name} ${point(sc, sv)}–${end}`;
}

/** Books with a single chapter (Obadiah, Philemon, 2–3 John, Jude). */
const ONE_CHAPTER_BOOKS = new Set(["OBA", "PHM", "2JN", "3JN", "JUD"]);
