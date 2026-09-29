import { useId, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { Notice } from "@/design-system/Notice";
import { useScripture } from "./ScriptureContext";

/** Scripture search: form, filters and results. A result opens its verse. */
export function SearchResultsView() {
  const { search, runSearch, closeSearch, goTo, books, translation } = useScripture();
  const id = useId();
  const [query, setQuery] = useState(search?.query ?? "");
  const [currentOnly, setCurrentOnly] = useState(search?.currentOnly ?? true);
  const [book, setBook] = useState(search?.book ?? "");
  if (!search) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch({ query, currentOnly, book });
  };

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="m-0 font-display text-[1.5rem] font-semibold text-text-strong">
          Search
        </h2>
        <button type="button" onClick={closeSearch} className="inline-flex min-h-9 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-strong hover:bg-bg">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to reading
        </button>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
        <label htmlFor={`${id}-q`} className="text-[0.9375rem] font-medium text-text-strong">
          Words or “exact phrase”
        </label>
        <div className="flex gap-2">
          <input id={`${id}-q`} value={query} onChange={(e) => setQuery(e.target.value)} className="h-10 min-w-0 flex-1 rounded-aw border border-border bg-bg px-3 text-[0.9375rem]" />
          <button type="submit" className="h-10 rounded-aw border border-border px-3 text-[0.9375rem] font-medium hover:bg-bg">Search</button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.9375rem]">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={currentOnly} onChange={(e) => setCurrentOnly(e.target.checked)} className="size-4 accent-[var(--aw-primary)]" />
            Only {translation?.shortName ?? "this translation"}
          </label>
          <label className="flex items-center gap-2">
            <span>Book</span>
            <select value={book} onChange={(e) => setBook(e.target.value)} className="h-9 rounded-aw border border-border bg-bg px-2">
              <option value="">All books</option>
              {books.map((b) => (
                <option key={b.code} value={b.code}>{b.name}</option>
              ))}
            </select>
          </label>
        </div>
      </form>

      {search.busy && <p role="status" className="m-0 text-text-muted">Searching…</p>}
      {search.error && <Notice tone="error">{search.error}</Notice>}
      {search.results && (
        <>
          <p role="status" className="m-0 text-[0.9375rem] text-text-muted">
            {search.results.hits.length === 0
              ? "No verses found."
              : `${search.results.hits.length}${search.results.truncated ? "+" : ""} verse${search.results.hits.length === 1 ? "" : "s"} found${search.results.truncated ? " — showing the first 200" : ""}.`}
          </p>
          <ol aria-label="Search results" className="m-0 flex list-none flex-col p-0">
            {search.results.hits.map((hit) => (
              <li key={`${hit.translationId}-${hit.reference.canonical}`} className="border-t border-border-subtle">
                <button type="button" onClick={() => goTo(hit.reference)} className="flex w-full flex-col items-start gap-1 px-1 py-3 text-left hover:bg-bg">
                  <span className="text-[0.9375rem] font-semibold text-link">
                    {hit.reference.display} <span className="font-normal text-text-muted">· {hit.translationShortName}</span>
                  </span>
                  <span className="reading text-[1rem]">{hit.text}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
