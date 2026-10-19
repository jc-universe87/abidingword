import { useCallback, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useLoad } from "@/hooks/useLoad";
import { referenceLabel } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { useApi } from "@/lib/ApiContext";
import type { StudyType } from "@/types/studies";
import { isPassageCentred } from "./labels";
import { openInTeaching } from "./studyView";

/** An example of what to type, for the kind of study. */
function placeholderFor(t: TFunction, type: StudyType): string {
  switch (type) {
    case "word":
      return t("studies.newStudy.placeholder.word");
    case "topical":
      return t("studies.newStudy.placeholder.topical");
    case "biblical_theology":
      return t("studies.newStudy.placeholder.biblical_theology");
    case "systematic_theology":
      return t("studies.newStudy.placeholder.systematic_theology");
    case "custom":
      return t("studies.newStudy.placeholder.custom");
    default:
      return t("studies.newStudy.passagePlaceholder"); // a passage study, or teaching on a passage
  }
}

/**
 * How the user chooses to begin: a built-in kind of study, one of their own
 * templates, or preparing a teaching. A teaching is prepared from a study of
 * its passage (Bible Teaching is derived from Bible Study): "teaching" makes
 * a passage study and opens its Bible Teaching side.
 */
type Approach = StudyType | "mine";

/** Offered straight away; the rest are under "More options". */
const COMMON: StudyType[] = ["passage", "word", "topical", "teaching"];
const MORE: StudyType[] = ["biblical_theology", "systematic_theology", "custom"];

const field = "h-10 min-w-0 rounded-aw border border-border bg-bg px-3 text-base placeholder:text-text-muted";
const pill =
  "min-h-11 rounded-full border border-border px-3 font-ui text-[0.9375rem] text-text-strong hover:bg-bg-secondary " +
  "aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-on-primary";

interface NewStudyFormProps {
  /** The project to create in, or a way to find (or make) it when the user has not chosen one. */
  projectId: string | (() => Promise<string>);
  onCreated: (study: { id: string; projectId: string }) => void;
  /** Present when the form can be put away again (a project that already has studies). */
  onCancel?: () => void;
  /** Move focus to the main field on arriving (when the user asked for the form). */
  autoFocus?: boolean;
}

/**
 * New Study, as one question: what would you like to study? Type the
 * thing (a passage, a word, a topic) and say how to study it. The kind of
 * study and the template that goes with it are chosen together, so there
 * is nothing to configure; the title follows from what was typed and can
 * be changed under "More options" (or, as always, in the study itself).
 */
export function NewStudyForm({ projectId, onCreated, onCancel, autoFocus = false }: NewStudyFormProps) {
  const { t } = useTranslation();
  const api = useApi();
  const { translation } = useScripture();
  const id = useId();
  const templates = useLoad(useCallback(() => api.templateList(), [api]));
  const [subject, setSubject] = useState("");
  const [approach, setApproach] = useState<Approach>("passage");
  const [customTitle, setCustomTitle] = useState("");
  const [mine, setMine] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = templates.data ?? [];
  const own = list.filter((template) => !template.isBuiltin);
  const chosenOwn = own.find((template) => template.id === (mine ?? own[0]?.id));
  // A study of one's own template is the kind of study that template is for.
  const type: StudyType = approach === "mine" ? (chosenOwn?.studyType ?? "custom") : approach === "teaching" ? "passage" : approach;
  const aboutAPassage = isPassageCentred(type);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = subject.trim();
    if (!text) {
      setError(t("studies.newStudy.subjectRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let primary: string | undefined;
      let derived = text;
      if (aboutAPassage) {
        const ref = await api.referenceParse(text, translation?.id);
        primary = ref.canonical;
        const label = referenceLabel(ref);
        derived = label;
      }
      // Built-in kinds of study use their own template; "No template" and a
      // template of one's own are the other two ways in.
      const templateId =
        approach === "mine"
          ? chosenOwn?.id
          : approach === "custom"
            ? undefined
            : list.find((template) => template.isBuiltin && template.studyType === type)?.id;
      const detail = await api.studyCreate({
        projectId: typeof projectId === "string" ? projectId : await projectId(),
        title: customTitle.trim() || derived,
        studyType: type,
        templateId,
        primaryPassage: primary,
      });
      setSubject("");
      setCustomTitle("");
      if (approach === "teaching") openInTeaching(detail.study.id);
      onCreated({ id: detail.study.id, projectId: detail.study.projectId });
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (more) setMore(false);
    else if (onCancel) onCancel();
    else return;
    event.stopPropagation();
  };

  const choice = (value: Approach) => (
    <button key={value} type="button" aria-pressed={approach === value} onClick={() => setApproach(value)} className={pill}>
      {t(`studies.newStudy.approach.${value}`)}
    </button>
  );
  const placeholder = placeholderFor(t, type);

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} className="flex flex-col gap-4" noValidate aria-label={t("studies.newStudy.formLabel")}>
      <div className="flex flex-col gap-2">
        <h2 id={`${id}-heading`} className="m-0 font-display text-[1.375rem] font-heading text-text-strong">
          {t("studies.newStudy.heading")}
        </h2>
        <input
          aria-labelledby={`${id}-heading`}
          autoFocus={autoFocus}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={placeholder}
          className={`${field} h-11 text-[1.0625rem]`}
        />
      </div>

      <div role="group" aria-label={t("studies.newStudy.studyAs")} className="flex flex-wrap gap-2">
        {COMMON.map(choice)}
        {more && MORE.map(choice)}
        {own.length > 0 && choice("mine")}
      </div>

      {approach === "mine" && own.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="text-[0.9375rem] font-medium text-text-strong">{t("studies.newStudy.template")}</span>
          <select value={chosenOwn?.id ?? ""} onChange={(e) => setMine(e.target.value)} className={field}>
            {own.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={more}
          aria-controls={`${id}-more`}
          onClick={() => setMore(!more)}
          className="inline-flex min-h-11 items-center gap-1 self-start rounded-aw px-1 text-[0.9375rem] text-text-muted hover:text-text-strong"
        >
          {more ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
          {t("studies.newStudy.more")}
        </button>
        {more && (
          <label id={`${id}-more`} className="flex flex-col gap-1">
            <span className="text-[0.9375rem] font-medium text-text-strong">
              {t("studies.newStudy.title")} <span className="font-normal text-text-muted">{t("studies.newStudy.optional")}</span>
            </span>
            <input value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} className={field} />
          </label>
        )}
      </div>

      {error && (
        <p role="alert" className="m-0 text-[0.9375rem] text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          <Plus className="size-4" aria-hidden="true" />
          {t("studies.newStudy.create")}
        </Button>
        {onCancel && <Button onClick={onCancel}>{t("common.cancel")}</Button>}
      </div>
    </form>
  );
}
