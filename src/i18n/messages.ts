// Messages that come from the native core (errors, Bible import issues)
// carry a stable code and values; they are shown in the interface language
// here. The core's English text is the fallback (docs/i18n.md).
import i18n from "i18next";
import { parseCanonical } from "@/lib/scripture";
import { bookName, referenceLabel } from "./scripture";

export type MessageParams = Record<string, string>;

/** Error kinds whose wording never varies, translated from the kind alone. */
const FIXED_KINDS = ["database", "filesystem", "notFound", "migration", "integrity", "backup", "unexpected"];

/** t() for keys built at run time (codes from the core). */
function translate(key: string, values: Record<string, unknown>): string {
  return (i18n.t as (key: string, options: Record<string, unknown>) => string)(key, values);
}

/**
 * Prepares the core's values: a `bookCode` gains its book name in the
 * interface language (`book`); a number list (`numbers`, `listed`, `more`)
 * becomes one `list` text, and `listed` is the count when none is given.
 */
function values(params: MessageParams): Record<string, unknown> {
  const result: Record<string, unknown> = { ...params };
  if (params.bookCode) result.book = translate(`books.name.${params.bookCode}`, { defaultValue: params.bookCode });
  for (const name of ["count", "max", "found", "listed", "more", "chapter", "verse", "first", "last"]) {
    if (params[name] !== undefined && /^\d+$/.test(params[name])) result[name] = Number(params[name]);
  }
  // An ambiguous typed passage: its options in the interface language.
  if (params.canonicals) {
    result.options = params.canonicals
      .split(";")
      .map((canonical) => {
        const parsed = parseCanonical(canonical);
        return parsed ? referenceLabel({ ...parsed, canonical, display: canonical }) : canonical;
      })
      .join(" / ");
  } else if (params.books && params.options !== undefined) {
    result.options = params.books
      .split(",")
      .map((code) => bookName(code))
      .join(" / ");
  }
  if (params.numbers !== undefined) {
    const more = Number(params.more ?? 0);
    result.list = more > 0 ? translate("errors.bibleImport.listMore", { numbers: params.numbers, count: more }) : params.numbers;
    if (params.count === undefined) result.count = Number(params.listed ?? 0);
  }
  return result;
}

/** A coded message in the interface language, or `fallback` if the code is unknown. */
export function localizeMessage(code: string | null | undefined, params: MessageParams | undefined, fallback: string): string {
  if (!code || !i18n.exists(`errors.${code}`)) return fallback;
  // The Psalms are counted in psalms, not chapters ("시편 119편", "Psalm 119").
  const psalms = params?.bookCode === "PSA" ? PSALM_WORDING[code] : undefined;
  return translate(`errors.${psalms ?? code}`, values(params ?? {}));
}

const PSALM_WORDING: Record<string, string> = {
  "reference.chapterCount": "reference.chapterCountPsalms",
  "reference.verseCount": "reference.verseCountPsalm",
};

/** An error from the core, in the interface language. */
export function localizeError(kind: string, message: string, code?: string | null, params?: MessageParams): string {
  if (code) return localizeMessage(code, params, message);
  if (FIXED_KINDS.includes(kind)) return translate(`errors.kind.${kind}`, {});
  return message;
}
