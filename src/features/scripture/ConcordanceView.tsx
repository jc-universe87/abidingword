import { useEffect, useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatNumber } from "@/i18n/format";
import { bookName, referenceLabel } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { ConcordanceHit, ConcordanceMode, ConcordanceResult } from "@/types/scripture";
import { useScripture } from "./ScriptureContext";

const HEBREW = /[֐-׿יִ-ﭏ]/;
const field = "h-10 min-w-0 aw-input px-2 text-[0.9375rem] text-text";

/** Text written right to left (Hebrew) is shown so; everything around it keeps the interface's direction. */
export function textDirection(text: string): "rtl" | undefined {
  return HEBREW.test(text) ? "rtl" : undefined;
}

interface Submitted {
  query: string;
  mode: ConcordanceMode;
  translationId: string;
  nonce: number;
}

/**
 * The concordance: where a word, or words together, occur in one Bible, by
 * book. Surface forms only — the words as this Bible writes them; nothing here
 * claims to know a lemma. Opening a verse moves Scripture there (with Back),
 * and never changes a Study.
 */
export function ConcordanceView() {
  const { t } = useTranslation();
  const api = useApi();
  const { translations, translation, concordanceRequest, goTo, bookByCode } = useScripture();
  const id = useId();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ConcordanceMode>("word");
  const [translationId, setTranslationId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [result, setResult] = useState<{ nonce: number; data?: ConcordanceResult; error?: string } | null>(null);
  // Each book's verses, once asked for (when there were too many to list at once).
  const [books, setBooks] = useState<Record<string, { open: boolean; hits?: ConcordanceHit[]; error?: string }>>({});
  const chosen = translationId ?? translation?.id ?? "";

  // A request from elsewhere (a word study): show it and look.
  const [seenRequest, setSeenRequest] = useState(concordanceRequest?.nonce ?? 0);
  if (concordanceRequest && concordanceRequest.nonce !== seenRequest) {
    setSeenRequest(concordanceRequest.nonce);
    const tid = concordanceRequest.translationId && translations.some((b) => b.id === concordanceRequest.translationId) ? concordanceRequest.translationId : chosen;
    setQuery(concordanceRequest.query);
    setMode(concordanceRequest.mode);
    setTranslationId(tid || null);
    setBooks({});
    if (tid && concordanceRequest.query.trim()) setSubmitted({ query: concordanceRequest.query, mode: concordanceRequest.mode, translationId: tid, nonce: (submitted?.nonce ?? 0) + 1 });
  }

  useEffect(() => {
    if (!submitted) return;
    let active = true;
    api.scriptureConcordance({ translationId: submitted.translationId, query: submitted.query, mode: submitted.mode }).then(
      (data) => active && setResult({ nonce: submitted.nonce, data }),
      (e) => active && setResult({ nonce: submitted.nonce, error: toApiError(e).message }),
    );
    return () => {
      active = false;
    };
  }, [api, submitted]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!chosen) return;
    setBooks({});
    setSubmitted({ query, mode, translationId: chosen, nonce: (submitted?.nonce ?? 0) + 1 });
  };

  const current = result && submitted && result.nonce === submitted.nonce ? result : null;
  const busy = submitted !== null && current === null;
  const data = current?.data;

  const toggleBook = async (code: string) => {
    const state = books[code];
    if (state?.open) return setBooks({ ...books, [code]: { ...state, open: false } });
    if (state?.hits) return setBooks({ ...books, [code]: { ...state, open: true } });
    setBooks((b) => ({ ...b, [code]: { open: true } }));
    if (!submitted) return;
    try {
      const one = await api.scriptureConcordance({ translationId: submitted.translationId, query: submitted.query, mode: submitted.mode, book: code });
      setBooks((b) => ({ ...b, [code]: { open: true, hits: one.hits } }));
    } catch (e) {
      setBooks((b) => ({ ...b, [code]: { open: true, error: toApiError(e).message } }));
    }
  };

  const hitList = (hits: ConcordanceHit[]) => (
    <ul className="m-0 flex list-none flex-col p-0">
      {hits.map((hit) => {
        const passage = referenceLabel(hit.reference, bookByCode.get(hit.reference.book)?.chapterCount);
        return (
          <li key={hit.reference.canonical}>
            <button
              type="button"
              onClick={() => goTo(hit.reference)}
              aria-label={t("scripture.concordance.open", { passage })}
              className="flex w-full flex-col items-start gap-0.5 rounded-sm px-1 py-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            >
              <span className="type-meta font-medium !text-text-strong">{passage}</span>
              <span className="reading text-[0.9375rem] text-text" dir={textDirection(hit.text)}>
                {highlighted(hit)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  const inline = new Map<string, ConcordanceHit[]>();
  if (data?.hitsComplete) for (const hit of data.hits) inline.set(hit.reference.book, [...(inline.get(hit.reference.book) ?? []), hit]);

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1">
          <span className="type-subhead">{t("scripture.concordance.queryLabel")}</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} dir="auto" className={`${field} px-3`} />
        </label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <fieldset className="m-0 flex items-center gap-3 border-0 p-0">
            <legend className="sr-only">{t("scripture.concordance.modeLabel")}</legend>
            {(["word", "phrase"] as const).map((m) => (
              <label key={m} className="flex min-h-10 items-center gap-1.5 text-[0.9375rem] text-text-strong">
                <input type="radio" name={`${id}-mode`} value={m} checked={mode === m} onChange={() => setMode(m)} />
                {t(`scripture.concordance.mode.${m}`)}
              </label>
            ))}
          </fieldset>
          {translations.length > 1 && (
            <label className="flex items-center gap-2">
              <span className="text-[0.9375rem] text-text-muted">{t("scripture.concordance.bible")}</span>
              <select value={chosen} onChange={(e) => setTranslationId(e.target.value)} className={field}>
                {translations.map((b) => (
                  <option key={b.id} value={b.id}>{b.shortName}</option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" disabled={!query.trim() || !chosen} className="h-10 rounded-aw border border-border px-3 text-[0.9375rem] font-medium text-text-strong hover:bg-hover disabled:opacity-50">
            {t("scripture.concordance.find")}
          </button>
        </div>
        <p className="m-0 type-meta">{t("scripture.concordance.hint")}</p>
      </form>

      <div role="status" className="text-[0.9375rem] text-text-strong">
        {busy && <span className="text-text-muted">{t("scripture.concordance.looking")}</span>}
        {data && data.verses > 0 && (
          <span>
            {t("scripture.concordance.occurrences", { count: data.occurrences, formatted: formatNumber(data.occurrences) })}
            {t("common.listSeparator")}
            {t("scripture.concordance.verses", { count: data.verses, formatted: formatNumber(data.verses) })}
          </span>
        )}
        {data && data.verses === 0 && <span className="text-text-muted">{t("scripture.concordance.none", { query: data.query })}</span>}
      </div>
      {current?.error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{current.error}</p>}

      {data && data.books.length > 0 && (
        <section aria-labelledby={`${id}-books`} className="flex flex-col gap-1">
          <h3 id={`${id}-books`} className="type-group m-0">{t("scripture.concordance.books")}</h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {data.books.map((b) => {
              const name = bookName(b.code, b.name);
              const label = t("scripture.concordance.bookCount", { book: name, count: b.occurrences, formatted: formatNumber(b.occurrences) });
              const listed = inline.get(b.code);
              const state = books[b.code];
              const groupId = `${id}-book-${b.code}`;
              if (listed) {
                return (
                  <li key={b.code} className="border-t border-border-subtle pt-1">
                    <section aria-labelledby={groupId}>
                      <h4 id={groupId} className="type-group m-0 py-1">{label}</h4>
                      {hitList(listed)}
                    </section>
                  </li>
                );
              }
              return (
                <li key={b.code} className="border-t border-border-subtle">
                  <button
                    type="button"
                    aria-expanded={Boolean(state?.open)}
                    aria-controls={state?.open ? groupId : undefined}
                    onClick={() => void toggleBook(b.code)}
                    className="flex min-h-10 w-full items-center gap-1.5 rounded-sm px-1 text-left font-ui text-[0.9375rem] font-semibold text-text-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                  >
                    {state?.open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                    {label}
                  </button>
                  {state?.open && (
                    <div id={groupId} role="group" aria-label={name} className="pl-5">
                      {state.error ? (
                        <p role="alert" className="m-0 text-[0.9375rem] text-danger">{state.error}</p>
                      ) : state.hits ? (
                        hitList(state.hits)
                      ) : (
                        <p className="m-0 text-[0.9375rem] text-text-muted">{t("scripture.concordance.looking")}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The verse with each occurrence marked. */
function highlighted(hit: ConcordanceHit) {
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of hit.matches) {
    if (start < at || end > hit.text.length) continue;
    if (start > at) out.push(hit.text.slice(at, start));
    out.push(<mark key={start} className="rounded-sm bg-note px-0.5 font-semibold text-text-strong">{hit.text.slice(start, end)}</mark>);
    at = end;
  }
  if (at < hit.text.length) out.push(hit.text.slice(at));
  return out;
}
