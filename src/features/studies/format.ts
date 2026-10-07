import type { TFunction } from "i18next";

// Dates follow the interface language; kept here for existing imports.
export { formatDate } from "@/i18n/format";

export function studyCountLabel(t: TFunction, count: number): string {
  return t("studies.studyCount", { count });
}

/** A title or passage label compared for sameness: dashes, spacing and case do not matter. */
function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/[.:;,]+$/g, "")
    .trim();
}

/** Whether a study's title is, in effect, just its passage ("John 15:1–11" for John 15:1–11). */
export function titleIsPassage(title: string, passageLabel: string): boolean {
  return plain(title) === plain(passageLabel);
}
