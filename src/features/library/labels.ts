import type { TFunction } from "i18next";
import type { FindingCitation, LicenceStatus, PassageLinkOrigin, SourceFormat, SourceType } from "@/types/library";

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

/**
 * Where something is in a source, as a reader outside Abiding Word could use
 * it: the page, else the section ("Chapter 3 › Grace"). A paragraph number
 * ("¶ 4") counts paragraphs as Abiding Word stored them, which no printed copy
 * has: the section is given instead, or nothing.
 */
export function placeLabel(t: TFunction, locator: string | null | undefined, section?: string | null): string {
  if (!locator || /^¶\s*\d+$/.test(locator.trim())) return section?.trim() ?? "";
  return locatorLabel(t, locator);
}

/** "Author, Title, p. 152" — the short citation shown in findings and copied with a quotation. Only what is known. */
export function citationText(t: TFunction, c: Pick<FindingCitation, "author" | "title" | "locator"> & { section?: string | null }): string {
  return [c.author?.trim(), c.title.trim(), placeLabel(t, c.locator, c.section)].filter(Boolean).join(", ");
}

/**
 * A quotation with its citation, to copy out of Abiding Word (v0.15): the
 * words exactly as the source has them, in the interface language's
 * quotation marks, and "— Author, Title, p. 42" under them. One format only;
 * nothing is added that the source's details do not say.
 */
export function quotationWithCitation(
  t: TFunction,
  quote: string,
  c: Pick<FindingCitation, "author" | "title" | "locator"> & { section?: string | null },
): string {
  const citation = citationText(t, c);
  const quoted = t("library.copy.quoted", { quote: quote.trim() });
  return citation ? `${quoted}\n— ${citation}` : quoted;
}

/**
 * Why a place is linked to a passage, in plain words: "Mentions John 15:5",
 * "Section on John 15:1–11" (a heading names it), "Within section on …"
 * (inside such a section). The stored origin is never shown as such.
 */
export function passageReason(t: TFunction, origin: PassageLinkOrigin, passage: string): string {
  switch (origin) {
    case "explicit":
      return t("library.passage.mentions", { passage });
    case "section":
      return t("library.passage.section", { passage });
    case "inherited":
      return t("library.passage.within", { passage });
    default:
      return t("library.passage.linked", { passage });
  }
}
