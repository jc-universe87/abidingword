import { useCallback, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useAutosave } from "@/hooks/useAutosave";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { Study } from "@/types/domain";
import { STUDY_STATUSES, type Finding, type StudyDetails, type StudyStatus, type StudyTemplate } from "@/types/studies";
import { formatDate } from "./format";
import { STATUS_LABELS, STUDY_TYPE_LABELS } from "./labels";

interface StudyHeaderProps {
  study: Study;
  findings: Finding[];
  templates: StudyTemplate[];
  onChanged: (study: Study) => void;
  onDuplicated: (studyId: string) => void;
}

/** Overview line, status, purpose, type details and duplication. */
export function StudyHeader({ study, findings, templates, onChanged, onDuplicated }: StudyHeaderProps) {
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
      setDuplicating(false);
      onDuplicated(copy.study.id);
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9375rem] text-text-muted">
        <label className="flex items-center gap-2">
          <span className="sr-only">Status</span>
          <select
            value={study.status}
            onChange={(e) => setStatus(e.target.value as StudyStatus)}
            className="h-9 rounded-aw border border-border bg-bg px-2 text-text-strong"
          >
            {STUDY_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        {template && <span>Template: {template.name}</span>}
        <span>Changed {formatDate(study.updatedAt)}</span>
        <Button variant="quiet" className="ml-auto min-h-9" onClick={() => setDuplicating(!duplicating)} aria-expanded={duplicating}>
          <Copy className="size-4" aria-hidden="true" />
          Duplicate…
        </Button>
      </div>

      <p className="m-0 text-[0.9375rem]" aria-label="Overview">
        {findings.length === 0 ? "No findings yet" : `${findings.length} finding${findings.length === 1 ? "" : "s"}`}
        {questions > 0 && <> · {questions} question{questions === 1 ? "" : "s"}</>}
        {unresolved > 0 && <> · {unresolved} unresolved issue{unresolved === 1 ? "" : "s"}</>}
      </p>

      {duplicating && (
        <div role="group" aria-label="Duplicate this study" className="flex flex-col gap-2 border-l-[3px] border-accent bg-bg-secondary px-4 py-3">
          <p className="m-0">Make a copy of “{study.title}” in this project:</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => duplicate(false)}>Structure only</Button>
            <Button onClick={() => duplicate(true)}>Structure and content</Button>
            <Button variant="quiet" onClick={() => setDuplicating(false)}>Cancel</Button>
          </div>
          <p className="m-0 text-[0.875rem] text-text-muted">
            Structure only copies the sections. With content, your writing, findings and passages are copied too.
            Notes on Scripture are never duplicated; they belong to the verses.
          </p>
        </div>
      )}

      <PurposeField study={study} onChanged={onChanged} />
      <DetailsFields study={study} onChanged={onChanged} />
      {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
    </div>
  );
}

function PurposeField({ study, onChanged }: { study: Study; onChanged: (s: Study) => void }) {
  const api = useApi();
  const [text, setText] = useState(study.description ?? "");
  const save = useCallback(
    async (description: string) => onChanged(await api.studyUpdate({ id: study.id, description })),
    [api, study.id, onChanged],
  );
  const { schedule, flush } = useAutosave(save);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.875rem] font-medium text-text-muted">Purpose</span>
      <textarea
        rows={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          schedule(e.target.value);
        }}
        onBlur={flush}
        placeholder="What are you trying to understand or prepare?"
        className="reading resize-y rounded-aw border border-border-subtle bg-transparent px-3 py-1.5 text-[1rem] placeholder:text-text-muted focus:border-border"
      />
    </label>
  );
}

const DETAIL_FIELDS: Partial<Record<Study["studyType"], { key: keyof StudyDetails; label: string; hint: string }[]>> = {
  word: [
    { key: "lemma", label: "Word", hint: "e.g. δικαιοσύνη" },
    { key: "originalLanguage", label: "Language", hint: "e.g. Greek" },
  ],
  teaching: [
    { key: "audience", label: "Audience", hint: "e.g. Sunday congregation" },
    { key: "duration", label: "Length", hint: "e.g. 30 minutes" },
    { key: "teachingFormat", label: "Format", hint: "e.g. sermon" },
  ],
};

/** A few optional fields that only some study types use. */
function DetailsFields({ study, onChanged }: { study: Study; onChanged: (s: Study) => void }) {
  const api = useApi();
  const fields = DETAIL_FIELDS[study.studyType];
  const [values, setValues] = useState<StudyDetails>(study.details);
  if (!fields) return null;
  const save = async () => {
    if (JSON.stringify(values) === JSON.stringify(study.details)) return;
    onChanged(await api.studyUpdate({ id: study.id, details: values }));
  };
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label={`${STUDY_TYPE_LABELS[study.studyType]} details`}>
      {fields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1">
          <span className="text-[0.875rem] font-medium text-text-muted">{field.label}</span>
          <input
            value={values[field.key] ?? ""}
            placeholder={field.hint}
            onChange={(e) => setValues({ ...values, [field.key]: e.target.value || null })}
            onBlur={() => void save().catch(() => undefined)}
            className="h-9 rounded-aw border border-border-subtle bg-transparent px-2 text-[0.9375rem] placeholder:text-text-muted focus:border-border"
          />
        </label>
      ))}
    </div>
  );
}
