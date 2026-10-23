import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, LayoutTemplate } from "lucide-react";
import { Button } from "@/design-system/Button";
import { InfoControl } from "@/design-system/InfoControl";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { hasLemmas } from "@/features/scripture/ConcordanceView";
import type { Study, StudySection } from "@/types/domain";
import { STUDY_STATUSES, type Finding, type StudyDetails, type StudyRelation, type StudyStatus, type StudyTemplate } from "@/types/studies";
import type { StudyPassage } from "@/types/scripture";
import { formatDate } from "./format";
import { AddPassage, PassageManager } from "./StudyPassages";
import { RelationManager } from "./RelatedStudies";
import { templateName } from "./builtinText";
import { statusLabel, studyTypeLabel } from "./labels";
import { partsFromStudy } from "./templateParts";

interface StudyInfoProps {
  study: Study;
  /** The study's parts, in order: what "Save as my template" keeps. */
  sections: StudySection[];
  findings: Finding[];
  templates: StudyTemplate[];
  passages: StudyPassage[];
  relations: StudyRelation[];
  reloadPassages: () => void;
  reloadRelations: () => void;
  onChanged: (study: Study) => void;
  onDuplicated: (studyId: string) => void;
  onOpenStudy: (study: { id: string; projectId: string }) => void;
  /** Brings the Scripture pane into view (to show a word's occurrences). */
  onRevealScripture?: () => void;
}

/** What the Study information panel edits as one draft (v0.19): saved together, or not at all. */
interface StudyDraft {
  status: StudyStatus;
  description: string;
  details: StudyDetails;
}

const draftOf = (study: Study): StudyDraft => ({ status: study.status, description: study.description ?? "", details: study.details });

/**
 * Everything about a study that is not the study itself (v0.19): status,
 * purpose and type-specific fields as a draft saved only with Save; then the
 * passages, related studies and copies, each changed by its own button. Opened
 * from a compact control, so the page stays about Scripture.
 */
export function StudyInfo({ study, sections, findings, templates, passages, relations, reloadPassages, reloadRelations, onChanged, onDuplicated, onOpenStudy, onRevealScripture }: StudyInfoProps) {
  const { t } = useTranslation();
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const template = templates.find((t) => t.id === study.templateId);
  const questions = findings.filter((f) => f.findingType === "question").length;
  const unresolved = findings.filter((f) => f.findingType === "unresolved_issue").length;

  const duplicate = async (includeContent: boolean, close: () => void) => {
    setError(null);
    try {
      const copy = await api.studyDuplicate({ studyId: study.id, includeContent });
      // The core names the copy in English; name it in the interface language.
      const title = t("studies.builtin.copyTitle", { title: study.title });
      if (copy.study.title === `${study.title} (copy)` && copy.study.title !== title) {
        await api.studyUpdate({ id: copy.study.id, title });
      }
      setDuplicating(false);
      close();
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
  const heading = "type-group m-0";

  return (
    <InfoControl<StudyDraft>
      title={t("studies.info.study")}
      buttonLabel={t("common.info.button")}
      initial={() => draftOf(study)}
      current={async () => draftOf((await api.studyGet(study.id)).study)}
      save={async (draft) => onChanged(await api.studyUpdate({ id: study.id, status: draft.status, description: draft.description, details: draft.details }))}
      fields={(draft, setDraft) => (
        <>
          <p className="m-0 text-[0.9375rem] text-text-muted">
            {[t("studies.header.typeLine", { type: studyTypeLabel(t, study.studyType) }), own && t("studies.header.fromTemplate", { name: templateName(own) }), facts].filter(Boolean).join(t("common.listSeparator"))}
          </p>
          <label className="flex flex-col gap-1 @md:max-w-64">
            <span className="text-[0.9375rem] font-medium text-text-muted">{t("studies.header.status")}</span>
            <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as StudyStatus })} className="h-11 aw-input px-2 text-text-strong">
              {STUDY_STATUSES.map((s) => (
                <option key={s} value={s}>{statusLabel(t, s)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[0.9375rem] font-medium text-text-muted">{t("studies.header.purpose")} <span className="font-normal">{t("studies.newStudy.optional")}</span></span>
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder={t("studies.header.purposePlaceholder")}
              className="reading resize-y rounded-aw border border-border-subtle bg-transparent px-3 py-1.5 text-[1rem] placeholder:text-text-muted focus:border-border"
            />
          </label>
          <DetailsFields study={study} values={draft.details} onValues={(details) => setDraft({ ...draft, details })} onRevealScripture={onRevealScripture} />
        </>
      )}
      actions={(close) => (
        <>
          <div className={group}>
            <PassageManager passages={passages} reload={reloadPassages} />
            <AddPassage studyId={study.id} passages={passages} reload={reloadPassages} />
          </div>
          <RelationManager
            studyId={study.id}
            relations={relations}
            reload={reloadRelations}
            onOpen={(other) => {
              close();
              onOpenStudy(other);
            }}
          />
          <div role="group" aria-label={t("studies.header.groupCopy")} className={group}>
            <h3 className={heading}>{t("studies.header.groupCopy")}</h3>
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
                  <Button variant="primary" onClick={() => void duplicate(false, close)}>{t("studies.header.structureOnly")}</Button>
                  <Button onClick={() => void duplicate(true, close)}>{t("studies.header.structureAndContent")}</Button>
                  <Button variant="quiet" onClick={() => setDuplicating(false)}>{t("common.cancel")}</Button>
                </div>
                <p className="m-0 text-[0.9375rem] text-text-muted">{t("studies.header.duplicateHelp")}</p>
              </div>
            )}
            <SaveAsTemplate id={`template-${study.id}`} study={study} sections={sections} />
          </div>
          {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
        </>
      )}
    />
  );
}

/**
 * "Save as my template" (v0.18.7): the study's structure, never its content,
 * becomes a template of the person's own for later studies. The study itself
 * is not changed, and is not linked to the template afterwards.
 */
/** The most parts a template can have (the core's limit). */
const MAX_TEMPLATE_PARTS = 40;

function SaveAsTemplate({ id, study, sections }: { id: string; study: Study; sections: StudySection[] }) {
  const { t } = useTranslation();
  const api = useApi();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState(study.title);
  // As the core allows (db/templates.rs): at least one part, at most 40.
  const fits = sections.length > 0 && sections.length <= MAX_TEMPLATE_PARTS;
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (busy || !name.trim() || !fits) return;
    setBusy(true);
    setError(null);
    try {
      const template = await api.templateCreate({
        // The study's purpose is its own writing; only its structure is kept.
        name: name.trim(),
        studyType: study.studyType,
        sections: partsFromStudy(sections),
      });
      setSaved(template.name);
      close();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div>
        <Button
          ref={toggle}
          variant="quiet"
          className="min-h-11"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => {
            setOpen(!open);
            setSaved(null);
          }}
        >
          <LayoutTemplate className="size-4" aria-hidden="true" />
          {t("studies.header.saveAsTemplate")}
        </Button>
      </div>
      {open && (
        <form
          id={id}
          aria-label={t("studies.header.saveAsTemplateGroup")}
          className="flex flex-col gap-2 border-l-[3px] border-accent bg-bg px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-[0.9375rem] font-medium text-text-muted">{t("studies.header.templateName")}</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="h-11 aw-input px-3 text-text-strong" />
          </label>
          <p className="m-0 text-[0.9375rem] text-text-muted">
            {fits ? t("studies.header.saveAsTemplateKeeps", { count: sections.length }) : t("studies.header.saveAsTemplateTooMany", { max: MAX_TEMPLATE_PARTS })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy || !name.trim() || !fits}>{t("studies.header.saveTemplate")}</Button>
            <Button variant="quiet" onClick={close}>{t("common.cancel")}</Button>
          </div>
          {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
        </form>
      )}
      {saved && <p role="status" className="m-0 text-[0.9375rem] text-text-muted">{t("studies.header.savedAsTemplate", { name: saved })}</p>}
    </>
  );
}

type DetailKey = "lemma" | "originalLanguage" | "audience" | "duration" | "teachingFormat";

/** Label and hint: studies.header.detail.<key>. */
const DETAIL_FIELDS: Partial<Record<Study["studyType"], DetailKey[]>> = {
  word: ["lemma", "originalLanguage"],
  teaching: ["audience", "duration", "teachingFormat"],
};

/** A few optional fields that only some study types use: part of the draft, saved with the rest. */
function DetailsFields({ study, values, onValues, onRevealScripture }: { study: Study; values: StudyDetails; onValues: (details: StudyDetails) => void; onRevealScripture?: () => void }) {
  const { t } = useTranslation();
  const { translations, translation, openConcordance } = useScripture();
  const fields = DETAIL_FIELDS[study.studyType];
  if (!fields) return null;
  // A word study's occurrences: looked up in the concordance, never copied into the study.
  const word = (values.lemma ?? "").trim();
  const bibleId = values.translationId && translations.some((b) => b.id === values.translationId) ? values.translationId : (translation?.id ?? "");
  const findOccurrences = () => {
    openConcordance({ query: word, mode: /\s/.test(word) ? "phrase" : "word", translationId: bibleId || null });
    onRevealScripture?.();
  };
  // v0.21: by lemma or lexical number, from the chosen Bible's own word annotations only.
  const lexicalId = (values.lexicalId ?? "").trim();
  const annotated = hasLemmas(translations.find((b) => b.id === bibleId));
  const anyAnnotated = translations.some(hasLemmas);
  const findLemma = () => {
    openConcordance({
      query: lexicalId || word,
      mode: "lemma",
      selection: lexicalId ? { kind: "lexicalId", id: lexicalId } : undefined,
      translationId: bibleId || null,
    });
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
            onChange={(e) => onValues({ ...values, [field]: e.target.value || null })}
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
              <select value={bibleId} onChange={(e) => onValues({ ...values, translationId: e.target.value })} className="h-11 aw-input px-2 text-text-strong">
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
            className="h-11 rounded-aw border border-border px-3 text-[0.9375rem] font-medium text-text-strong hover:bg-hover disabled:opacity-50"
          >
            {t("studies.header.findOccurrences")}
          </button>
          {annotated && (
            <button
              type="button"
              disabled={!word && !lexicalId}
              onClick={findLemma}
              className="h-11 rounded-aw border border-border px-3 text-[0.9375rem] font-medium text-text-strong hover:bg-hover disabled:opacity-50"
            >
              {t("studies.header.findLemma")}
            </button>
          )}
        </div>
      )}
      {study.studyType === "word" && (annotated || anyAnnotated || lexicalId) && (
        <div className="col-span-full flex flex-col gap-1">
          {(annotated || lexicalId) && (
            <label className="flex max-w-xs flex-col gap-1">
              <span className="text-[0.9375rem] font-medium text-text-muted">{t("studies.header.detail.lexicalId.label")}</span>
              <input
                value={values.lexicalId ?? ""}
                placeholder={t("studies.header.detail.lexicalId.hint")}
                onChange={(e) => onValues({ ...values, lexicalId: e.target.value || null })}
                className="h-11 rounded-aw border border-border-subtle bg-transparent px-2 text-[0.9375rem] placeholder:text-text-muted focus:border-border"
              />
            </label>
          )}
          {!annotated && <p className="m-0 type-meta">{t("studies.header.lemmaUnavailable")}</p>}
        </div>
      )}
    </div>
  );
}
