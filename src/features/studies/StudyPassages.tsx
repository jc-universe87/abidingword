import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { referenceLabel } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { StudyPassage } from "@/types/scripture";
import { titleIsPassage } from "./format";

interface PassagesProps {
  studyId: string;
  /** The study's title: when it is the primary passage itself, the passage is not repeated beneath it. */
  title?: string;
  /** The study's passages (primary first or not; the caller loads them). */
  passages: StudyPassage[];
  /** Reload them after a change. */
  reload: () => void;
}

/**
 * What the study is about, as a quiet line under its title: the passage
 * (and any related ones) as links that open it in Scripture, and one small
 * action to add another. Which is primary, and taking one away, are not
 * decisions for the everyday view: see [`PassageManager`] in Study details.
 */
export function StudyPassages({ studyId, title = "", passages, reload, onReveal }: PassagesProps & { onReveal: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const { goTo, currentPassage, translation } = useScripture();
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = async (reference: () => Promise<string>) => {
    setError(null);
    try {
      await api.studyPassageAdd({ studyId, reference: await reference() });
      reload();
      setText("");
      setAdding(false);
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const primary = passages.find((p) => p.role === "primary");
  // The title already says it: no second "John 15:1–11" beneath "John 15:1–11". This looks only at the
  // study itself, never at what Scripture happens to show, so the pane reads the same wherever it sits.
  const titled = primary !== undefined && titleIsPassage(title, referenceLabel(primary.reference));
  const shown = passages.filter((p) => !(titled && p.id === primary?.id));
  const linked = currentPassage && passages.some((p) => p.reference.canonical === currentPassage.canonical);
  const quiet = "inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-hover hover:text-text-strong";

  return (
    // Sits in the line under the study's title; adding a passage takes the whole width.
    <section aria-label={t("studies.passages.label")} className={`flex flex-col gap-2 ${adding || error ? "basis-full" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        {titled && primary && (
          <button
            type="button"
            onClick={() => {
              goTo(primary.reference);
              onReveal();
            }}
            className={quiet}
          >
            {t("studies.passages.openPrimary")}
          </button>
        )}
        {shown.map((passage) => (
          <button
            key={passage.id}
            type="button"
            onClick={() => {
              goTo(passage.reference);
              onReveal();
            }}
            title={t("studies.passages.open")}
            // Passages are links, not boxes; the primary one (of several) sits on a soft fill.
            className={`inline-flex min-h-11 items-center rounded-aw px-2 text-[0.9375rem] font-medium text-link hover:bg-hover ${
              passage.id === primary?.id && passages.length > 1 ? "bg-selected" : ""
            }`}
          >
            {passage.id === primary?.id && passages.length > 1 && <span className="sr-only">{t("studies.passages.primary")}: </span>}
            {referenceLabel(passage.reference)}
          </button>
        ))}
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={quiet}>
            <Plus className="size-4" aria-hidden="true" />
            {passages.length === 0 ? t("studies.passages.add") : t("studies.passages.addRelated")}
          </button>
        )}
      </div>
      {adding && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void add(async () => (await api.referenceParse(text, translation?.id)).canonical);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setAdding(false);
            }
          }}
          className="flex flex-col gap-2"
          noValidate
        >
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-passage`} className="sr-only">{t("studies.passages.inputLabel")}</label>
            <input
              id={`${id}-passage`}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("studies.passages.placeholder")}
              className="h-11 min-w-0 flex-1 basis-48 aw-input px-3 text-[0.9375rem] placeholder:text-text-muted"
            />
            <button type="submit" className="h-11 rounded-aw bg-primary px-3 text-[0.9375rem] font-medium text-on-primary hover:bg-primary-hover">
              {t("common.add")}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="h-11 rounded-aw border border-border px-3 text-[0.9375rem]">
              {t("common.cancel")}
            </button>
          </div>
          {currentPassage && !linked && (
            <button type="button" onClick={() => void add(async () => currentPassage.canonical)} className={`${quiet} self-start`}>
              <Plus className="size-4" aria-hidden="true" />
              {t("studies.passages.linkCurrent", { passage: referenceLabel(currentPassage) })}
            </button>
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="m-0 text-[0.9375rem] text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * The passages with the things that change them, for Study details: make
 * a related passage the primary one, or take one away.
 */
export function PassageManager({ passages, reload }: Omit<PassagesProps, "studyId">) {
  const { t } = useTranslation();
  const api = useApi();
  const [error, setError] = useState<string | null>(null);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      reload();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  if (passages.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-0 text-[0.9375rem] font-medium text-text-muted">{t("studies.passages.label")}</h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {passages.map((passage) => {
          const label = referenceLabel(passage.reference);
          return (
            <li key={passage.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9375rem]">
              <span className="font-medium text-text-strong">{label}</span>
              {passage.role === "primary" ? (
                <span className="text-text-muted">{t("studies.passages.primary")}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void act(() => api.studyPassageSetRole({ id: passage.id, role: "primary" }))}
                  aria-label={t("studies.passages.makePrimaryLabel", { passage: label })}
                  className="min-h-11 rounded-aw px-2 text-text-strong underline underline-offset-2 hover:bg-hover"
                >
                  {t("studies.passages.makePrimary")}
                </button>
              )}
              <button
                type="button"
                onClick={() => void act(() => api.studyPassageRemove(passage.id))}
                aria-label={t("studies.passages.remove", { passage: label })}
                className="ml-auto inline-flex size-11 items-center justify-center rounded-aw text-text-muted hover:bg-hover"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="m-0 text-[0.9375rem] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
