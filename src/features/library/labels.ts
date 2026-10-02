import type { TFunction } from "i18next";
import type { FindingCitation, LicenceStatus, SourceFormat, SourceType } from "@/types/library";

// Stored values stay stable; only their labels are translated (docs/i18n.md).

export function sourceTypeLabel(t: TFunction, type: SourceType): string {
  return t(`library.sourceType.${type}`);
}

export function formatLabel(t: TFunction, format: SourceFormat): string {
  return t(`library.format.${format}`);
}

export function licenceLabel(t: TFunction, licence: LicenceStatus): string {
  return t(`library.licence.${licence}`);
}

/**
 * A locator for display. With page data it is "p. 152" in the interface
 * language; a stored English page locator ("p. 152") is shown the same way;
 * anything else (a chapter or heading from the source) is shown as stored.
 */
export function locatorLabel(t: TFunction, locator: string | null | undefined, page?: string | number | null): string {
  if (page !== null && page !== undefined && page !== "") return t("library.locator.page", { page: String(page) });
  if (!locator) return "";
  const match = /^p\. (.+)$/.exec(locator);
  return match ? t("library.locator.page", { page: match[1] }) : locator;
}

/** "Author, Title, p. 152" — the short citation shown in findings. */
export function citationText(t: TFunction, c: Pick<FindingCitation, "author" | "title" | "locator">): string {
  return [c.author, c.title, locatorLabel(t, c.locator)].filter(Boolean).join(", ");
}
