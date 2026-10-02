import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { RELATION_TYPES, type RelationType } from "@/types/studies";
import { relationChoice, relationLabel } from "./labels";

interface Props {
  studyId: string;
  onOpen: (study: { id: string; projectId: string }) => void;
}

/** Links from this study to others: the start of long-term study memory. */
export function RelatedStudies({ studyId, onOpen }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const relations = useLoad(useCallback(() => api.studyRelationList(studyId), [api, studyId]));
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      relations.reload();
      return true;
    } catch (e) {
      setError(toApiError(e).message);
      return false;
    }
  };

  const list = relations.data ?? [];
  return (
    <section aria-label={t("studies.relations.label")} className="flex flex-col gap-2">
      {list.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[0.9375rem]">
          {list.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <span className="text-text-muted">{relationLabel(t, r.relationType, r.direction)}</span>
              <button type="button" onClick={() => onOpen(r.other)} className="font-medium text-link underline-offset-2 hover:underline">
                {r.other.title}
              </button>
              <button
                type="button"
                onClick={() => act(() => api.studyRelationDelete(r.id))}
                aria-label={t("studies.relations.remove", { title: r.other.title })}
                className="inline-flex size-8 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary"
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
          excluded={new Set([studyId, ...list.map((r) => r.other.id)])}
          onCancel={() => setAdding(false)}
          onAdd={async (to, type) => {
            if (await act(() => api.studyRelationCreate({ fromStudyId: studyId, toStudyId: to, relationType: type }))) setAdding(false);
          }}
        />
      ) : (
        <div>
          <Button variant="quiet" className="min-h-9 text-[0.9375rem] text-text-muted" onClick={() => setAdding(true)}>
            {t("studies.relations.add")}
          </Button>
        </div>
      )}
      {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
    </section>
  );
}

function AddRelation({ studyId, excluded, onAdd, onCancel }: { studyId: string; excluded: Set<string>; onAdd: (to: string, type: RelationType) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const all = useLoad(useCallback(() => api.studyList({}), [api]));
  const [to, setTo] = useState("");
  const [type, setType] = useState<RelationType>("related");
  const choices = (all.data ?? []).filter((s) => !excluded.has(s.id) && s.id !== studyId);
  return (
    <div role="group" aria-label={t("studies.relations.addGroup")} className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
      <span>{t("studies.relations.thisStudy")}</span>
      <label>
        <span className="sr-only">{t("studies.relations.relation")}</span>
        <select value={type} onChange={(e) => setType(e.target.value as RelationType)} className="h-9 rounded-aw border border-border bg-bg px-2">
          {RELATION_TYPES.map((option) => (
            <option key={option} value={option}>{relationChoice(t, option)}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">{t("studies.relations.target")}</span>
        <select value={to} onChange={(e) => setTo(e.target.value)} className="h-9 max-w-64 rounded-aw border border-border bg-bg px-2">
          <option value="">{t("studies.relations.choose")}</option>
          {choices.map((s) => (
            <option key={s.id} value={s.id}>{t("studies.relations.option", { title: s.title, project: s.projectTitle })}</option>
          ))}
        </select>
      </label>
      <Button variant="primary" className="min-h-9" disabled={!to} onClick={() => onAdd(to, type)}>{t("studies.relations.link")}</Button>
      <Button className="min-h-9" onClick={onCancel}>{t("common.cancel")}</Button>
    </div>
  );
}
