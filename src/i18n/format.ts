// Numbers and dates in the active interface language (Intl, no library).
import i18n from "i18next";

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(i18n.language).format(value);
}

/** e.g. "2 Oct 2026", "2. Okt. 2026", "2026. 10. 2." */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(date);
}
