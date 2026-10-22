import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button } from "@/design-system/Button";
import { InfoControl } from "@/design-system/InfoControl";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { Finding } from "@/types/studies";
import type { TeachingKind, TeachingPreparation } from "@/types/teaching";
import { teachingKindLabel } from "./labels";
import { SaveTeachingTemplate } from "./SaveTeachingTemplate";
import { FORMAT_KINDS, TEACHING_FORMATS } from "./teachingTemplates";
import { TeachingLinks } from "./TeachingLinks";

/** What the Bible Teaching information panel edits as one draft (v0.19). */
interface TeachingDraft {
  kind: TeachingKind | "";
  audience: string;
  purpose: string;
}

const draftOf = (prep: TeachingPreparation): TeachingDraft => ({ kind: prep.kind ?? "", audience: prep.audience ?? "", purpose: prep.purpose ?? "" });

/**
 * Everything about a teaching that is not the teaching itself (v0.19): its
 * kind, audience and purpose as a draft saved only with Save; then what the
 * whole teaching uses (passages, study notes), "Save as my template" and
 * deleting it, each by its own button. The teaching's text is never touched.
 */
export function TeachingInfo({
  prep,
  findings,
  onChanged,
  onDeleted,
  onRevealScripture,
}: {
  prep: TeachingPreparation;
  findings: Finding[];
  onChanged: (prep: TeachingPreparation) => void;
  onDeleted: () => void;
  onRevealScripture: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = "h-11 aw-input px-3 text-[1rem]";
  const label = "text-[0.9375rem] font-medium text-text-muted";

  const remove = async (close: () => void) => {
    setError(null);
    try {
      await api.teachingDelete(prep.id);
      close();
      onDeleted();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <InfoControl<TeachingDraft>
      title={t("studies.info.teaching")}
      buttonLabel={t("common.info.button")}
      initial={() => draftOf(prep)}
      current={async () => draftOf(await api.teachingGet(prep.id))}
      save={async (draft) => onChanged(await api.teachingUpdate({ id: prep.id, kind: draft.kind, audience: draft.audience, purpose: draft.purpose }))}
      fields={(draft, setDraft) => (
        <>
          <label className="flex flex-col gap-1 @md:max-w-80">
            <span className={label}>{t("studies.teaching.kindLabel")}</span>
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as TeachingKind | "" })} className="h-11 aw-input px-2 text-text-strong">
              {draft.kind === "" && <option value="">{t("studies.teaching.kindNone")}</option>}
              {/* Every kind, older ones too, under the format it belongs to. */}
              {TEACHING_FORMATS.map((format) => (
                <optgroup key={format} label={t(`studies.teaching.formats.${format}.name`)}>
                  {FORMAT_KINDS[format].map((k) => (
                    <option key={k} value={k}>
                      {teachingKindLabel(t, k)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{t("studies.teaching.audience")}</span>
            <input value={draft.audience} onChange={(e) => setDraft({ ...draft, audience: e.target.value })} placeholder={t("studies.teaching.audiencePlaceholder")} className={`${field} placeholder:text-text-muted`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{t("studies.teaching.purpose")}</span>
            <input value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} placeholder={t("studies.teaching.purposePlaceholder")} className={`${field} placeholder:text-text-muted`} />
          </label>
        </>
      )}
      actions={(close) => (
        <>
          <TeachingLinks preparation={prep} pointId={null} scope={t("studies.teaching.links.wholeScope")} studyFindings={findings} onChanged={onChanged} onRevealScripture={onRevealScripture} />
          <SaveTeachingTemplate preparation={prep} />
          <div className="flex flex-wrap items-center gap-2">
            {confirmDelete ? (
              <span role="group" aria-label={t("studies.teaching.deleteConfirm")} className="flex flex-wrap items-center gap-2 rounded-aw border-l-[3px] border-danger bg-hover px-2 py-1 text-[0.9375rem]">
                <span>{t("studies.teaching.deleteConfirm")}</span>
                <Button variant="danger" className="min-h-11" onClick={() => void remove(close)}>
                  {t("common.delete")}
                </Button>
                <button type="button" autoFocus onClick={() => setConfirmDelete(false)} className="min-h-11 rounded px-2 hover:bg-hover">
                  {t("common.keep")}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-hover hover:text-danger"
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t("studies.teaching.delete")}
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="m-0 text-[0.9375rem] text-danger">
              {error}
            </p>
          )}
        </>
      )}
    />
  );
}
