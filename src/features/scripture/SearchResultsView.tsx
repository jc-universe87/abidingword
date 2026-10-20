import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { bookName, referenceLabel } from "@/i18n/scripture";
import { Notice } from "@/design-system/Notice";
import { useScripture } from "./ScriptureContext";

/** Scripture search: form, filters and results. A result opens its verse. */
export function SearchResultsView() {
  const { t } = useTranslation();
  const { search, runSearch, closeSearch, goTo, books, bookByCode, translation } = useScripture();
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
        <h2 id={`${id}-title`} className="type-title m-0">
          {t("scripture.search.title")}
        </h2>
        <button type="button" onClick={closeSearch} className="inline-flex min-h-9 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-strong hover:bg-hover">
          <ArrowLeft className="size-4" aria-hidden="true" /> {t("scripture.search.backToReading")}
        </button>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
        <label htmlFor={`${id}-q`} className="text-[0.9375rem] font-medium text-text-strong">
          {t("scripture.search.queryLabel")}
        </label>
        <div className="flex gap-2">
          <input id={`${id}-q`} value={query} onChange={(e) => setQuery(e.target.value)} className="h-10 min-w-0 flex-1 aw-input px-3 text-[0.9375rem]" />
          <button type="submit" className="h-10 rounded-aw border border-border px-3 text-[0.9375rem] font-medium hover:bg-hover">{t("scripture.search.submit")}</button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.9375rem]">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={currentOnly} onChange={(e) => setCurrentOnly(e.target.checked)} className="size-4 accent-[var(--aw-primary)]" />
            {translation ? t("scripture.search.onlyNamed", { name: translation.shortName }) : t("scripture.search.onlyCurrent")}
          </label>
          <label className="flex items-center gap-2">
            <span>{t("scripture.search.book")}</span>
            <select value={book} onChange={(e) => setBook(e.target.value)} className="h-9 aw-input px-2">
              <option value="">{t("scripture.search.allBooks")}</option>
              {books.map((b) => (
                <option key={b.code} value={b.code}>{bookName(b.code, b.name)}</option>
              ))}
            </select>
          </label>
        </div>
      </form>

      {search.busy && <p role="status" className="m-0 text-text-muted">{t("scripture.search.searching")}</p>}
      {search.error && <Notice tone="error">{search.error}</Notice>}
      {search.results && (
        <>
          <p role="status" className="m-0 text-[0.9375rem] text-text-muted">
            {search.results.hits.length === 0
              ? t("scripture.search.noResults")
              : search.results.truncated
                ? t("scripture.search.foundTruncated", { count: search.results.hits.length, limit: search.results.hits.length })
                : t("scripture.search.found", { count: search.results.hits.length })}
          </p>
          <ol aria-label={t("scripture.search.results")} className="m-0 flex list-none flex-col p-0">
            {search.results.hits.map((hit) => (
              <li key={`${hit.translationId}-${hit.reference.canonical}`} className="border-t border-border-subtle">
                <button type="button" onClick={() => goTo(hit.reference)} className="flex w-full flex-col items-start gap-1 px-1 py-3 text-left hover:bg-hover">
                  <span className="text-[0.9375rem] font-medium text-link">
                    {referenceLabel(hit.reference, bookByCode.get(hit.reference.book)?.chapterCount)}
                    <span className="font-normal text-text-muted">
                      {t("common.listSeparator")}
                      {hit.translationShortName}
                    </span>
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
