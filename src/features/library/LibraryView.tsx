import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { highlighted } from "@/lib/highlight";
import { formatDate } from "@/features/studies/format";
import { SOURCE_TYPES, type LibraryResults, type SourceType } from "@/types/library";
import { FORMAT_LABELS, SOURCE_TYPE_LABELS } from "./labels";
import { useLibraryNav } from "./LibraryNav";

/** The library: every source, filters, full-text search, add and remove. */
export function LibraryView({ initialQuery, onSearched, onClose, onRemoved }: { initialQuery?: string; onSearched?: (query: string) => void; onClose: () => void; onRemoved?: (sourceId: string) => void }) {
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

  const select = "h-9 rounded-aw border border-border bg-bg px-2 text-[0.9375rem]";
  return (
    <main aria-labelledby={`${id}-title`} className="min-h-0 flex-1 overflow-y-auto bg-bg">
      <div className="mx-auto flex max-w-[52rem] flex-col gap-8 px-8 pb-24 pt-8">
        <div className="flex flex-col items-start gap-4">
          <Button variant="quiet" onClick={onClose}>
            <ArrowLeft className="size-4" aria-hidden="true" /> Back to workspace
          </Button>
          <div className="flex w-full flex-wrap items-end justify-between gap-3">
            <h1 id={`${id}-title`} ref={heading} tabIndex={-1} className="m-0 font-display text-[1.875rem] font-heading text-text-strong">
              Library
            </h1>
            <Button variant="primary" onClick={addSource}>
              <Plus className="size-4" aria-hidden="true" /> Add to library…
            </Button>
          </div>
          <p className="m-0 text-text-muted">
            Your own books, notes and documents, stored on this computer. Every search result shows exactly where it comes from.
          </p>
        </div>

        <section aria-labelledby={`${id}-search`} className="flex flex-col gap-3">
          <h2 id={`${id}-search`} className="m-0 text-[1.125rem] font-semibold text-text-strong">Search the library</h2>
          <form onSubmit={submit} className="flex gap-2" noValidate role="search">
            <label htmlFor={`${id}-q`} className="sr-only">Search the library</label>
            <input id={`${id}-q`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Words or “exact phrase”" className="h-10 min-w-0 flex-1 rounded-aw border border-border bg-bg px-3" />
            <Button type="submit">Search</Button>
          </form>
          {searchError && <Notice tone="error">{searchError}</Notice>}
          {results && (
            <>
              <p role="status" className="m-0 text-[0.9375rem] text-text-muted">
                {results.hits.length === 0 ? "Nothing found in your library." : `${results.hits.length}${results.hasMore ? "+" : ""} passage${results.hits.length === 1 ? "" : "s"} found.`}
              </p>
              <ol aria-label="Library search results" className="m-0 flex list-none flex-col p-0">
                {results.hits.map((hit) => (
                  <li key={hit.segmentId} className="border-t border-border-subtle">
                    <button type="button" onClick={() => openSource(hit.sourceId, hit.segmentId)} className="flex w-full flex-col items-start gap-1 px-1 py-3 text-left hover:bg-bg-secondary">
                      <span className="font-semibold text-text-strong">
                        {hit.author ? `${hit.author}, ` : ""}
                        <cite className="not-italic">{hit.sourceTitle}</cite>
                        {hit.locator && <span className="font-normal text-text-muted"> · {hit.locator}</span>}
                      </span>
                      <span className="reading text-[1rem]">{highlighted(hit.snippet)}</span>
                    </button>
                  </li>
                ))}
              </ol>
              {results.hasMore && (
                <div>
                  <Button onClick={() => search(query, results.hits.length)}>Show more results</Button>
                </div>
              )}
            </>
          )}
        </section>

        <section aria-labelledby={`${id}-all`} className="flex flex-col gap-3">
          <h2 id={`${id}-all`} className="m-0 text-[1.125rem] font-semibold text-text-strong">All sources</h2>
          <div role="group" aria-label="Filter sources" className="flex flex-wrap gap-x-4 gap-y-2 text-[0.9375rem]">
            <label className="flex items-center gap-2">
              Type
              <select value={sourceType} onChange={(e) => setSourceType(e.target.value as SourceType | "")} className={select}>
                <option value="">All types</option>
                {SOURCE_TYPES.map((t) => <option key={t} value={t}>{SOURCE_TYPE_LABELS[t]}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Language
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className={select}>
                <option value="">All languages</option>
                {(languages.data ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          </div>
          {sources.error && <Notice tone="error">{sources.error.message}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {sources.data?.length === 0 && (
            <p className="m-0 text-text-muted">{sourceType || language ? "No sources match these filters." : "Nothing in your library yet. Add a PDF, EPUB, Markdown or text file."}</p>
          )}
          {sources.data && sources.data.length > 0 && (
            <ul aria-label="Sources" className="m-0 list-none border-t border-border-subtle p-0">
              {sources.data.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 border-b border-border-subtle py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <button type="button" onClick={() => openSource(s.id)} className="min-w-0 text-left">
                      <span className="block font-display text-[1.25rem] font-heading text-text-strong hover:underline">{s.title}</span>
                      <span className="block text-[0.9375rem] text-text-muted">
                        {[s.author, SOURCE_TYPE_LABELS[s.sourceType], s.format ? FORMAT_LABELS[s.format] : null, s.language].filter(Boolean).join(" · ")}
                        {" · added "}{formatDate(s.createdAt)}
                      </span>
                    </button>
                    <Button variant="quiet" onClick={() => setConfirming(s.id)} aria-label={`Remove ${s.title}`}>Remove…</Button>
                  </div>
                  {confirming === s.id && (
                    <div role="alertdialog" aria-label={`Remove ${s.title}?`} className="flex flex-col gap-3 border-l-[3px] border-danger bg-bg-secondary px-4 py-3">
                      <p className="m-0">
                        Remove <strong>{s.title}</strong> from your library? Its text and Abiding Word’s copy of the file are
                        deleted; your original file is not touched. Findings that cite it keep a record of the citation.
                      </p>
                      <div className="flex gap-2">
                        <Button variant="primary" onClick={() => remove(s.id)}>Remove from library</Button>
                        <Button autoFocus onClick={() => setConfirming(null)}>Keep it</Button>
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
