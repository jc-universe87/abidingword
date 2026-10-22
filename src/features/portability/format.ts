import type { TFunction } from "i18next";
import type { BackupCounts, ProjectCounts } from "@/types/portability";

/** "Bible Studies: 2 · Bible Teachings: 1 · Notes: 6", each part only when there is some. */
export function countsLine(t: TFunction, counts: ProjectCounts): string {
  return (
    [
      ["studies", counts.studies],
      ["teachings", counts.teachings],
      ["presentations", counts.presentations],
      ["notes", counts.notes],
      ["images", counts.images],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([key, n]) => t(`settings.data.count.${key}`, { n }))
    .join(" · ");
}

export function backupCountsLine(t: TFunction, counts: BackupCounts): string {
  return (
    [
      ["projects", counts.projects],
      ["studies", counts.studies],
      ["teachings", counts.teachings],
      ["sources", counts.sources],
      ["bibles", counts.bibles],
    ] as const
  )
    .map(([key, n]) => t(`settings.data.count.${key}`, { n }))
    .join(" · ");
}

/** A size in megabytes (at least 0.1), in the interface language. */
export function megabytes(bytes: number, language: string): string {
  const mb = Math.max(0.1, bytes / 1_000_000);
  return new Intl.NumberFormat(language, { maximumFractionDigits: mb < 10 ? 1 : 0 }).format(mb);
}

/** A title usable as a file name on every system. */
export function fileName(title: string): string {
  const name = [...title]
    .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return name || "Abiding Word";
}
