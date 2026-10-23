import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@/i18n/format";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { useStudyFocus } from "@/features/studies/StudyFocus";
import type { VerseWord } from "@/types/scripture";
import { EntryName } from "./ConcordanceView";
import { describeMorph } from "./morphology";
import { useScripture } from "./ScriptureContext";

const button = "inline-flex min-h-10 items-center rounded-aw border border-border px-3 font-ui text-[0.9375rem] font-medium text-text-strong hover:bg-hover disabled:opacity-50";

/** The identifier a Word Study keeps: the first value that is a lexical number (letters then digits), else the first. */
export function studyLexicalId(word: VerseWord): string | null {
  return word.lexicalIds.find((id) => /^[A-Za-z]+\d/.test(id)) ?? word.lexicalIds[0] ?? null;
}

/**
 * What this Bible's own markup says about the selected words (v0.21): the
 * lemma, lexical numbers and grammar code given with each, and how often the
 * entry occurs. Nothing is looked up elsewhere, and a word without
 * annotations is not listed. From here: the lemma's occurrences, or the word
 * into the open Word Study.
 */
export function WordDetails({ words, more, translationId, onDone }: { words: VerseWord[]; more: number; translationId: string; onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 type-meta">{t("scripture.words.fromMarkup")}</p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {words.map((w, i) => (
          // A selection can span verses, whose positions both start at 0.
          <li key={i} className="flex flex-col gap-1 border-t border-border-subtle pt-2">
            <OneWord word={w} translationId={translationId} onDone={onDone} />
          </li>
        ))}
      </ul>
      {more > 0 && <p className="m-0 type-meta">{t("scripture.words.more", { count: more, formatted: formatNumber(more) })}</p>}
    </div>
  );
}

function OneWord({ word, translationId, onDone }: { word: VerseWord; translationId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const focus = useStudyFocus();
  const { openConcordance } = useScripture();
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [replace, setReplace] = useState<{ studyId: string; title: string; before: string; after: string } | null>(null);

  const findLemma = () => {
    openConcordance({
      query: word.lemma ?? word.strong ?? word.surface,
      mode: "lemma",
      selection: { kind: "entry", lemma: word.lemma, strong: word.strong },
      translationId,
    });
    onDone();
  };

  const putInStudy = async (confirmed: boolean) => {
    setStatus(null);
    if (!focus.openStudyId) return setStatus({ text: t("scripture.words.openWordStudy") });
    try {
      const { study } = await api.studyGet(focus.openStudyId);
      if (study.studyType !== "word") return setStatus({ text: t("scripture.words.openWordStudy") });
      // Only what the Bible's markup gives: a word without a lemma keeps the study's own.
      const lemma = word.lemma ?? study.details.lemma ?? null;
      const lexicalId = studyLexicalId(word) ?? study.details.lexicalId ?? null;
      const label = (l: string | null | undefined, id: string | null | undefined) => [l, id].filter(Boolean).join(" · ");
      const before = label((study.details.lemma ?? "").trim() || null, (study.details.lexicalId ?? "").trim() || null);
      const after = label(lemma, lexicalId);
      if (!confirmed && before && before !== after) return setReplace({ studyId: study.id, title: study.title, before, after });
      const saved = await api.studyUpdate({ id: study.id, details: { ...study.details, lemma, lexicalId, translationId } });
      focus.studyUpdated(saved);
      setReplace(null);
      setStatus({ text: t("scripture.words.usedInStudy", { title: saved.title }) });
    } catch (e) {
      setStatus({ text: toApiError(e).message, error: true });
    }
  };

  return (
    <>
      <p className="m-0 flex flex-wrap items-baseline gap-x-2">
        <span dir="auto" className="reading text-[1.0625rem] font-semibold text-text-strong">{word.surface}</span>
        {(word.lemma || word.strong) && (
          <span className="text-text-muted">
            {/* A number alone is named as a number, never as a lemma (v0.22). */}
            {word.lemma && <>{t("scripture.words.lemma")} </>}
            <EntryName lemma={word.lemma} strong={word.strong} />
          </span>
        )}
      </p>
      {word.morph && (
        <p className="m-0 text-[0.9375rem] text-text">
          <span className="text-text-muted">{t("scripture.words.grammar")}: </span>
          {word.described ? describeMorph(t, word.described) : t("scripture.words.grammarRaw")}{" "}
          <code className="font-mono text-[0.8125rem] text-text-muted">{word.morph}</code>
        </p>
      )}
      {word.shape !== "word" && <p className="m-0 type-meta">{t(`scripture.words.shape.${word.shape}`)}</p>}
      <p className="m-0 type-meta">{t("scripture.words.entryCount", { count: word.entryOccurrences, formatted: formatNumber(word.entryOccurrences) })}</p>
      <div className="flex flex-wrap gap-2">
        {(word.lemma || word.strong) && (
          <button type="button" className={button} onClick={findLemma}>
            {t(word.lemma ? "scripture.words.findLemma" : "scripture.words.findNumber")}
          </button>
        )}
        {(word.lemma || word.strong) && (
          <button type="button" className={button} onClick={() => void putInStudy(false)}>
            {t("scripture.words.studyWord")}
          </button>
        )}
      </div>
      {replace && (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[0.9375rem] text-text">{t("scripture.words.replaceLemma", { title: replace.title, before: replace.before, after: replace.after })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => void putInStudy(true)}>{t("scripture.words.replace")}</button>
            <button type="button" className={button} onClick={() => setReplace(null)}>{t("common.cancel")}</button>
          </div>
        </div>
      )}
      {status && (
        <p role={status.error ? "alert" : "status"} className={`m-0 text-[0.9375rem] ${status.error ? "text-danger" : "text-text-muted"}`}>
          {status.text}
        </p>
      )}
    </>
  );
}
