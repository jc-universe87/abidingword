import type { FindingCitation, LicenceStatus, SourceFormat, SourceType } from "@/types/library";

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  book: "Book",
  article: "Article",
  notes: "Notes",
  sermon: "Sermon",
  lecture: "Lecture",
  document: "Document",
};

export const FORMAT_LABELS: Record<SourceFormat, string> = {
  pdf: "PDF",
  epub: "EPUB",
  markdown: "Markdown",
  text: "Plain text",
};

export const LICENCE_LABELS: Record<LicenceStatus, string> = {
  private: "My own copy — not to be shared",
  distributable: "May be shared",
  unknown: "Licence not known",
};

/** "Author, Title, p. 152" — the short citation shown in findings. */
export function citationText(c: Pick<FindingCitation, "author" | "title" | "locator">): string {
  return [c.author, c.title, c.locator].filter(Boolean).join(", ");
}
