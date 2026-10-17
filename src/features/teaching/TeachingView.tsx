import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { referenceLabel } from "@/i18n/scripture";
import type { Finding } from "@/types/studies";
import { STEP_KINDS, TEACHING_KINDS, type ImageCapability, type ProviderKind, type StepKind, type TeachingKind, type TeachingPoint, type TeachingPreparation } from "@/types/teaching";
import { AssistMenu } from "./AssistMenu";
import { AssistPanel } from "./AssistPanel";
import { FloatingPanel, AssistDockProvider, useAssistDock } from "./FloatingPanel";
import { STARTING_STEPS, assistLabel, canvasShape, pointFields, showsFrame, startingStepTitle, stepFieldLabel, teachingKindLabel, type ShapeText } from "./labels";
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
  // A teaching just created opens with its details, so they can be filled in; later visits start folded.
  const [fresh, setFresh] = useState<string | null>(null);
  const id = useId();
  // After a new teaching is put away or one is deleted, the keyboard goes back to "Prepare another".
  const anotherButton = useRef<HTMLButtonElement>(null);
  const focusAnother = useRef(false);
  useEffect(() => {
    if (!focusAnother.current || !anotherButton.current) return;
    anotherButton.current.focus();
    focusAnother.current = false;
  });

  const preparations = list.data ?? [];
  const currentId = chosen && preparations.some((p) => p.id === chosen) ? chosen : (preparations[0]?.id ?? null);

  if (list.error) return <p role="alert" className="m-0 text-danger">{list.error.message}</p>;
  if (!list.data) return <p className="m-0 text-text-muted">{t("studies.teaching.loading")}</p>;

  const created = (prep: TeachingPreparation) => {
    setCreating(false);
    setChosen(prep.id);
    setFresh(prep.id);
    list.reload();
  };

  if (preparations.length === 0 || creating) {
    return (
      <NewTeaching
        studyId={studyId}
        studyTitle={studyTitle}
        first={preparations.length === 0}
        onCreated={created}
        onCancel={
          preparations.length > 0
            ? () => {
                setCreating(false);
                focusAnother.current = true;
              }
            : undefined
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* One study can lead to several teachings: the way to another is always in sight, with the
          choice between them once there is more than one. */}
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
          ref={anotherButton}
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] font-medium text-link hover:bg-bg-secondary"
        >
          <Plus className="size-4" aria-hidden="true" />
          {t("studies.teaching.another")}
        </button>
      </div>
      {currentId && (
        <AssistDockProvider key={currentId}>
        <TeachingEditor
          key={currentId}
          preparationId={currentId}
          findings={findings}
          assistant={settings.data?.config.enabled ? settings.data : null}
          onRenamed={list.reload}
          onDeleted={() => {
            setChosen(null);
            // Back to "Prepare another" while another teaching remains; after the last one the first-teaching form shows.
            focusAnother.current = preparations.length > 1;
            list.reload();
          }}
          onRevealScripture={onRevealScripture}
          startOpen={fresh === currentId}
        />
        </AssistDockProvider>
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
  const heading = useRef<HTMLHeadingElement>(null);
  // Asked for from a teaching already there: the keyboard moves to the new form (the first one needs no move).
  useEffect(() => {
    if (!first) heading.current?.focus();
  }, [first]);
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
      // A lesson starts with its steps, named in the person's language; the others start empty.
      const points = (STARTING_STEPS[kind] ?? []).map((step) => ({ title: startingStepTitle(t, kind, step.key), kind: step.kind }));
      onCreated(await api.teachingCreate({ studyId, title: title.trim() || suggested, kind, points }));
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
      <h3 id={`${id}-title`} ref={heading} tabIndex={-1} className="m-0 font-display text-[1.375rem] font-heading text-text-strong">
        {first ? t("studies.teaching.empty.title") : t("studies.teaching.another")}
      </h3>
      {first && <p className="m-0 max-w-prose text-text">{t("studies.teaching.empty.text")}</p>}
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-[0.9375rem] font-semibold text-text-strong">{t("studies.teaching.kindLabel")}</legend>
        <div className="flex flex-wrap gap-2">
          {TEACHING_KINDS.map((k) => (
            <label key={k} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border px-4 text-[0.9375rem] has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary">
              <input type="radio" name={`${id}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" aria-describedby={`${id}-format`} />
              {teachingKindLabel(t, k)}
            </label>
          ))}
        </div>
        {/* What the chosen kind gives to work in: the shape of its main canvas. */}
        <p id={`${id}-format`} className="m-0 text-[0.9375rem] text-text">
          {t(`studies.teaching.format.${canvasShape(kind)}`)}
          {STARTING_STEPS[kind] && (
            <span className="text-text-muted">
              {" "}
              {t("studies.teaching.startsWith", { steps: STARTING_STEPS[kind]!.map((step) => startingStepTitle(t, kind, step.key)).join(t("common.listSeparator")) })}
            </span>
          )}
        </p>
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
  assistant: {
    canGenerateImages: boolean;
    imageCapability: ImageCapability;
    config: { findImages: boolean; generateImages: boolean; provider: ProviderKind; imageService: "same" | "openai" };
  } | null;
  onRenamed: () => void;
  onDeleted: () => void;
  onRevealScripture: () => void;
  /** Just created: "About this teaching" starts open. */
  startOpen: boolean;
}

function TeachingEditor({ preparationId, findings, assistant, onRenamed, onDeleted, onRevealScripture, startOpen }: EditorProps) {
  const { t } = useTranslation();
  const api = useApi();
  const loaded = useLoad(useCallback(() => api.teachingGet(preparationId), [api, preparationId]));
  // The preparation as last returned by the core (links, points, kept material). Each field keeps
  // its own text while the person types, so a reload never overwrites what is being written.
  const prep = loaded.data ?? null;
  const setPrep = loaded.setData;
  const [newPoint, setNewPoint] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // "About this teaching" (kind, audience, purpose, what it uses) stays folded away unless wanted:
  // open only right after the teaching was created, so its details can be filled in.
  const [aboutOpen, setAboutOpen] = useState(startOpen);
  const dock = useAssistDock();
  const [wholeRequest, setWholeRequest] = useState(0);
  const [wholeAction, setWholeAction] = useState<"structure" | "restructure" | "free" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const wholeButton = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // Points deleted in this session: a late save for one is not an error.
  const deleted = useRef(new Set<string>());

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
            imagesNote: assistant.canGenerateImages
              ? null
              : !assistant.config.generateImages
                ? "off"
                : assistant.imageCapability === "unsupported"
                  ? "unsupported"
                  : "noKey",
            imageService: t(`settings.assistant.providers.${assistant.config.imageService === "openai" ? "openai" : assistant.config.provider}`),
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

  // The main canvas follows the kind: points for a sermon, questions for a Bible study, steps for a lesson.
  const shapeName = canvasShape(prep.kind);
  const shape = (key: ShapeText, options?: Record<string, unknown>) => t(`studies.teaching.shape.${shapeName}.${key}`, options ?? {});

  // Each save returns the preparation as stored: kept, so names (a point's title in its labels) stay current.
  // Fields keep their own text, so this never overwrites what is being typed.
  const save = (field: keyof Omit<TeachingPreparation, "id">) => (value: string) =>
    api.teachingUpdate({ id: prep.id, [field]: value }).then((next) => {
      setPrep(next);
      return next;
    });
  const savePoint = (pointId: string, field: keyof Omit<TeachingPoint, "id" | "position">) => (value: string) =>
    deleted.current.has(pointId)
      ? Promise.resolve()
      : api.teachingPointUpdate({ id: pointId, [field]: value }).then(
          (next) => {
            setPrep(next);
            return next;
          },
          (e: unknown) => {
            // A save that arrives after its point was deleted is not an error.
            if (deleted.current.has(pointId) && toApiError(e).kind === "notFound") return;
            throw e;
          },
        );

  const addPoint = async (after: string | null) => {
    // A new step of a lesson starts as teaching; its kind can be changed at once.
    const next = await act(() => api.teachingPointCreate({ preparationId: prep.id, afterPointId: after, kind: shapeName === "steps" ? "text" : null }));
    if (next) {
      const ids = new Set(prep.points.map((p) => p.id));
      const fresh = next.points.find((p) => !ids.has(p.id));
      if (fresh) setNewPoint(fresh.id);
      setNotice(shape("added"));
    }
  };
  const movePoint = async (index: number, delta: -1 | 1) => {
    const ids = prep.points.map((p) => p.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    const next = await act(() => api.teachingPointReorder({ parentId: prep.id, ids }));
    if (next) {
      setNotice(shape("moved", { position: target + 1 }));
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

  const firstPassage = prep.passages.find((p) => p.pointId === null);
  const aboutSummary = [
    prep.kind ? teachingKindLabel(t, prep.kind) : "",
    prep.audience?.trim() ? t("studies.teaching.aboutFor", { audience: prep.audience.trim() }) : "",
    firstPassage ? referenceLabel(firstPassage.reference) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const toggleAbout = () => {
    // A delete question left open is withdrawn with the section, so focus is never left in a hidden place.
    if (aboutOpen) setConfirmDelete(false);
    setAboutOpen(!aboutOpen);
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
    <article aria-label={prep.title} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
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
        <button
          type="button"
          aria-expanded={aboutOpen}
          aria-controls={`about-${prep.id}`}
          onClick={toggleAbout}
          className="inline-flex min-h-11 flex-wrap items-center gap-x-2 self-start rounded-aw px-2 text-left text-[0.9375rem] text-text-muted hover:bg-bg-secondary hover:text-text-strong"
        >
          <ChevronRight className={`size-4 shrink-0 transition-transform ${aboutOpen ? "rotate-90" : ""}`} aria-hidden="true" />
          <span className="font-medium text-text-strong">{t("studies.teaching.about")}</span>
          <span>{aboutSummary || t("studies.teaching.aboutEmpty")}</span>
        </button>
      </header>

      <section
        id={`about-${prep.id}`}
        aria-labelledby={`about-title-${prep.id}`}
        hidden={!aboutOpen}
        className="flex flex-col gap-4 rounded-aw border border-border-subtle px-4 py-3"
      >
        <h3 id={`about-title-${prep.id}`} className="sr-only">
          {t("studies.teaching.about")}
        </h3>
        {kindField}
        <TeachingField key={`audience-${prep.id}`} label={t("studies.teaching.audience")} value={prep.audience ?? ""} save={save("audience")} part="audience" multiline={false} placeholder={t("studies.teaching.audiencePlaceholder")} assistant={hooks} />
        <TeachingField key={`purpose-${prep.id}`} label={t("studies.teaching.purpose")} value={prep.purpose ?? ""} save={save("purpose")} part="purpose" multiline={false} placeholder={t("studies.teaching.purposePlaceholder")} assistant={hooks} />
        <TeachingLinks preparation={prep} pointId={null} scope={t("studies.teaching.links.wholeScope")} studyFindings={findings} onChanged={setPrep} onRevealScripture={onRevealScripture} />
        <div className="flex flex-wrap items-center gap-2">
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
      </section>

      {/* What it says on a line of its own; what it is for waits in the empty field. */}
      <TeachingField
        key={`message-${prep.id}`}
        label={shape("message")}
        placeholder={shape("messageHint")}
        value={prep.centralMessage ?? ""}
        save={save("centralMessage")}
        part="centralMessage"
        rows={2}
        assistant={hooks}
        onRevealScripture={onRevealScripture}
      />

      {showsFrame(shapeName, "introduction", prep.introduction) && (
        <TeachingField key={`intro-${prep.id}`} label={shape("introduction")} value={prep.introduction} save={save("introduction")} part="introduction" assistant={hooks} onRevealScripture={onRevealScripture} />
      )}

      <section aria-labelledby={`points-${prep.id}`} className="flex flex-col gap-4">
        <div ref={wholeButton} className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`points-${prep.id}`} className="m-0 font-display text-[1.25rem] font-heading text-text-strong">
            {shape("title")}
          </h3>
          {hooks && (
            <AssistMenu
              part="whole"
              partLabel={t("studies.teaching.points.whole")}
              imagesNote={hooks.imagesNote}
              onChoose={(a) => {
                dock.claim("whole");
                setWholeRequest((n) => n + 1);
                setWholeAction(a as "structure" | "restructure" | "free");
              }}
            />
          )}
        </div>
        {prep.points.length === 0 && <p className="m-0 text-text-muted">{shape("none")}</p>}
        {hooks && wholeAction && dock.owner === "whole" && (
          <FloatingPanel key={wholeRequest} label={`${assistLabel(t, wholeAction)} · ${t("studies.teaching.points.whole")}`}>
          <AssistPanel
            key={wholeRequest}
            preparationId={prep.id}
            target={{ part: "whole", pointId: null, label: t("studies.teaching.points.whole"), text: "", selection: null }}
            action={wholeAction}
            onApply={() => false}
            onKeep={(m) => hooks.keep({ ...m, pointId: null })}
            onAddPassage={(r) => hooks.addPassage(r, null)}
            onClose={() => {
              setWholeAction(null);
              dock.release("whole");
              requestAnimationFrame(() => wholeButton.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.focus());
            }}
            canFindImages={hooks.canFindImages}
            canGenerateImages={hooks.canGenerateImages}
            imagesNote={hooks.imagesNote}
            imageService={hooks.imageService}
          />
          </FloatingPanel>
        )}
        <ol className="m-0 flex list-none flex-col gap-6 p-0">
          {prep.points.map((point, index) => {
            const name = point.title.trim() || shape("untitled", { number: index + 1 });
            return (
              <li key={point.id} aria-label={shape("label", { number: index + 1, title: name })} className="flex flex-col gap-3 border-l-[3px] border-accent pl-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-ui text-[0.875rem] font-semibold text-text-muted">{shape("number", { number: index + 1 })}</span>
                  {/* A step of a lesson says what kind of step it is; its fields follow. */}
                  {shapeName === "steps" && (
                    <select
                      value={point.kind ?? ""}
                      onChange={(e) => void act(() => api.teachingPointUpdate({ id: point.id, kind: e.target.value as StepKind | "" }))}
                      aria-label={t("studies.teaching.stepKindLabel", { step: name })}
                      className="h-11 rounded-aw border border-border-subtle bg-bg px-2 text-[0.9375rem] text-text-strong"
                    >
                      <option value="">{t("studies.teaching.stepKind.none")}</option>
                      {[...STEP_KINDS, ...(point.kind === "audio" ? (["audio"] as const) : [])].map((k) => (
                        <option key={k} value={k}>
                          {t(`studies.teaching.stepKind.${k}`)}
                        </option>
                      ))}
                    </select>
                  )}
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
                      confirm={shape("deleteConfirm")}
                      hasContent={Boolean(point.title.trim() || point.explanation.trim() || point.application.trim() || point.illustration.trim())}
                      onDelete={() => {
                        deleted.current.add(point.id);
                        void act(() => api.teachingPointDelete(point.id)).then((next) => {
                          if (!next) {
                            deleted.current.delete(point.id);
                            return;
                          }
                          setNotice(shape("removed"));
                          // Focus goes to the point before (else after) it, or to "Add a point".
                          const target = next.points[Math.max(0, index - 1)];
                          requestAnimationFrame(() =>
                            (target
                              ? document.getElementById(`point-title-${target.id}`)
                              : addButton.current
                            )?.focus(),
                          );
                        });
                      }}
                    />
                  </span>
                </div>
                <TeachingField
                  key={`ptitle-${point.id}`}
                  label={shape("titleLabel", { number: index + 1 })}
                  value={point.title}
                  save={savePoint(point.id, "title")}
                  part="pointTitle"
                  pointId={point.id}
                  fieldId={`point-title-${point.id}`}
                  multiline={false}
                  emphasis
                  placeholder={shape("titlePlaceholder")}
                  assistant={hooks}
                  autoFocus={point.id === newPoint}
                />
                {pointFields(shapeName, point).map((field) => {
                  const stepLabel = shapeName === "steps" ? stepFieldLabel(t, point.kind, field) : null;
                  const part = field === "explanation" ? "pointExplanation" : field === "application" ? "pointApplication" : "pointIllustration";
                  return (
                    <TeachingField
                      key={`p${field}-${point.id}`}
                      label={stepLabel ?? shape(field)}
                      value={point[field]}
                      save={savePoint(point.id, field)}
                      part={part}
                      pointId={point.id}
                      rows={field === "explanation" ? 3 : 2}
                      assistant={hooks}
                      onRevealScripture={field === "illustration" ? undefined : onRevealScripture}
                    />
                  );
                })}
                <TeachingLinks preparation={prep} pointId={point.id} scope={name} studyFindings={findings} onChanged={setPrep} onRevealScripture={onRevealScripture} />
              </li>
            );
          })}
        </ol>
        <div>
          <Button ref={addButton} className="min-h-11" onClick={() => void addPoint(prep.points[prep.points.length - 1]?.id ?? null)}>
            <Plus className="size-4" aria-hidden="true" />
            {shape("add")}
          </Button>
        </div>
      </section>

      {showsFrame(shapeName, "conclusion", prep.conclusion) && (
        <TeachingField key={`concl-${prep.id}`} label={shape("conclusion")} value={prep.conclusion} save={save("conclusion")} part="conclusion" assistant={hooks} onRevealScripture={onRevealScripture} />
      )}
      <TeachingField key={`notes-${prep.id}`} label={t("studies.teaching.notes")} placeholder={t("studies.teaching.notesHint")} value={prep.notes} save={save("notes")} part="notes" rows={2} assistant={hooks} />

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

function DeletePoint({ name, confirm, hasContent, onDelete }: { name: string; confirm: string; hasContent: boolean; onDelete: () => void }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  if (confirming)
    return (
      <span className="flex flex-wrap items-center gap-1 rounded-aw border border-border bg-bg px-2 text-[0.9375rem]">
        <span>{confirm}</span>
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
