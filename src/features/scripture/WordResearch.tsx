import { useId } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@/i18n/format";
import type { GrammarScheme, WordChoice, WordReport } from "@/types/scripture";

/** Words left out of the index, as counted for the person (titles aside). */
export function wordsLeftOut(report: WordReport): number {
  return Object.entries(report.leftOut).reduce((sum, [key, value]) => (key === "outsideVerse" ? sum : sum + value), 0);
}

/** Whether a word report has anything to say or offer. */
export function hasWordResearch(report: WordReport | undefined): report is WordReport {
  return !!report && (report.indexed || !!report.notIndexed);
}

/** The person's choice when nothing is chosen yet: nothing beyond what the edition itself states. */
export const NO_CHOICE: WordChoice = { numbers: false, grammar: null };

/** Whether these choices would give the Bible a word index. */
export function willIndex(report: WordReport, choice: WordChoice): boolean {
  return report.indexed || (report.notIndexed === "strongOnly" && !!choice.numbers && report.words > 0);
}

function megabytes(bytes: number): string {
  return formatNumber(Math.max(1, Math.round(bytes / (1024 * 1024))));
}

/**
 * What a Bible's own word markup gives for original-language research
 * (v0.22), in plain terms: the written word, dictionary forms, grammar and
 * lexical numbers. Offers the two choices the person makes — searching by
 * lexical number when that is all there is, and describing grammar codes
 * with a scheme they fit when the edition does not name it. Nothing is
 * chosen for the person.
 */
export function WordResearch({ report, choice, onChoice, atImport = false }: { report: WordReport; choice: WordChoice; onChoice: (c: WordChoice) => void; atImport?: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const n = (value: number) => formatNumber(value);
  const left = wordsLeftOut(report);
  const reason = report.notIndexed;

  // Annotations that cannot be used at all: say why, offer nothing.
  if (!report.indexed && reason !== "strongOnly") {
    if (!reason) return null;
    return (
      <p className="m-0 text-[0.9375rem] text-text-muted">
        {t(`scripture.addBible.words.not.${reason}`, { count: report.marked, formatted: n(report.marked), left: n(left) })}
      </p>
    );
  }

  const finding = report.grammar;
  const scheme: GrammarScheme | null = finding?.scheme ?? null;
  const stated = scheme && finding?.stated;
  const numbersOnly = reason === "strongOnly";
  const row = (label: string, value: string) => (
    <>
      <dt className="font-medium text-text-strong">{label}</dt>
      <dd className="m-0">{value}</dd>
    </>
  );

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3 text-[0.9375rem]">
      <h3 id={`${id}-title`} className="type-item m-0">
        {t("scripture.research.title")}
      </h3>
      <p className="m-0 text-text-muted">{t("scripture.research.intro")}</p>
      <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[11rem_1fr]">
        {row(t("scripture.research.written"), t("scripture.research.writtenValue", { count: report.words, formatted: n(report.words), verses: n(report.verses) }))}
        {row(t("scripture.research.dictionary"), report.withLemma > 0 ? t("scripture.research.dictionaryValue", { words: n(report.withLemma), distinct: n(report.distinctLemmas) }) : t("scripture.research.notIncluded"))}
        {row(t("scripture.research.grammar"), report.withMorphology > 0 ? t("scripture.research.grammarValue", { words: n(report.withMorphology) }) : t("scripture.research.notIncluded"))}
        {row(t("scripture.research.number"), report.withLexicalId > 0 ? t("scripture.research.numberValue", { words: n(report.withLexicalId) }) : t("scripture.research.notIncluded"))}
      </dl>

      {report.withMorphology > 0 && (
        <div className="flex flex-col gap-1">
          {stated ? (
            <p className="m-0">{t("scripture.research.grammarStated", { scheme: t(`scripture.grammar.scheme.${scheme}`), file: finding.stated?.file, words: finding.stated?.words })}</p>
          ) : scheme ? (
            <>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={choice.grammar === scheme}
                  onChange={(e) => onChoice({ ...choice, grammar: e.target.checked ? scheme : null })}
                  aria-describedby={`${id}-fit`}
                />
                <span>{t("scripture.research.grammarChoose", { scheme: t(`scripture.grammar.scheme.${scheme}`) })}</span>
              </label>
              <p id={`${id}-fit`} className="m-0 pl-6 text-text-muted">
                {t("scripture.research.grammarFit", { described: n(finding.described), coded: n(finding.coded) })}
              </p>
            </>
          ) : (
            <p className="m-0 text-text-muted">{t("scripture.research.grammarRaw")}</p>
          )}
        </div>
      )}

      {numbersOnly && (
        <div className="flex flex-col gap-1">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={!!choice.numbers}
              onChange={(e) => onChoice({ ...choice, numbers: e.target.checked })}
              aria-describedby={`${id}-numbers`}
            />
            <span>{t("scripture.research.numbersChoose")}</span>
          </label>
          <p id={`${id}-numbers`} className="m-0 pl-6 text-text-muted">
            {t("scripture.research.numbersHelp", { size: megabytes(report.estimatedBytes ?? 0) })}
            {atImport && <> {t("scripture.research.numbersLater")}</>}
          </p>
        </div>
      )}

      {left > 0 && <p className="m-0 text-text-muted">{t("scripture.addBible.words.leftOut", { count: left, formatted: n(left) })}</p>}
    </section>
  );
}
