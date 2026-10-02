import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, X } from "lucide-react";
import { Button } from "@/design-system/Button";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { highlighted } from "@/lib/highlight";
import type { LibraryHit } from "@/types/library";
import type { Finding } from "@/types/studies";
import { citationText } from "./labels";
import { useLibraryNav } from "./LibraryNav";

interface FindingSourcesProps {
  finding: Finding;
  onChanged: () => void;
  /**
   * Quotation findings only: puts the cited passage's text into the finding.
   * Never automatic; the user ticks a box for it.
   */
  onQuote?: (text: string) => void;
}

/** A finding's library citations, and "Add source" to cite a passage. */
export function FindingSources({ finding, onChanged, onQuote }: FindingSourcesProps) {
  const { t } = useTranslation();
  const api = useApi();
  const { openSource } = useLibraryNav();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (citationId: string) => {
    setError(null);
    try {
      await api.findingSourceRemove(citationId);
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <div className="flex flex-col gap-2 text-[0.875rem]">
      <div className="flex flex-wrap items-center gap-2">
        {finding.sources.map((c) => (
          <span key={c.id} className="inline-flex max-w-full items-center rounded-aw border border-border">
            {c.removed ? (
              <span className="px-2 py-1 text-text-muted">
                <BookOpen className="mr-1 inline size-3.5" aria-hidden="true" />
                {citationText(t, c)} <em>{t("library.citations.removed")}</em>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => openSource(c.sourceId, c.segmentId ?? undefined)}
                className="min-h-8 truncate px-2 text-left font-medium text-link hover:bg-bg-secondary"
                title={t("library.citations.openTitle")}
              >
                <BookOpen className="mr-1 inline size-3.5" aria-hidden="true" />
                {citationText(t, c)}
              </button>
            )}
            <button
              type="button"
              onClick={() => remove(c.id)}
              aria-label={t("library.citations.removeLabel", { citation: citationText(t, c) })}
              className="inline-flex size-8 shrink-0 items-center justify-center border-l border-border text-text-muted hover:bg-bg-secondary"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        {!picking && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="min-h-8 rounded-aw px-2 text-text-muted underline-offset-2 hover:text-text-strong hover:underline"
          >
            {t("library.citations.add")}
          </button>
        )}
      </div>
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
      {picking && (
        <SourcePicker
          finding={finding}
          onQuote={onQuote}
          onDone={(changed) => {
            setPicking(false);
            if (changed) onChanged();
          }}
        />
      )}
    </div>
  );
}

function SourcePicker({ finding, onQuote, onDone }: { finding: Finding; onQuote?: (text: string) => void; onDone: (changed: boolean) => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LibraryHit[] | null>(null);
  const [quote, setQuote] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setError(null);
    try {
      setHits((await api.librarySearch({ query })).hits);
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const cite = async (hit: LibraryHit) => {
    setError(null);
    try {
      await api.findingSourceAdd({ findingId: finding.id, segmentId: hit.segmentId });
      if (quote && onQuote) {
        const window = await api.libraryOpenSegment(hit.segmentId);
        const segment = window.segments.find((s) => s.id === hit.segmentId);
        if (segment) onQuote(segment.text);
      }
      onDone(true);
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <section aria-label={t("library.citations.pickerLabel")} className="flex flex-col gap-2 rounded-aw border border-border-subtle bg-bg-secondary p-3">
      <form onSubmit={search} className="flex gap-2" role="search">
        <label htmlFor={`${id}-q`} className="sr-only">{t("library.citations.searchLabel")}</label>
        <input
          id={`${id}-q`}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("library.citations.searchPlaceholder")}
          className="h-9 min-w-0 flex-1 rounded-aw border border-border bg-bg px-2"
        />
        <Button type="submit">{t("common.search")}</Button>
        <Button variant="quiet" onClick={() => onDone(false)}>{t("common.cancel")}</Button>
      </form>
      {onQuote && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={quote} onChange={(e) => setQuote(e.target.checked)} className="size-4 accent-[var(--aw-primary)]" />
          {finding.content.trim() ? t("library.citations.replaceQuote") : t("library.citations.useQuote")}
        </label>
      )}
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
      {hits?.length === 0 && <p className="m-0 text-text-muted">{t("library.search.nothingFound")}</p>}
      {hits && hits.length > 0 && (
        <ul aria-label={t("library.citations.listLabel")} className="m-0 flex max-h-72 list-none flex-col overflow-y-auto p-0">
          {hits.map((hit) => (
            <li key={hit.segmentId} className="border-t border-border-subtle">
              <button type="button" onClick={() => cite(hit)} className="flex w-full flex-col items-start gap-0.5 px-1 py-2 text-left hover:bg-bg">
                <span className="font-semibold text-text-strong">
                  {t("library.citations.cite", { citation: citationText(t, { author: hit.author, title: hit.sourceTitle, locator: hit.locator }) })}
                </span>
                <span className="reading">{highlighted(hit.snippet)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
