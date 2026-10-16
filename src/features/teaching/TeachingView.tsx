import { useCallback, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { Finding } from "@/types/studies";
import { TEACHING_KINDS, type TeachingKind, type TeachingPoint, type TeachingPreparation } from "@/types/teaching";
import { AssistMenu } from "./AssistMenu";
import { AssistPanel } from "./AssistPanel";
import { teachingKindLabel } from "./labels";
import { TeachingField, type AssistantHooks } from "./TeachingField";
import { TeachingLinks } from "./TeachingLinks";

interface TeachingViewProps {
  studyId: string;
  studyTitle: string;
  findings: Finding[];
  onRevealScripture: () => void;
}

/**
 * The Teaching view of a study (v0.16): one or more teaching preparations —
 * a sermon, a group study, a lesson — written by the person from what they
 * found. Nothing is filled in for them; every field may stay empty.
 */
export function TeachingView({ studyId, studyTitle, findings, onRevealScripture }: TeachingViewProps) {
  const { t } = useTranslation();
  const api = useApi();
  const list = useLoad(useCallback(() => api.teachingList(studyId), [api, studyId]));
  const settings = useLoad(useCallback(() => api.assistantSettingsGet(), [api]));
  const [chosen, setChosen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const id = useId();

  const preparations = list.data ?? [];
  const currentId = chosen && preparations.some((p) => p.id === chosen) ? chosen : (preparations[0]?.id ?? null);

  if (list.error) return <p role="alert" className="m-0 text-danger">{list.error.message}</p>;
  if (!list.data) return <p className="m-0 text-text-muted">{t("studies.teaching.loading")}</p>;

  const created = (prep: TeachingPreparation) => {
    setCreating(false);
    setChosen(prep.id);
    list.reload();
  };

  if (preparations.length === 0 || creating) {
    return (
      <NewTeaching
        studyId={studyId}
        studyTitle={studyTitle}
        first={preparations.length === 0}
        onCreated={created}
        onCancel={preparations.length > 0 ? () => setCreating(false) : undefined}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
          {preparations.length > 1 && (
            <>
              <label htmlFor={`${id}-which`} className="text-[0.9375rem] text-text-muted">
                {t("studies.teaching.which")}
              </label>
              <select
                id={`${id}-which`}
                value={currentId ?? ""}
                onChange={(e) => setChosen(e.target.value)}
                className="h-11 min-w-0 max-w-full rounded-aw border border-border bg-bg px-2 text-[0.9375rem]"
              >
                {preparations.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.kind ? `${p.title} · ${teachingKindLabel(t, p.kind)}` : p.title}
                  </option>
                ))}
              </select>
            </>
          )}
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-bg-secondary hover:text-text-strong"
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("studies.teaching.another")}
          </button>
      </div>
      {currentId && (
        <TeachingEditor
          key={currentId}
          preparationId={currentId}
          findings={findings}
          assistant={settings.data?.config.enabled ? settings.data : null}
          onRenamed={list.reload}
          onDeleted={() => {
            setChosen(null);
            list.reload();
          }}
          onRevealScripture={onRevealScripture}
        />
      )}
    </div>
  );
}

function NewTeaching({
  studyId,
  studyTitle,
  first,
  onCreated,
  onCancel,
}: {
  studyId: string;
  studyTitle: string;
  first: boolean;
  onCreated: (prep: TeachingPreparation) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const [kind, setKind] = useState<TeachingKind>("sermon");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suggested = `${teachingKindLabel(t, kind)} · ${studyTitle}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.teachingCreate({ studyId, title: title.trim() || suggested, kind }));
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onCancel) {
          e.stopPropagation();
          onCancel();
        }
      }}
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4 rounded-aw border border-border-subtle bg-bg-secondary px-5 py-4"
    >
      <h3 id={`${id}-title`} className="m-0 font-display text-[1.375rem] font-heading text-text-strong">
        {first ? t("studies.teaching.empty.title") : t("studies.teaching.another")}
      </h3>
      {first && <p className="m-0 max-w-prose text-text">{t("studies.teaching.empty.text")}</p>}
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-[0.9375rem] font-semibold text-text-strong">{t("studies.teaching.kindLabel")}</legend>
        <div className="flex flex-wrap gap-2">
          {TEACHING_KINDS.map((k) => (
            <label key={k} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border px-4 text-[0.9375rem] has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary">
              <input type="radio" name={`${id}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
              {teachingKindLabel(t, k)}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="text-[0.9375rem] font-semibold text-text-strong">{t("studies.teaching.titleLabel")}</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={suggested}
          className="h-11 rounded-aw border border-border bg-bg px-3 text-[1rem] placeholder:text-text-muted"
        />
      </label>
      {error && (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" className="min-h-11" disabled={busy}>
          {t("studies.teaching.start")}
        </Button>
        {onCancel && (
          <Button className="min-h-11" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}

interface EditorProps {
  preparationId: string;
  findings: Finding[];
  assistant: { canGenerateImages: boolean; config: { findImages: boolean } } | null;
  onRenamed: () => void;
  onDeleted: () => void;
  onRevealScripture: () => void;
}

function TeachingEditor({ preparationId, findings, assistant, onRenamed, onDeleted, onRevealScripture }: EditorProps) {
  const { t } = useTranslation();
  const api = useApi();
  const loaded = useLoad(useCallback(() => api.teachingGet(preparationId), [api, preparationId]));
  // The preparation as last returned by the core (links, points, kept material). Each field keeps
  // its own text while the person types, so a reload never overwrites what is being written.
  const prep = loaded.data ?? null;
  const setPrep = loaded.setData;
  const [newPoint, setNewPoint] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [wholeAction, setWholeAction] = useState<"structure" | "restructure" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const wholeButton = useRef<HTMLDivElement>(null);

  const act = useCallback(
    async (run: () => Promise<TeachingPreparation>) => {
      setError(null);
      try {
        const next = await run();
        setPrep(next);
        return next;
      } catch (e) {
        setError(toApiError(e).message);
        return null;
      }
    },
    [setPrep],
  );

  const hooks: AssistantHooks | null = useMemo(
    () =>
      assistant && prep
        ? {
            preparationId: prep.id,
            canFindImages: assistant.config.findImages,
            canGenerateImages: assistant.canGenerateImages,
            keep: async (material) => {
              const next = await api.teachingMaterialKeep({ ...material, preparationId: prep.id });
              setPrep(next);
            },
            addPassage: async (reference, pointId) => {
              const next = await api.teachingPassageAdd({ preparationId: prep.id, pointId, reference: reference.canonical });
              setPrep(next);
            },
          }
        : null,
    // The hooks only need the preparation's id, not every change to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assistant, api, prep?.id, setPrep],
  );

  if (loaded.error) return <p role="alert" className="m-0 text-danger">{loaded.error.message}</p>;
  if (!prep) return <p className="m-0 text-text-muted">{t("studies.teaching.loading")}</p>;

  // Each save returns the preparation as stored: kept, so names (a point's title in its labels) stay current.
  // Fields keep their own text, so this never overwrites what is being typed.
  const save = (field: keyof Omit<TeachingPreparation, "id">) => (value: string) =>
    api.teachingUpdate({ id: prep.id, [field]: value }).then((next) => {
      setPrep(next);
      return next;
    });
  const savePoint = (pointId: string, field: keyof Omit<TeachingPoint, "id" | "position">) => (value: string) =>
    api.teachingPointUpdate({ id: pointId, [field]: value }).then((next) => {
      setPrep(next);
      return next;
    });

  const addPoint = async (after: string | null) => {
    const next = await act(() => api.teachingPointCreate({ preparationId: prep.id, afterPointId: after }));
    if (next) {
      const ids = new Set(prep.points.map((p) => p.id));
      const fresh = next.points.find((p) => !ids.has(p.id));
      if (fresh) setNewPoint(fresh.id);
      setNotice(t("studies.teaching.points.added"));
    }
  };
  const movePoint = async (index: number, delta: -1 | 1) => {
    const ids = prep.points.map((p) => p.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    const next = await act(() => api.teachingPointReorder({ parentId: prep.id, ids }));
    if (next) {
      setNotice(t("studies.teaching.points.moved", { position: target + 1 }));
      requestAnimationFrame(() => document.getElementById(`point-move-${ids[target]}-${delta < 0 ? "up" : "down"}`)?.focus());
    }
  };
  const remove = async () => {
    try {
      await api.teachingDelete(prep.id);
      onDeleted();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const kindField = (
    <label className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
      <span className="text-text-muted">{t("studies.teaching.kindLabel")}</span>
      <select
        value={prep.kind ?? ""}
        onChange={(e) => void act(() => api.teachingUpdate({ id: prep.id, kind: e.target.value as TeachingKind | "" }))}
        className="h-11 rounded-aw border border-border bg-bg px-2"
      >
        <option value="">{t("studies.teaching.kindNone")}</option>
        {TEACHING_KINDS.map((k) => (
          <option key={k} value={k}>
            {teachingKindLabel(t, k)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <article aria-label={prep.title} className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <TeachingField
          key={`title-${prep.id}`}
          label={t("studies.teaching.titleLabel")}
          value={prep.title}
          save={(value) =>
            value.trim()
              ? save("title")(value).then((next) => {
                  onRenamed();
                  return next;
                })
              : Promise.resolve()
          }
          part="pointTitle"
          multiline={false}
          emphasis
          assistant={null}
        />
        <div className="flex flex-wrap items-center gap-3">
          {kindField}
          {confirmDelete ? (
            <span className="flex flex-wrap items-center gap-2 rounded-aw border border-border bg-bg px-2 py-1 text-[0.9375rem]">
              <span>{t("studies.teaching.deleteConfirm")}</span>
              <button type="button" onClick={() => void remove()} className="min-h-11 rounded px-2 font-medium text-danger hover:bg-bg-secondary">
                {t("common.delete")}
              </button>
              <button type="button" autoFocus onClick={() => setConfirmDelete(false)} className="min-h-11 rounded px-2 hover:bg-bg-secondary">
                {t("common.keep")}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-bg-secondary hover:text-danger"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t("studies.teaching.delete")}
            </button>
          )}
        </div>
        {assistant && <p className="m-0 max-w-prose text-[0.875rem] text-text-muted">{t("studies.teaching.assist.intro")}</p>}
      </header>

      <section aria-labelledby={`about-${prep.id}`} className="flex flex-col gap-4">
        <h3 id={`about-${prep.id}`} className="m-0 font-display text-[1.25rem] font-heading text-text-strong">
          {t("studies.teaching.about")}
        </h3>
        <TeachingField key={`audience-${prep.id}`} label={t("studies.teaching.audience")} value={prep.audience ?? ""} save={save("audience")} part="audience" multiline={false} placeholder={t("studies.teaching.audiencePlaceholder")} assistant={hooks} />
        <TeachingField key={`purpose-${prep.id}`} label={t("studies.teaching.purpose")} value={prep.purpose ?? ""} save={save("purpose")} part="purpose" multiline={false} placeholder={t("studies.teaching.purposePlaceholder")} assistant={hooks} />
        <TeachingField
          key={`message-${prep.id}`}
          label={t("studies.teaching.message")}
          hint={t("studies.teaching.messageHint")}
          value={prep.centralMessage ?? ""}
          save={save("centralMessage")}
          part="centralMessage"
          rows={2}
          assistant={hooks}
          onRevealScripture={onRevealScripture}
        />
        <TeachingLinks preparation={prep} pointId={null} scope={t("studies.teaching.links.wholeScope")} studyFindings={findings} onChanged={setPrep} onRevealScripture={onRevealScripture} />
      </section>

      <TeachingField key={`intro-${prep.id}`} label={t("studies.teaching.introduction")} value={prep.introduction} save={save("introduction")} part="introduction" assistant={hooks} onRevealScripture={onRevealScripture} />

      <section aria-labelledby={`points-${prep.id}`} className="flex flex-col gap-4">
        <div ref={wholeButton} className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`points-${prep.id}`} className="m-0 font-display text-[1.25rem] font-heading text-text-strong">
            {t("studies.teaching.points.title")}
          </h3>
          {hooks && !wholeAction && <AssistMenu part="whole" partLabel={t("studies.teaching.points.whole")} onChoose={(a) => setWholeAction(a as "structure" | "restructure")} />}
        </div>
        {prep.points.length === 0 && <p className="m-0 text-text-muted">{t("studies.teaching.points.none")}</p>}
        {hooks && wholeAction && (
          <AssistPanel
            preparationId={prep.id}
            target={{ part: "whole", pointId: null, label: t("studies.teaching.points.whole"), text: "", selection: null }}
            action={wholeAction}
            onApply={() => undefined}
            onInsertBelow={() => undefined}
            onKeep={(m) => hooks.keep({ ...m, pointId: null })}
            onAddPassage={(r) => hooks.addPassage(r, null)}
            onClose={() => {
              setWholeAction(null);
              requestAnimationFrame(() => wholeButton.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.focus());
            }}
            canFindImages={hooks.canFindImages}
            canGenerateImages={hooks.canGenerateImages}
          />
        )}
        <ol className="m-0 flex list-none flex-col gap-6 p-0">
          {prep.points.map((point, index) => {
            const name = point.title.trim() || t("studies.teaching.points.untitled", { number: index + 1 });
            return (
              <li key={point.id} aria-label={t("studies.teaching.points.label", { number: index + 1, title: name })} className="flex flex-col gap-3 border-l-[3px] border-accent pl-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-ui text-[0.875rem] font-semibold text-text-muted">{t("studies.teaching.points.number", { number: index + 1 })}</span>
                  <span className="ml-auto flex items-center">
                    <button
                      id={`point-move-${point.id}-up`}
                      type="button"
                      disabled={index === 0}
                      onClick={() => void movePoint(index, -1)}
                      aria-label={t("studies.teaching.points.moveUp", { point: name })}
                      className="inline-flex size-11 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary disabled:opacity-40"
                    >
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      id={`point-move-${point.id}-down`}
                      type="button"
                      disabled={index === prep.points.length - 1}
                      onClick={() => void movePoint(index, 1)}
                      aria-label={t("studies.teaching.points.moveDown", { point: name })}
                      className="inline-flex size-11 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary disabled:opacity-40"
                    >
                      <ArrowDown className="size-4" aria-hidden="true" />
                    </button>
                    <DeletePoint
                      name={name}
                      hasContent={Boolean(point.title.trim() || point.explanation.trim() || point.application.trim() || point.illustration.trim())}
                      onDelete={() =>
                        void act(() => api.teachingPointDelete(point.id)).then((next) => {
                          if (next) setNotice(t("studies.teaching.points.removed"));
                        })
                      }
                    />
                  </span>
                </div>
                <TeachingField
                  key={`ptitle-${point.id}`}
                  label={t("studies.teaching.points.titleLabel", { number: index + 1 })}
                  value={point.title}
                  save={savePoint(point.id, "title")}
                  part="pointTitle"
                  pointId={point.id}
                  multiline={false}
                  emphasis
                  placeholder={t("studies.teaching.points.titlePlaceholder")}
                  assistant={hooks}
                  autoFocus={point.id === newPoint}
                />
                <TeachingField key={`pexp-${point.id}`} label={t("studies.teaching.points.explanation")} value={point.explanation} save={savePoint(point.id, "explanation")} part="pointExplanation" pointId={point.id} assistant={hooks} onRevealScripture={onRevealScripture} />
                <TeachingField key={`papp-${point.id}`} label={t("studies.teaching.points.application")} value={point.application} save={savePoint(point.id, "application")} part="pointApplication" pointId={point.id} rows={2} assistant={hooks} onRevealScripture={onRevealScripture} />
                <TeachingField key={`pill-${point.id}`} label={t("studies.teaching.points.illustration")} value={point.illustration} save={savePoint(point.id, "illustration")} part="pointIllustration" pointId={point.id} rows={2} assistant={hooks} />
                <TeachingLinks preparation={prep} pointId={point.id} scope={name} studyFindings={findings} onChanged={setPrep} onRevealScripture={onRevealScripture} />
              </li>
            );
          })}
        </ol>
        <div>
          <Button className="min-h-11" onClick={() => void addPoint(prep.points[prep.points.length - 1]?.id ?? null)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("studies.teaching.points.add")}
          </Button>
        </div>
      </section>

      <TeachingField key={`concl-${prep.id}`} label={t("studies.teaching.conclusion")} value={prep.conclusion} save={save("conclusion")} part="conclusion" assistant={hooks} onRevealScripture={onRevealScripture} />
      <TeachingField key={`notes-${prep.id}`} label={t("studies.teaching.notes")} hint={t("studies.teaching.notesHint")} value={prep.notes} save={save("notes")} part="notes" rows={2} assistant={hooks} />

      {error && (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>
    </article>
  );
}

function DeletePoint({ name, hasContent, onDelete }: { name: string; hasContent: boolean; onDelete: () => void }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  if (confirming)
    return (
      <span className="flex flex-wrap items-center gap-1 rounded-aw border border-border bg-bg px-2 text-[0.9375rem]">
        <span>{t("studies.teaching.points.deleteConfirm")}</span>
        <button type="button" onClick={onDelete} className="min-h-11 rounded px-2 font-medium text-danger hover:bg-bg-secondary">
          {t("common.delete")}
        </button>
        <button type="button" autoFocus onClick={() => setConfirming(false)} className="min-h-11 rounded px-2 hover:bg-bg-secondary">
          {t("common.keep")}
        </button>
      </span>
    );
  return (
    <button
      type="button"
      onClick={() => (hasContent ? setConfirming(true) : onDelete())}
      aria-label={t("studies.teaching.points.delete", { point: name })}
      className="inline-flex size-11 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary hover:text-danger"
    >
      <Trash2 className="size-4" aria-hidden="true" />
    </button>
  );
}
