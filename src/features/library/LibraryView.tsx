import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { highlighted } from "@/lib/highlight";
import { formatDate, formatNumber } from "@/i18n/format";
import { SOURCE_TYPES, type LibraryResults, type SourceType } from "@/types/library";
import { formatLabel, locatorLabel, sourceTypeLabel } from "./labels";
import { useLibraryNav } from "./LibraryNav";

/** The library: every source, filters, full-text search, add and remove. */
export function LibraryView({ initialQuery, onSearched, onClose, onRemoved }: { initialQuery?: string; onSearched?: (query: string) => void; onClose: () => void; onRemoved?: (sourceId: string) => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const { openSource, addSource } = useLibraryNav();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [sourceType, setSourceType] = useState<SourceType | "">("");
  const [language, setLanguage] = useState("");
  const sources = useLoad(
    useCallback(
      () => api.libraryList({ sourceType: sourceType || undefined, language: language || undefined }),
      [api, sourceType, language],
    ),
  );
  const languages = useLoad(useCallback(() => api.libraryLanguages(), [api]));
  const [query, setQuery] = useState(initialQuery ?? "");
  const [results, setResults] = useState<LibraryResults | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => heading.current?.focus(), []);

  const search = useCallback(
    async (text: string, offset = 0) => {
      setSearchError(null);
      try {
        const found = await api.librarySearch({ query: text, offset });
        setResults((previous) => (offset > 0 && previous ? { ...found, hits: [...previous.hits, ...found.hits] } : found));
      } catch (e) {
        setSearchError(toApiError(e).message);
        setResults(null);
      }
    },
    [api],
  );
  // Search once on opening (from the app bar, or returning from a source).
  const opening = useRef(initialQuery);
  useEffect(() => {
    if (opening.current) void search(opening.current);
  }, [search]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    onSearched?.(query);
    void search(query);
  };

  // How many marks the source being removed has (v0.14): said in the confirmation, so nothing is lost unawares.
  const [markCount, setMarkCount] = useState<{ sourceId: string; count: number } | null>(null);
  const confirm = (sourceId: string) => {
    setConfirming(sourceId);
    setMarkCount(null);
    api.sourceMarksSources().then(
      (all) => setMarkCount({ sourceId, count: all.find((x) => x.sourceId === sourceId)?.count ?? 0 }),
      () => undefined,
    );
  };

  const remove = async (sourceId: string) => {
    setError(null);
    try {
      await api.libraryRemoveSource(sourceId);
      setConfirming(null);
      onRemoved?.(sourceId);
      sources.reload();
      setResults(null);
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const select = "aw-input";
  return (
    <main aria-labelledby={`${id}-title`} className="min-h-0 flex-1 overflow-y-auto bg-bg">
      {/* Back stays in reach while the page scrolls: the same full-width bar as Settings (v0.18.5). */}
      <div className="sticky top-0 z-10 border-b border-border-subtle bg-bg">
        <div className="mx-auto max-w-[52rem] px-4 py-2 sm:px-8">
          <Button variant="quiet" onClick={onClose}>
            <ArrowLeft className="size-4" aria-hidden="true" /> {t("library.view.backToWorkspace")}
          </Button>
        </div>
      </div>
      <div className="mx-auto flex max-w-[52rem] flex-col gap-8 px-4 pb-24 pt-6 sm:px-8">
        <div className="flex flex-col items-start gap-4">
          <div className="flex w-full flex-wrap items-end justify-between gap-3">
            <h1 id={`${id}-title`} ref={heading} tabIndex={-1} className="type-title m-0">
              {t("library.view.title")}
            </h1>
            <Button variant="primary" onClick={addSource}>
              <Plus className="size-4" aria-hidden="true" /> {t("library.addToLibraryEllipsis")}
            </Button>
          </div>
          <p className="m-0 text-text-muted">{t("library.view.intro")}</p>
        </div>

        <section aria-labelledby={`${id}-search`} className="flex flex-col gap-3">
          <h2 id={`${id}-search`} className="type-section m-0">{t("library.search.heading")}</h2>
          <form onSubmit={submit} className="flex gap-2" noValidate role="search">
            <label htmlFor={`${id}-q`} className="sr-only">{t("library.search.label")}</label>
            <input id={`${id}-q`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("library.search.placeholder")} className="aw-input flex-1" />
            <Button type="submit">{t("common.search")}</Button>
          </form>
          {searchError && <Notice tone="error">{searchError}</Notice>}
          {results && (
            <>
              <p role="status" className="m-0 text-[0.9375rem] text-text-muted">
                {results.hits.length === 0
                  ? t("library.search.nothingFound")
                  : t(results.hasMore ? "library.search.resultCountMore" : "library.search.resultCount", {
                      count: results.hits.length,
                      number: formatNumber(results.hits.length),
                    })}
              </p>
              <ol aria-label={t("library.search.resultsLabel")} className="m-0 flex list-none flex-col p-0">
                {results.hits.map((hit) => (
                  <li key={hit.segmentId} className="border-t border-border-subtle">
                    <button type="button" onClick={() => openSource(hit.sourceId, hit.segmentId)} className="flex w-full flex-col items-start gap-1 px-1 py-3 text-left hover:bg-hover">
                      <span className="font-medium text-text-strong">
                        {hit.author ? `${hit.author}, ` : ""}
                        <cite className="not-italic">{hit.sourceTitle}</cite>
                        {hit.locator && <span className="font-normal text-text-muted">{t("common.listSeparator")}{locatorLabel(t, hit.locator)}</span>}
                      </span>
                      <span className="reading text-[1rem]">{highlighted(hit.snippet)}</span>
                    </button>
                  </li>
                ))}
              </ol>
              {results.hasMore && (
                <div>
                  <Button onClick={() => search(query, results.hits.length)}>{t("library.search.showMore")}</Button>
                </div>
              )}
            </>
          )}
        </section>

        <section aria-labelledby={`${id}-all`} className="flex flex-col gap-3">
          <h2 id={`${id}-all`} className="type-section m-0">{t("library.filter.heading")}</h2>
          <div role="group" aria-label={t("library.filter.label")} className="flex flex-wrap gap-x-4 gap-y-2 text-[0.9375rem]">
            <label className="flex items-center gap-2">
              {t("library.filter.type")}
              <select value={sourceType} onChange={(e) => setSourceType(e.target.value as SourceType | "")} className={select}>
                <option value="">{t("library.filter.allTypes")}</option>
                {SOURCE_TYPES.map((type) => <option key={type} value={type}>{sourceTypeLabel(t, type)}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              {t("library.filter.language")}
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className={select}>
                <option value="">{t("library.filter.allLanguages")}</option>
                {(languages.data ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          </div>
          {sources.error && <Notice tone="error">{sources.error.message}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {sources.data?.length === 0 && (
            <p className="m-0 text-text-muted">{sourceType || language ? t("library.filter.noMatch") : t("library.filter.empty")}</p>
          )}
          {sources.data && sources.data.length > 0 && (
            <ul aria-label={t("library.filter.listLabel")} className="m-0 list-none border-t border-border-subtle p-0">
              {sources.data.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 border-b border-border-subtle py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <button type="button" onClick={() => openSource(s.id)} className="min-w-0 text-left">
                      <span className="type-item block hover:underline">{s.title}</span>
                      <span className="type-meta block">
                        {[
                          s.author,
                          sourceTypeLabel(t, s.sourceType),
                          s.format ? formatLabel(t, s.format) : null,
                          s.language,
                          t("library.view.addedOn", { date: formatDate(s.createdAt) }),
                        ]
                          .filter(Boolean)
                          .join(t("common.listSeparator"))}
                      </span>
                    </button>
                    {/* Rarely needed: a quiet icon on each row, its name saying which source. */}
                    <button
                      type="button"
                      onClick={() => confirm(s.id)}
                      aria-label={t("library.remove.label", { title: s.title })}
                      title={t("library.remove.label", { title: s.title })}
                      className="aw-icon-button hover:!text-danger"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  {confirming === s.id && (
                    <div role="alertdialog" aria-label={t("library.remove.dialogLabel", { title: s.title })} className="flex flex-col gap-3 border-l-[3px] border-danger bg-hover px-4 py-3">
                      <p className="m-0">
                        <Trans i18nKey="library.remove.message" values={{ title: s.title }} components={{ strong: <strong /> }} />
                      </p>
                      {markCount?.sourceId === s.id && markCount.count > 0 && <p className="m-0">{t("library.remove.marks", { count: markCount.count })}</p>}
                      <div className="flex gap-2">
                        <Button variant="danger" onClick={() => remove(s.id)}>{t("library.remove.confirm")}</Button>
                        <Button autoFocus onClick={() => setConfirming(null)}>{t("library.remove.keep")}</Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
