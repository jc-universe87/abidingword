import { useEffect, useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatNumber } from "@/i18n/format";
import { bookName, referenceLabel } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { BibleTranslation, ConcordanceBook, ConcordanceHit, ConcordanceMode, ConcordanceResult, LemmaEntry, LemmaResult, LemmaSelection } from "@/types/scripture";
import { describeMorph } from "./morphology";
import { useScripture } from "./ScriptureContext";

const HEBREW = /[֐-׿יִ-ﭏ]/;
const field = "h-10 min-w-0 aw-input px-2 text-[0.9375rem] text-text";
const quiet = "h-10 rounded-aw border border-border px-3 text-[0.9375rem] font-medium text-text-strong hover:bg-hover disabled:opacity-50";

/** Text written right to left (Hebrew) is shown so; everything around it keeps the interface's direction. */
export function textDirection(text: string): "rtl" | undefined {
  return HEBREW.test(text) ? "rtl" : undefined;
}

/** Whether a Bible's own markup gives lemmas or lexical numbers to search by (v0.21). */
export function hasLemmas(bible: BibleTranslation | undefined | null): boolean {
  return Boolean(bible?.words && (bible.words.lemmas || bible.words.lexicalIds));
}

type Mode = ConcordanceMode | "lemma";

interface Submitted {
  query: string;
  mode: ConcordanceMode;
  translationId: string;
  nonce: number;
}

interface LemmaAsked {
  text: string;
  translationId: string;
  selection?: LemmaSelection;
  nonce: number;
}

/**
 * The concordance: where a word, or words together, occur in one Bible, by
 * book. Word and phrase look at surface forms only — the words as this Bible
 * writes them. Lemma (v0.21) looks at the Bible's own word annotations, and is
 * offered only for a Bible that has them. Opening a verse moves Scripture
 * there (with Back), and never changes a Study.
 */
export function ConcordanceView() {
  const { t } = useTranslation();
  const api = useApi();
  const { translations, translation, concordanceRequest } = useScripture();
  const id = useId();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("word");
  const [translationId, setTranslationId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [lemmaAsked, setLemmaAsked] = useState<LemmaAsked | null>(null);
  const [result, setResult] = useState<{ nonce: number; data?: ConcordanceResult; error?: string } | null>(null);
  const chosen = translationId ?? translation?.id ?? "";
  const bible = translations.find((b) => b.id === chosen);
  const lemmas = hasLemmas(bible);

  // A request from elsewhere (a word study, the word details): show it and look.
  const [seenRequest, setSeenRequest] = useState(concordanceRequest?.nonce ?? 0);
  if (concordanceRequest && concordanceRequest.nonce !== seenRequest) {
    setSeenRequest(concordanceRequest.nonce);
    const tid = concordanceRequest.translationId && translations.some((b) => b.id === concordanceRequest.translationId) ? concordanceRequest.translationId : chosen;
    setQuery(concordanceRequest.query);
    setMode(concordanceRequest.mode);
    setTranslationId(tid || null);
    if (concordanceRequest.mode === "lemma") {
      setSubmitted(null);
      if (tid) setLemmaAsked({ text: concordanceRequest.query, translationId: tid, selection: concordanceRequest.selection, nonce: (lemmaAsked?.nonce ?? 0) + 1 });
    } else {
      setLemmaAsked(null);
      if (tid && concordanceRequest.query.trim()) setSubmitted({ query: concordanceRequest.query, mode: concordanceRequest.mode, translationId: tid, nonce: (submitted?.nonce ?? 0) + 1 });
    }
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
    if (mode === "lemma") {
      setSubmitted(null);
      setLemmaAsked({ text: query, translationId: chosen, nonce: (lemmaAsked?.nonce ?? 0) + 1 });
      return;
    }
    setLemmaAsked(null);
    setSubmitted({ query, mode, translationId: chosen, nonce: (submitted?.nonce ?? 0) + 1 });
  };

  const current = result && submitted && result.nonce === submitted.nonce ? result : null;
  const busy = submitted !== null && current === null;
  const data = current?.data;
  const lemmaUnavailable = mode === "lemma" && !lemmas;
  const modes: Mode[] = lemmas || mode === "lemma" ? ["word", "phrase", "lemma"] : ["word", "phrase"];

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1">
          <span className="type-subhead">{t(mode === "lemma" ? "scripture.concordance.lemmaLabel" : "scripture.concordance.queryLabel")}</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} dir="auto" className={`${field} px-3`} />
        </label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <fieldset className="m-0 flex flex-wrap items-center gap-3 border-0 p-0">
            <legend className="sr-only">{t("scripture.concordance.modeLabel")}</legend>
            {modes.map((m) => (
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
          <button type="submit" disabled={!query.trim() || !chosen || lemmaUnavailable} className={quiet}>
            {t("scripture.concordance.find")}
          </button>
        </div>
        <p className="m-0 type-meta">{t(mode === "lemma" ? "scripture.concordance.lemmaHint" : "scripture.concordance.hint")}</p>
        {lemmaUnavailable && <p role="status" className="m-0 text-[0.9375rem] text-text-muted">{t("scripture.concordance.lemmaUnavailable")}</p>}
      </form>

      {mode === "lemma" && lemmaAsked && !lemmaUnavailable && lemmaAsked.translationId === chosen ? (
        <LemmaSearch key={lemmaAsked.nonce} asked={lemmaAsked} />
      ) : mode !== "lemma" ? (
        <>
          <div role="status" className="text-[0.9375rem] text-text-strong">
            {busy && <span className="text-text-muted">{t("scripture.concordance.looking")}</span>}
            {data && data.verses > 0 && <Totals occurrences={data.occurrences} verses={data.verses} />}
            {data && data.verses === 0 && <span className="text-text-muted">{t("scripture.concordance.none", { query: data.query })}</span>}
          </div>
          {current?.error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{current.error}</p>}
          {data && submitted && (
            <BookResults
              key={submitted.nonce}
              books={data.books}
              hits={data.hitsComplete ? data.hits : null}
              fetchBook={(code) => api.scriptureConcordance({ translationId: submitted.translationId, query: submitted.query, mode: submitted.mode, book: code }).then((one) => one.hits)}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

function Totals({ occurrences, verses }: { occurrences: number; verses: number }) {
  const { t } = useTranslation();
  return (
    <span>
      {t("scripture.concordance.occurrences", { count: occurrences, formatted: formatNumber(occurrences) })}
      {t("common.listSeparator")}
      {t("scripture.concordance.verses", { count: verses, formatted: formatNumber(verses) })}
    </span>
  );
}

/** A lemma or lexical number: its entries, then its occurrences, forms and grammar (v0.21). */
function LemmaSearch({ asked }: { asked: LemmaAsked }) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const [entries, setEntries] = useState<{ list?: LemmaEntry[]; error?: string } | null>(null);
  const [selection, setSelection] = useState<LemmaSelection | null>(asked.selection ?? null);
  const [morph, setMorph] = useState<string[]>([]);
  const [found, setFound] = useState<{ key: string; data?: LemmaResult; error?: string } | null>(null);

  useEffect(() => {
    if (asked.selection) return;
    let active = true;
    api.scriptureLemmaEntries({ translationId: asked.translationId, text: asked.text }).then(
      (list) => {
        if (!active) return;
        setEntries({ list });
        const only = list.length === 1 ? list[0] : undefined;
        if (only) setSelection({ kind: "entry", lemma: only.lemma, strong: only.strong });
      },
      (e) => active && setEntries({ error: toApiError(e).message }),
    );
    return () => {
      active = false;
    };
  }, [api, asked]);

  const key = JSON.stringify([selection, morph]);
  useEffect(() => {
    if (!selection) return;
    let active = true;
    api.scriptureLemmaSearch({ translationId: asked.translationId, selection, morph }).then(
      (data) => active && setFound({ key, data }),
      (e) => active && setFound({ key, error: toApiError(e).message }),
    );
    return () => {
      active = false;
    };
  }, [api, asked.translationId, selection, morph, key]);

  const result = found?.key === key ? found : null;
  const data = result?.data;
  const choosing = !asked.selection && (entries?.list?.length ?? 0) > 1;

  return (
    <div className="flex flex-col gap-4">
      {entries?.error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{entries.error}</p>}
      {!asked.selection && !entries && <p role="status" className="m-0 text-[0.9375rem] text-text-muted">{t("scripture.concordance.looking")}</p>}
      {entries?.list?.length === 0 && <p role="status" className="m-0 text-[0.9375rem] text-text-muted">{t("scripture.concordance.noEntry", { text: asked.text.trim() })}</p>}

      {choosing && (
        <section aria-labelledby={`${id}-entries`} className="flex flex-col gap-1">
          <h3 id={`${id}-entries`} className="type-group m-0">{t("scripture.concordance.entries", { text: asked.text.trim() })}</h3>
          <p className="m-0 type-meta">{t("scripture.concordance.entriesHint")}</p>
          <ul className="m-0 flex list-none flex-col p-0">
            {entries?.list?.map((e) => {
              const picked = selection?.kind === "entry" && selection.lemma === e.lemma && selection.strong === e.strong;
              return (
                <li key={`${e.lemma}|${e.strong}`}>
                  <button
                    type="button"
                    aria-pressed={picked}
                    onClick={() => {
                      setMorph([]);
                      setSelection({ kind: "entry", lemma: e.lemma, strong: e.strong });
                    }}
                    className={`flex w-full flex-col items-start gap-0.5 rounded-sm px-1 py-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${picked ? "bg-selected" : ""}`}
                  >
                    <EntryName lemma={e.lemma} strong={e.strong} />
                    <span className="type-meta">
                      {t("scripture.concordance.entryCount", { count: e.occurrences, formatted: formatNumber(e.occurrences) })}
                      {e.forms.length > 0 && (
                        <>
                          {t("common.listSeparator")}
                          {e.forms.map((f, i) => (
                            <span key={f}>
                              {i > 0 && ", "}
                              <bdi>{f}</bdi>
                            </span>
                          ))}
                        </>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {selection && (
        <>
          <div className="flex flex-col gap-1">
            <h3 className="type-group m-0"><SelectionName selection={selection} /></h3>
            <div role="status" className="text-[0.9375rem] text-text-strong">
              {!result && <span className="text-text-muted">{t("scripture.concordance.looking")}</span>}
              {data && data.verses > 0 && <Totals occurrences={data.occurrences} verses={data.verses} />}
              {data && data.verses === 0 && <span className="text-text-muted">{t(morph.length ? "scripture.concordance.noneWithGrammar" : "scripture.concordance.noneLemma")}</span>}
            </div>
            {result?.error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{result.error}</p>}
            {data && data.forms.length > 0 && (
              <p className="m-0 text-[0.9375rem] text-text">
                <span className="text-text-muted">{t("scripture.concordance.forms")}: </span>
                {data.forms.map((f, i) => (
                  <span key={f.form}>
                    {i > 0 && ", "}
                    <bdi>{f.form}</bdi> ({formatNumber(f.count)})
                  </span>
                ))}
              </p>
            )}
          </div>
          {data && (data.morphology.length > 0 || morph.length > 0) && (
            <Grammar data={data} morph={morph} onMorph={setMorph} />
          )}
          {data && (
            <BookResults
              key={key}
              books={data.books}
              hits={data.hitsComplete ? data.hits : null}
              fetchBook={(code) => api.scriptureLemmaSearch({ translationId: asked.translationId, selection, morph, book: code }).then((one) => one.hits)}
            />
          )}
        </>
      )}
    </div>
  );
}

export function EntryName({ lemma, strong }: { lemma: string | null; strong: string | null }) {
  const { t } = useTranslation();
  return (
    <span className="text-[0.9375rem] font-semibold text-text-strong">
      {lemma ? <span dir="auto">{lemma}</span> : t("scripture.concordance.noLemma")}
      {strong && <span className="font-normal text-text-muted"> · {strong}</span>}
    </span>
  );
}

function SelectionName({ selection }: { selection: LemmaSelection }) {
  const { t } = useTranslation();
  if (selection.kind === "entry") return <EntryName lemma={selection.lemma} strong={selection.strong} />;
  if (selection.kind === "lemma") return <EntryName lemma={selection.lemma} strong={null} />;
  return <span className="text-[0.9375rem] font-semibold text-text-strong">{t("scripture.concordance.lexicalNumber", { id: selection.id })}</span>;
}

/** The grammar codes of the occurrences, to narrow them: described only for a checked scheme. */
function Grammar({ data, morph, onMorph }: { data: LemmaResult; morph: string[]; onMorph: (codes: string[]) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(morph.length > 0);
  // Said by code, not by Bible: a code the scheme does not describe stays as written.
  const described = data.morphology.some((m) => m.described);
  return (
    <section aria-labelledby={`${id}-grammar`} className="flex flex-col gap-1">
      <button
        id={`${id}-grammar`}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-10 items-center gap-1.5 rounded-sm px-1 text-left font-ui text-[0.9375rem] font-semibold text-text-strong hover:bg-hover"
      >
        {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
        {t("scripture.concordance.grammar")}
        {morph.length > 0 && <span className="font-normal text-text-muted">{t("scripture.concordance.grammarChosen", { count: morph.length, formatted: formatNumber(morph.length) })}</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-2 pl-5">
          <p className="m-0 type-meta">{t(described ? "scripture.concordance.grammarDescribed" : "scripture.concordance.grammarRaw")}</p>
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="sr-only">{t("scripture.concordance.grammar")}</legend>
            {data.morphology.map((m) => (
              <label key={m.code} className="flex min-h-10 items-start gap-2 text-[0.9375rem] text-text">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={morph.includes(m.code)}
                  onChange={(e) => onMorph(e.target.checked ? [...morph, m.code] : morph.filter((c) => c !== m.code))}
                />
                <span className="flex flex-col">
                  <span>
                    {m.described ? describeMorph(t, m.described) : <code className="font-mono text-[0.875rem]">{m.code}</code>}
                    <span className="text-text-muted"> ({formatNumber(m.count)})</span>
                  </span>
                  {m.described && <code className="font-mono text-[0.8125rem] text-text-muted">{m.code}</code>}
                </span>
              </label>
            ))}
          </fieldset>
          {data.withoutMorphology > 0 && (
            <p className="m-0 type-meta">{t("scripture.concordance.withoutGrammar", { count: data.withoutMorphology, formatted: formatNumber(data.withoutMorphology) })}</p>
          )}
          {morph.length > 0 && (
            <button type="button" onClick={() => onMorph([])} className={`${quiet} self-start`}>
              {t("scripture.concordance.allGrammar")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** Occurrences by book: listed at once when there are few, otherwise one book at a time. */
function BookResults({ books, hits, fetchBook }: { books: ConcordanceBook[]; hits: ConcordanceHit[] | null; fetchBook: (code: string) => Promise<ConcordanceHit[]> }) {
  const { t } = useTranslation();
  const { goTo, bookByCode } = useScripture();
  const id = useId();
  // Each book's verses, once asked for (when there were too many to list at once).
  const [opened, setOpened] = useState<Record<string, { open: boolean; hits?: ConcordanceHit[]; error?: string }>>({});

  const toggleBook = async (code: string) => {
    const state = opened[code];
    if (state?.open) return setOpened({ ...opened, [code]: { ...state, open: false } });
    if (state?.hits) return setOpened({ ...opened, [code]: { ...state, open: true } });
    setOpened((b) => ({ ...b, [code]: { open: true } }));
    try {
      const list = await fetchBook(code);
      setOpened((b) => ({ ...b, [code]: { open: true, hits: list } }));
    } catch (e) {
      setOpened((b) => ({ ...b, [code]: { open: true, error: toApiError(e).message } }));
    }
  };

  const hitList = (list: ConcordanceHit[]) => (
    <ul className="m-0 flex list-none flex-col p-0">
      {list.map((hit) => {
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

  if (books.length === 0) return null;
  const inline = new Map<string, ConcordanceHit[]>();
  if (hits) for (const hit of hits) inline.set(hit.reference.book, [...(inline.get(hit.reference.book) ?? []), hit]);

  return (
    <section aria-labelledby={`${id}-books`} className="flex flex-col gap-1">
      <h3 id={`${id}-books`} className="type-group m-0">{t("scripture.concordance.books")}</h3>
      <ul className="m-0 flex list-none flex-col p-0">
        {books.map((b) => {
          const name = bookName(b.code, b.name);
          const label = t("scripture.concordance.bookCount", { book: name, count: b.occurrences, formatted: formatNumber(b.occurrences) });
          const listed = inline.get(b.code);
          const state = opened[b.code];
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
