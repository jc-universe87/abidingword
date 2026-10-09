import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useAutosave } from "@/hooks/useAutosave";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { useScripture } from "@/features/scripture/ScriptureContext";
import type { Study } from "@/types/domain";
import { STUDY_STATUSES, type Finding, type StudyDetails, type StudyRelation, type StudyStatus, type StudyTemplate } from "@/types/studies";
import type { StudyPassage } from "@/types/scripture";
import { formatDate } from "./format";
import { PassageManager } from "./StudyPassages";
import { RelationManager } from "./RelatedStudies";
import { templateName } from "./builtinText";
import { statusLabel, studyTypeLabel } from "./labels";

interface StudyDetailsProps {
  id: string;
  study: Study;
  findings: Finding[];
  templates: StudyTemplate[];
  passages: StudyPassage[];
  relations: StudyRelation[];
  reloadPassages: () => void;
  reloadRelations: () => void;
  onChanged: (study: Study) => void;
  onDuplicated: (studyId: string) => void;
  /** Brings the Scripture pane into view (to show a word's occurrences). */
  onRevealScripture?: () => void;
}

/**
 * Everything about a study that is not the study itself: status, kind and
 * template, purpose, type-specific fields, passage and link management,
 * duplication. Shown on request, so the page can be about Scripture.
 */
export function StudyDetailsPanel({ id, study, findings, templates, passages, relations, reloadPassages, reloadRelations, onChanged, onDuplicated, onRevealScripture }: StudyDetailsProps) {
  const { t } = useTranslation();
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const template = templates.find((t) => t.id === study.templateId);
  const questions = findings.filter((f) => f.findingType === "question").length;
  const unresolved = findings.filter((f) => f.findingType === "unresolved_issue").length;

  const setStatus = async (status: StudyStatus) => {
    setError(null);
    try {
      onChanged(await api.studyUpdate({ id: study.id, status }));
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const duplicate = async (includeContent: boolean) => {
    setError(null);
    try {
      const copy = await api.studyDuplicate({ studyId: study.id, includeContent });
      // The core names the copy in English; name it in the interface language.
      const title = t("studies.builtin.copyTitle", { title: study.title });
      if (copy.study.title === `${study.title} (copy)` && copy.study.title !== title) {
        await api.studyUpdate({ id: copy.study.id, title });
      }
      setDuplicating(false);
      onDuplicated(copy.study.id);
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const facts = [
    t("studies.header.changed", { date: formatDate(study.updatedAt) }),
    findings.length > 0 && t("studies.findingCount", { count: findings.length }),
    questions > 0 && t("studies.header.questionCount", { count: questions }),
    unresolved > 0 && t("studies.header.unresolvedCount", { count: unresolved }),
  ]
    .filter(Boolean)
    .join(t("common.listSeparator"));
  // Built-in templates are an implementation detail; only the user's own say where a study came from.
  const own = template && !template.isBuiltin ? template : null;
  const group = "flex flex-col gap-3";
  const heading = "m-0 text-[0.9375rem] font-semibold text-text-strong";

  return (
    <section id={id} aria-label={t("studies.header.detailsToggle")} className="flex flex-col gap-6 rounded-aw border border-border-subtle bg-bg-secondary px-4 py-4">
      <div role="group" aria-labelledby={`${id}-about`} className={group}>
        <h3 id={`${id}-about`} className={heading}>{t("studies.header.groupAbout")}</h3>
        <p className="m-0 text-[0.9375rem] text-text-muted">
          {[t("studies.header.typeLine", { type: studyTypeLabel(t, study.studyType) }), own && t("studies.header.fromTemplate", { name: templateName(own) }), facts].filter(Boolean).join(t("common.listSeparator"))}
        </p>

        <label className="flex flex-col gap-1 @md:max-w-64">
          <span className="text-[0.9375rem] font-medium text-text-muted">{t("studies.header.status")}</span>
          <select
            value={study.status}
            onChange={(e) => setStatus(e.target.value as StudyStatus)}
            className="h-11 rounded-aw border border-border bg-bg px-2 text-text-strong"
          >
            {STUDY_STATUSES.map((s) => (
              <option key={s} value={s}>{statusLabel(t, s)}</option>
            ))}
          </select>
        </label>

        <PurposeField study={study} onChanged={onChanged} />
        <DetailsFields study={study} onChanged={onChanged} onRevealScripture={onRevealScripture} />
      </div>

      <PassageManager passages={passages} reload={reloadPassages} />
      <RelationManager studyId={study.id} relations={relations} reload={reloadRelations} />

      <div role="group" aria-labelledby={`${id}-copy`} className={group}>
        <h3 id={`${id}-copy`} className={heading}>{t("studies.header.groupCopy")}</h3>
        <div>
          <Button variant="quiet" className="min-h-11" onClick={() => setDuplicating(!duplicating)} aria-expanded={duplicating}>
            <Copy className="size-4" aria-hidden="true" />
            {t("studies.header.duplicate")}
          </Button>
        </div>
        {duplicating && (
          <div role="group" aria-label={t("studies.header.duplicateGroup")} className="flex flex-col gap-2 border-l-[3px] border-accent bg-bg px-4 py-3">
            <p className="m-0">{t("studies.header.duplicatePrompt", { title: study.title })}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => duplicate(false)}>{t("studies.header.structureOnly")}</Button>
              <Button onClick={() => duplicate(true)}>{t("studies.header.structureAndContent")}</Button>
              <Button variant="quiet" onClick={() => setDuplicating(false)}>{t("common.cancel")}</Button>
            </div>
            <p className="m-0 text-[0.9375rem] text-text-muted">{t("studies.header.duplicateHelp")}</p>
          </div>
        )}
      </div>
      {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
    </section>
  );
}

function PurposeField({ study, onChanged }: { study: Study; onChanged: (s: Study) => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const [text, setText] = useState(study.description ?? "");
  const save = useCallback(
    async (description: string) => onChanged(await api.studyUpdate({ id: study.id, description })),
    [api, study.id, onChanged],
  );
  const { schedule, flush } = useAutosave(save);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.9375rem] font-medium text-text-muted">{t("studies.header.purpose")} <span className="font-normal">{t("studies.newStudy.optional")}</span></span>
      <textarea
        rows={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          schedule(e.target.value);
        }}
        onBlur={flush}
        placeholder={t("studies.header.purposePlaceholder")}
        className="reading resize-y rounded-aw border border-border-subtle bg-transparent px-3 py-1.5 text-[1rem] placeholder:text-text-muted focus:border-border"
      />
    </label>
  );
}

type DetailKey = "lemma" | "originalLanguage" | "audience" | "duration" | "teachingFormat";

/** Label and hint: studies.header.detail.<key>. */
const DETAIL_FIELDS: Partial<Record<Study["studyType"], DetailKey[]>> = {
  word: ["lemma", "originalLanguage"],
  teaching: ["audience", "duration", "teachingFormat"],
};

/** A few optional fields that only some study types use. */
function DetailsFields({ study, onChanged, onRevealScripture }: { study: Study; onChanged: (s: Study) => void; onRevealScripture?: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const { translations, translation, openConcordance } = useScripture();
  const fields = DETAIL_FIELDS[study.studyType];
  const [values, setValues] = useState<StudyDetails>(study.details);
  if (!fields) return null;
  const save = async (next: StudyDetails = values) => {
    if (JSON.stringify(next) === JSON.stringify(study.details)) return;
    onChanged(await api.studyUpdate({ id: study.id, details: next }));
  };
  // A word study's occurrences: looked up in the concordance, never copied into the study.
  const word = (values.lemma ?? "").trim();
  const bibleId = values.translationId && translations.some((b) => b.id === values.translationId) ? values.translationId : (translation?.id ?? "");
  const findOccurrences = () => {
    void save().catch(() => undefined);
    openConcordance({ query: word, mode: /\s/.test(word) ? "phrase" : "word", translationId: bibleId || null });
    onRevealScripture?.();
  };
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2" role="group" aria-label={t("studies.header.details", { type: studyTypeLabel(t, study.studyType) })}>
      {fields.map((field) => (
        <label key={field} className="flex flex-col gap-1">
          <span className="text-[0.9375rem] font-medium text-text-muted">{t(`studies.header.detail.${field}.label`)}</span>
          <input
            value={values[field] ?? ""}
            placeholder={t(`studies.header.detail.${field}.hint`)}
            onChange={(e) => setValues({ ...values, [field]: e.target.value || null })}
            onBlur={() => void save().catch(() => undefined)}
            dir={field === "lemma" ? "auto" : undefined}
            className="h-11 rounded-aw border border-border-subtle bg-transparent px-2 text-[0.9375rem] placeholder:text-text-muted focus:border-border"
          />
        </label>
      ))}
      {study.studyType === "word" && translations.length > 0 && (
        <div className="col-span-full flex flex-wrap items-end gap-2">
          {translations.length > 1 && (
            <label className="flex flex-col gap-1">
              <span className="text-[0.9375rem] font-medium text-text-muted">{t("studies.header.detail.translation.label")}</span>
              <select
                value={bibleId}
                onChange={(e) => {
                  const next = { ...values, translationId: e.target.value };
                  setValues(next);
                  void save(next).catch(() => undefined);
                }}
                className="h-11 rounded-aw border border-border bg-bg px-2 text-text-strong"
              >
                {translations.map((b) => (
                  <option key={b.id} value={b.id}>{b.shortName}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={!word}
            onClick={findOccurrences}
            className="h-11 rounded-aw border border-border px-3 text-[0.9375rem] font-medium text-text-strong hover:bg-bg-secondary disabled:opacity-50"
          >
            {t("studies.header.findOccurrences")}
          </button>
        </div>
      )}
    </div>
  );
}
