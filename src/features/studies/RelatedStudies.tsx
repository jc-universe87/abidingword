import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { RELATION_TYPES, type RelationType, type StudyRelation } from "@/types/studies";
import { relationLabel } from "./labels";

interface Props {
  /** The study's relations (the caller loads them). */
  relations: StudyRelation[];
  onOpen: (study: { id: string; projectId: string }) => void;
}

/**
 * Studies this one is linked to, shown only when there are some: a compact
 * line each, opening that study. Linking and unlinking are in Study details
 * ([`RelationManager`]); an empty study shows nothing here at all.
 */
export function RelatedStudies({ relations, onOpen }: Props) {
  const { t } = useTranslation();
  if (relations.length === 0) return null;
  return (
    <section aria-label={t("studies.relations.label")}>
      <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-[0.9375rem]">
        {relations.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-2">
            <span className="text-text-muted">{relationLabel(t, r.relationType, r.direction)}</span>
            <button type="button" onClick={() => onOpen(r.other)} className="min-h-11 font-medium text-link underline-offset-2 hover:underline">
              {r.other.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Link this study to another, and take links away: for Study details. */
export function RelationManager({ studyId, relations, reload, onOpen }: { studyId: string; relations: StudyRelation[]; reload: () => void; onOpen?: (study: StudyRelation["other"]) => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      reload();
      return true;
    } catch (e) {
      setError(toApiError(e).message);
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-0 text-[0.9375rem] font-medium text-text-muted">{t("studies.relations.label")}</h3>
      {relations.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[0.9375rem]">
          {relations.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <span className="text-text-muted">{relationLabel(t, r.relationType, r.direction)}</span>
              {onOpen ? (
                <button type="button" onClick={() => onOpen(r.other)} className="min-h-11 font-medium text-link underline-offset-2 hover:underline">
                  {r.other.title}
                </button>
              ) : (
                <span className="font-medium text-text-strong">{r.other.title}</span>
              )}
              <button
                type="button"
                onClick={() => void act(() => api.studyRelationDelete(r.id))}
                aria-label={t("studies.relations.remove", { title: r.other.title })}
                className="ml-auto inline-flex size-11 items-center justify-center rounded-aw text-text-muted hover:bg-hover"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <AddRelation
          studyId={studyId}
          excluded={new Set([studyId, ...relations.map((r) => r.other.id)])}
          onCancel={() => setAdding(false)}
          onAdd={async (to, type) => {
            if (await act(() => api.studyRelationCreate({ fromStudyId: studyId, toStudyId: to, relationType: type }))) setAdding(false);
          }}
        />
      ) : (
        <div>
          <Button variant="quiet" className="min-h-11 text-[0.9375rem] !text-text-muted hover:!text-text-strong" onClick={() => setAdding(true)}>
            {t("studies.relations.add")}
          </Button>
        </div>
      )}
      {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
    </div>
  );
}

function AddRelation({ studyId, excluded, onAdd, onCancel }: { studyId: string; excluded: Set<string>; onAdd: (to: string, type: RelationType) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const all = useLoad(useCallback(() => api.studyList({}), [api]));
  const [to, setTo] = useState("");
  // Ordinarily two studies are simply related; saying how is one step further.
  const [type, setType] = useState<RelationType>("related");
  const [describing, setDescribing] = useState(false);
  const choices = (all.data ?? []).filter((s) => !excluded.has(s.id) && s.id !== studyId);
  const field = "h-11 aw-input px-2";
  return (
    <div
      role="group"
      aria-label={t("studies.relations.addGroup")}
      className="@container flex flex-col gap-2 text-[0.9375rem]"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          if (describing) setDescribing(false);
          else onCancel();
        }
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-medium text-text-muted">{t("studies.relations.target")}</span>
        <select value={to} onChange={(e) => setTo(e.target.value)} className={`${field} max-w-full`}>
          <option value="">{t("studies.relations.choose")}</option>
          {choices.map((s) => (
            <option key={s.id} value={s.id}>{t("studies.relations.option", { title: s.title, project: s.projectTitle })}</option>
          ))}
        </select>
      </label>
      {describing ? (
        <label className="flex flex-col gap-1">
          <span className="font-medium text-text-muted">{t("studies.relations.relation")}</span>
          <select autoFocus value={type} onChange={(e) => setType(e.target.value as RelationType)} className={`${field} max-w-full @md:max-w-64`}>
            {RELATION_TYPES.map((option) => (
              <option key={option} value={option}>{relationLabel(t, option, "outgoing")}</option>
            ))}
          </select>
        </label>
      ) : (
        <div>
          <Button variant="quiet" className="min-h-11 !text-text-muted hover:!text-text-strong" aria-expanded={false} onClick={() => setDescribing(true)}>
            {t("studies.relations.describe")}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" className="min-h-11" disabled={!to} onClick={() => onAdd(to, type)}>{t("studies.relations.link")}</Button>
        <Button className="min-h-11" onClick={onCancel}>{t("common.cancel")}</Button>
      </div>
    </div>
  );
}
