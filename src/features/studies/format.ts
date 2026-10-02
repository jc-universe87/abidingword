import type { TFunction } from "i18next";

// Dates follow the interface language; kept here for existing imports.
export { formatDate } from "@/i18n/format";

export function studyCountLabel(t: TFunction, count: number): string {
  return t("studies.studyCount", { count });
}
