import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, CornerUpLeft } from "lucide-react";
import { referenceLabel } from "@/i18n/scripture";
import { useScripture } from "./ScriptureContext";

const iconButton =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-aw text-text-strong " +
  "hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Back / Forward through the passages the pane has shown, and, when a Study is
 * open and Scripture is elsewhere, a way straight back to the Study's primary
 * passage. Navigation only: nothing here changes a Study.
 */
export function ScriptureHistoryBar() {
  const { t } = useTranslation();
  const { canGoBack, canGoForward, back, forward, current, studyPassage, goTo, bookByCode } = useScripture();
  const away = studyPassage !== null && studyPassage.canonical !== current.canonical;
  const label = studyPassage ? referenceLabel(studyPassage, bookByCode.get(studyPassage.book)?.chapterCount) : "";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label={t("scripture.history.group")} className="flex items-center gap-2">
        <button type="button" className={iconButton} onClick={back} disabled={!canGoBack} aria-label={t("scripture.history.back")} title={t("scripture.history.back")}>
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>
        <button type="button" className={iconButton} onClick={forward} disabled={!canGoForward} aria-label={t("scripture.history.forward")} title={t("scripture.history.forward")}>
          <ArrowRight className="size-5" aria-hidden="true" />
        </button>
      </div>
      {away && studyPassage && (
        <button
          type="button"
          onClick={() => goTo(studyPassage)}
          className="inline-flex min-h-10 min-w-0 items-center gap-2 rounded-aw border border-border px-3 text-left text-[0.9375rem] font-medium text-text-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          <CornerUpLeft className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{t("scripture.history.backToStudy", { passage: label })}</span>
        </button>
      )}
    </div>
  );
}
