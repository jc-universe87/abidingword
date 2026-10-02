import { useCallback, useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { useLoad } from "@/hooks/useLoad";
import { referenceLabel } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { StudyPassage } from "@/types/scripture";

/**
 * The passages a study is about: at most one primary, any number related.
 * Optional: topical and doctrinal studies may have none. Clicking a
 * passage opens it in the Scripture pane.
 */
export function StudyPassages({ studyId, onReveal }: { studyId: string; onReveal: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const { goTo, currentPassage } = useScripture();
  const passages = useLoad(useCallback(() => api.studyPassageList(studyId), [api, studyId]));
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      passages.reload();
      return true;
    } catch (e) {
      setError(toApiError(e).message);
      return false;
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await act(async () => {
      const ref = await api.referenceParse(text);
      await api.studyPassageAdd({ studyId, reference: ref.canonical });
    });
    if (ok) {
      setText("");
      setAdding(false);
    }
  };

  const list = passages.data ?? [];
  const primary = list.find((p) => p.role === "primary");
  const related = list.filter((p) => p.role === "related");
  const linked = currentPassage && list.some((p) => p.reference.canonical === currentPassage.canonical);

  const chip = (passage: StudyPassage) => {
    const label = referenceLabel(passage.reference);
    return (
    <span key={passage.id} className="inline-flex items-center rounded-aw border border-border">
      <button
        type="button"
        onClick={() => {
          goTo(passage.reference);
          onReveal();
        }}
        title={t("studies.passages.open")}
        className="inline-flex min-h-9 items-center px-3 text-[0.9375rem] font-medium text-link hover:bg-bg-secondary"
      >
        {label}
      </button>
      {passage.role === "related" && (
        <button
          type="button"
          onClick={() => act(() => api.studyPassageSetRole({ id: passage.id, role: "primary" }))}
          className="min-h-9 border-l border-border px-2 text-[0.8125rem] text-text-muted hover:bg-bg-secondary"
          aria-label={t("studies.passages.makePrimaryLabel", { passage: label })}
        >
          {t("studies.passages.makePrimary")}
        </button>
      )}
      <button
        type="button"
        onClick={() => act(() => api.studyPassageRemove(passage.id))}
        aria-label={t("studies.passages.remove", { passage: label })}
        className="inline-flex size-9 items-center justify-center border-l border-border text-text-muted hover:bg-bg-secondary"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </span>
    );
  };

  return (
    <section aria-label={t("studies.passages.label")} className="flex flex-col gap-2">
      {primary && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-[0.875rem] font-medium text-text-muted">{t("studies.passages.primary")}</span>
          {chip(primary)}
        </div>
      )}
      {related.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-[0.875rem] font-medium text-text-muted">{t("studies.passages.related")}</span>
          {related.map(chip)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-9 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-bg-secondary hover:text-text-strong"
          >
            <Plus className="size-4" aria-hidden="true" />
            {list.length === 0 ? t("studies.passages.addFirst") : t("studies.passages.add")}
          </button>
        )}
        {currentPassage && !linked && (
          <button
            type="button"
            onClick={() => act(() => api.studyPassageAdd({ studyId, reference: currentPassage.canonical }))}
            className="inline-flex min-h-9 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-bg-secondary hover:text-text-strong"
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("studies.passages.linkCurrent", { passage: referenceLabel(currentPassage) })}
          </button>
        )}
      </div>
      {adding && (
        <form onSubmit={add} className="flex flex-wrap items-center gap-2" noValidate>
          <label htmlFor={`${id}-passage`} className="sr-only">{t("studies.passages.inputLabel")}</label>
          <input
            id={`${id}-passage`}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            placeholder={t("studies.passages.placeholder")}
            className="h-9 min-w-0 flex-1 basis-48 rounded-aw border border-border bg-bg px-3 text-[0.9375rem] placeholder:text-text-muted"
          />
          <button type="submit" className="h-9 rounded-aw bg-primary px-3 text-[0.9375rem] font-medium text-on-primary hover:bg-primary-hover">
            {t("common.add")}
          </button>
          <button type="button" onClick={() => setAdding(false)} className="h-9 rounded-aw border border-border px-3 text-[0.9375rem]">
            {t("common.cancel")}
          </button>
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
