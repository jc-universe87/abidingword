import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Plus } from "lucide-react";
import { Notice } from "@/design-system/Notice";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { useSaveTracker } from "@/hooks/SaveTracker";
import { useLoad } from "@/hooks/useLoad";
import { readLocal, writeLocal } from "@/lib/storage";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { StudySection } from "@/types/domain";
import { FINDING_TYPES, type FindingType } from "@/types/studies";
import { Button } from "@/design-system/Button";
import { EditableTitle } from "./EditableTitle";
import { AddPart, type NewPart } from "./AddPart";
import { FindingList, FindingsPanel, KindFilter, QuickCapture } from "./FindingsPanel";
import { RelatedStudies } from "./RelatedStudies";
import { SectionEditor } from "./SectionEditor";
import { sectionTitle } from "./builtinText";
import { useStudyFocus } from "./StudyFocus";
import { StudyDetailsPanel } from "./StudyDetails";
import { StudyPassages } from "./StudyPassages";
import { hasJourney, namesRun, phaseRuns } from "./journey";
import { JourneyOutline, NextStep, useCurrentRun, usePhaseName } from "./StudyJourney";
import { lastView, rememberView, type StudyView } from "./studyView";
import { TeachingView } from "@/features/teaching/TeachingView";

interface StudyEditorProps {
  studyId: string;
  /** The way back to where the study was opened from (its project, or the list of studies). */
  back?: { label: string; onBack: () => void };
  /** True when the user just opened this study: show its primary passage. */
  revealPrimary: boolean;
  onMissing: () => void;
  onOpenStudy: (study: { id: string; projectId: string }) => void;
  onRevealScripture: () => void;
}

export function StudyEditor({ studyId, back, revealPrimary, onMissing, onOpenStudy, onRevealScripture }: StudyEditorProps) {
  const { t } = useTranslation();
  const api = useApi();
  const { goTo, setStudyPassage } = useScripture();
  const detail = useLoad(useCallback(() => api.studyGet(studyId), [api, studyId]));
  const findings = useLoad(useCallback(() => api.findingList(studyId), [api, studyId]));
  const templates = useLoad(useCallback(() => api.templateList(), [api]));
  const passages = useLoad(useCallback(() => api.studyPassageList(studyId), [api, studyId]));
  const relations = useLoad(useCallback(() => api.studyRelationList(studyId), [api, studyId]));
  // The Bible Teachings prepared from this study, for the way on at its end (v0.18.6).
  const teachings = useLoad(useCallback(() => api.teachingList(studyId), [api, studyId]));
  const detailsId = useId();
  const [showDetails, setShowDetails] = useState(false);
  // Notes being written, one per place: a part's id, or "" for the study's other notes, with the kind chosen.
  // Opening Add again where a note is already being written keeps that draft.
  const [capturing, setCapturingState] = useState<Readonly<Record<string, FindingType>>>({});
  const openCapture = (place: string, kind: FindingType) => {
    if (capturing[place]) {
      document.querySelector<HTMLTextAreaElement>(`[data-capture="${place}"]`)?.focus();
      return;
    }
    setCapturingState((c) => ({ ...c, [place]: kind }));
  };
  const closeCapture = (place: string) => {
    setCapturingState(({ [place]: _closed, ...rest }) => rest);
    // Back to the Add it was opened from.
    requestAnimationFrame(() =>
      (place ? document.getElementById(`section-anchor-${place}`)?.querySelector<HTMLElement>("[data-part-add]") : noteButton.current)?.focus(),
    );
  };
  const noteButton = useRef<HTMLButtonElement>(null);
  // Parts folded away, remembered for this study on this computer (a convenience, never study data).
  const [collapsed, setCollapsedState] = useState<ReadonlySet<string>>(() => new Set(readLocal<string[]>(collapsedKey(studyId), [])));
  const setCollapsed = useCallback(
    (next: ReadonlySet<string>) => {
      setCollapsedState(next);
      writeLocal(collapsedKey(studyId), [...next]);
    },
    [studyId],
  );
  const unfold = useCallback(
    (sectionId: string) =>
      setCollapsedState((current) => {
        if (!current.has(sectionId)) return current;
        const next = new Set([...current].filter((id) => id !== sectionId));
        writeLocal(collapsedKey(studyId), [...next]);
        return next;
      }),
    [studyId],
  );
  // What the user has typed but the saved copy may not hold yet (block id -> has writing).
  const [typed, setTyped] = useState<Record<string, boolean>>({});
  const onContent = useCallback((blockId: string, has: boolean) => setTyped((prev) => (prev[blockId] === has ? prev : { ...prev, [blockId]: has })), []);
  const [newSection, setNewSection] = useState<string | null>(null);
  // Where the user last worked, and a block just added there: the study's Add puts text blocks there.
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [newBlock, setNewBlock] = useState<string | null>(null);
  // The kind the findings are narrowed to, in the study's own notes and in every section.
  const [kindFilter, setKindFilter] = useState<FindingType | null>(null);
  // The study itself, or what it leads to: teaching preparations (v0.16).
  // Remembered per study, so a study opens again on the side last worked on.
  const [view, setViewState] = useState<StudyView>(() => lastView(studyId));
  const setView = (next: StudyView) => {
    setViewState(next);
    rememberView(studyId, next);
  };
  // Back from the teachings, the way on at the study's end names what was prepared there.
  const reloadTeachings = teachings.reload;
  useEffect(() => {
    if (view === "study") reloadTeachings();
  }, [view, reloadTeachings]);
  const toggle = useRef<HTMLButtonElement>(null);
  const article = useRef<HTMLElement>(null);
  const openedId = detail.data?.study.id;

  // A study opens at its title, not wherever the list before it was scrolled to.
  useEffect(() => {
    for (let el = article.current?.parentElement; el; el = el.parentElement) if (el.scrollTop > 0) el.scrollTop = 0;
  }, [openedId]);
  // Keep the page's copy of the study current, so what depends on the title (the passage line) follows it.
  const detailRef = useRef(detail.data);
  useEffect(() => {
    detailRef.current = detail.data;
  }, [detail.data]);
  const setDetail = detail.setData;
  const rename = useCallback(
    async (title: string) => {
      const study = await api.studyUpdate({ id: studyId, title });
      if (detailRef.current) setDetail({ ...detailRef.current, study });
    },
    [api, studyId, setDetail],
  );
  const [error, setError] = useState<string | null>(null);
  const missing = detail.error?.kind === "notFound";

  useEffect(() => {
    if (missing) onMissing();
  }, [missing, onMissing]);

  // While this Study is open, Scripture knows its primary passage (for "Back to …").
  // Read from the Study's passages; navigation never writes it.
  const passageList = passages.data;
  useEffect(() => {
    if (passageList) setStudyPassage(passageList.find((p) => p.role === "primary")?.reference ?? null);
  }, [passageList, setStudyPassage]);
  useEffect(() => () => setStudyPassage(null), [setStudyPassage]);

  // Opened by the user: bring Scripture to the primary passage, once.
  const revealed = useRef(false);
  useEffect(() => {
    if (!revealPrimary || revealed.current) return;
    revealed.current = true;
    api
      .studyPassageList(studyId)
      .then((passages) => {
        const primary = passages.find((p) => p.role === "primary");
        if (primary) {
          goTo(primary.reference);
          onRevealScripture();
        }
      })
      .catch(() => undefined);
  }, [revealPrimary, api, studyId, goTo, onRevealScripture]);

  // Shared with source readers (v0.15): where the person last worked, and findings added from a source.
  const focus = useStudyFocus();
  const { setActiveSection: shareActiveSection } = focus;
  useEffect(() => {
    shareActiveSection(studyId, activeSection);
  }, [studyId, activeSection, shareActiveSection]);
  const added = focus.findingsVersion;
  const activeRef = useRef(activeSection);
  useEffect(() => {
    activeRef.current = activeSection;
  }, [activeSection]);
  const reloadFindings = findings.reload;
  const seenVersion = useRef(added.n);
  useEffect(() => {
    if (added.n === seenVersion.current) return;
    seenVersion.current = added.n;
    if (added.studyId !== studyId) return;
    reloadFindings();
    // Added from a source to the part last worked in: never into a folded, unseen part.
    if (activeRef.current) unfold(activeRef.current);
  }, [added, studyId, reloadFindings, unfold]);

  const sections = useMemo(() => detail.data?.sections ?? [], [detail.data]);
  // The study's movement (v0.18.6): its parts in runs of one phase, where they stand.
  const runs = useMemo(() => phaseRuns(sections), [sections]);
  const journey = hasJourney(runs);
  const currentRun = useCurrentRun(article, runs, journey && view === "study", activeSection);
  const phaseName = usePhaseName();
  // Where each phase begins: its first part, the phase's number and, where it adds something, its name.
  const phaseStarts = new Map(
    runs.map((run, index) => [
      run.sections[0]!.id,
      { index, first: index === 0, label: run.phase && namesRun(run, phaseName(run.phase), sectionTitle) ? phaseName(run.phase) : null },
    ]),
  );
  if (missing) return null;
  if (detail.error) return <Notice tone="error">{detail.error.message}</Notice>;
  if (!detail.data) return <p className="text-text-muted">{t("studies.editor.opening")}</p>;

  const { study } = detail.data;
  const current = detail.data;
  // The template whose parts-for-later are offered: the one the study was made with, else the built-in for its kind.
  // A study made from a template no longer there is offered nothing in its place (v0.18.7): its
  // structure is its own, and a built-in template's parts would bring meanings it never had.
  const template = study.templateId
    ? ((templates.data ?? []).find((tpl) => tpl.id === study.templateId) ?? null)
    : ((templates.data ?? []).find((tpl) => tpl.isBuiltin && tpl.studyType === study.studyType) ?? null);
  const expand = unfold;
  const allCollapsed = sections.length > 0 && sections.every((sec) => collapsed.has(sec.id));
  const updateSection = (section: StudySection) =>
    detail.setData({ ...current, sections: sections.map((s) => (s.id === section.id ? section : s)) });

  const moveSection = async (sectionId: string, delta: -1 | 1) => {
    const ids = sections.map((s) => s.id);
    const index = ids.indexOf(sectionId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    setError(null);
    try {
      const reordered = await api.studySectionReorder({ parentId: study.id, ids });
      detail.setData({ ...current, sections: reordered });
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const addSection = async (part: NewPart) => {
    setError(null);
    try {
      // A part the template keeps for later comes with its key and phase; one of the person's own with neither.
      const created = await api.studySectionCreate({ studyId: study.id, title: part.title, guidance: part.guidance, key: part.key ?? null, phase: part.phase ?? null });
      setNewSection(created.id);
      detail.reload();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const sectionNotes = (sectionId: string) => {
    const shown = (findings.data ?? []).filter((f) => f.sectionId === sectionId && (kindFilter === null || f.findingType === kindFilter));
    if (shown.length === 0) return null;
    return (
      <FindingList
        label={t("studies.findings.inSection", { section: sectionTitle(sections.find((s) => s.id === sectionId)!) })}
        findings={shown}
        all={findings.data ?? []}
        sections={sections}
        canMove={kindFilter === null}
        onChanged={findings.reload}
        onRevealScripture={onRevealScripture}
      />
    );
  };
  const addWriting = async (target: StudySection) => {
    setError(null);
    try {
      const block = await api.studyBlockCreate({ sectionId: target.id, blockType: "paragraph" });
      expand(target.id);
      setNewBlock(block.id);
      updateSection({ ...target, blocks: [...target.blocks, block] });
    } catch (e) {
      setError(toApiError(e).message);
    }
  };
  const capture = (section: StudySection) =>
    capturing[section.id] ? (
      <QuickCapture
        studyId={study.id}
        sections={sections}
        initialType={capturing[section.id]}
        sectionId={section.id}
        place={section.id}
        autoFocus
        onDone={() => {
          closeCapture(section.id);
          findings.reload();
        }}
        onCancel={() => closeCapture(section.id)}
      />
    ) : null;

  return (
    <article ref={article} className="flex flex-col gap-3">
      <header
        id="study-overview"
        className="scroll-mt-4 flex flex-col gap-1"
        onKeyDown={(e) => {
          if (e.key === "Escape" && showDetails) {
            e.stopPropagation();
            setShowDetails(false);
            toggle.current?.focus();
          }
        }}
      >
        <div className="flex items-start gap-1">
          {back && (
            <nav aria-label={t("studies.projects.breadcrumb")} className="-ml-3 shrink-0">
              <button
                type="button"
                onClick={back.onBack}
                aria-label={back.label}
                title={back.label}
                className="inline-flex size-11 items-center justify-center rounded-aw text-text-muted hover:bg-hover hover:text-text-strong"
              >
                <ArrowLeft className="size-5" aria-hidden="true" />
              </button>
            </nav>
          )}
          <div className="min-w-0 flex-1">
            <EditableTitle key={study.id} label={t("studies.editor.titleLabel")} value={study.title} onSave={rename} />
          </div>
        </div>
        {/* One quiet line under the title: the two ways of working, the passages, the details. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.9375rem] text-text-muted">
          <div role="group" aria-label={t("studies.view.label")} className="-ml-2 flex">
            {(["study", "teaching"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className="aw-tab"
              >
                {t(`studies.view.${v}`)}
              </button>
            ))}
          </div>
          <button
            ref={toggle}
            type="button"
            aria-expanded={showDetails}
            aria-controls={detailsId}
            onClick={() => setShowDetails(!showDetails)}
            className="inline-flex min-h-11 items-center gap-1 rounded-aw px-1 hover:text-text-strong"
          >
            {showDetails ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
            {t("studies.header.detailsToggle")}
          </button>
          <StudyPassages studyId={study.id} title={study.title} passages={passages.data ?? []} reload={passages.reload} onReveal={onRevealScripture} />
          {view === "study" && <KindFilter findings={findings.data ?? []} filter={kindFilter} onFilter={setKindFilter} />}
          {view === "study" && sections.length > 1 && (
            <button
              type="button"
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(sections.map((sec) => sec.id)))}
              className="inline-flex min-h-11 items-center gap-1 rounded-aw px-1 hover:text-text-strong"
            >
              {allCollapsed ? <ChevronsUpDown className="size-4" aria-hidden="true" /> : <ChevronsDownUp className="size-4" aria-hidden="true" />}
              {allCollapsed ? t("studies.parts.expandAll") : t("studies.parts.collapseAll")}
            </button>
          )}
          <SaveIndicator />
        </div>
        <RelatedStudies relations={relations.data ?? []} onOpen={onOpenStudy} />
        {showDetails && (
          <StudyDetailsPanel
            id={detailsId}
            study={study}
            sections={sections}
            findings={findings.data ?? []}
            templates={templates.data ?? []}
            passages={passages.data ?? []}
            relations={relations.data ?? []}
            reloadPassages={passages.reload}
            reloadRelations={relations.reload}
            onChanged={(s) => detail.setData({ ...current, study: s })}
            onDuplicated={(id) => onOpenStudy({ id, projectId: study.projectId })}
            onRevealScripture={onRevealScripture}
          />
        )}
      </header>

      {view === "teaching" ? (
        <TeachingView studyId={study.id} studyTitle={study.title} findings={findings.data ?? []} onRevealScripture={onRevealScripture} />
      ) : (
      <>
      {journey && (
        <JourneyOutline
          runs={runs}
          current={currentRun}
          onGo={(index) => {
            const first = runs[index]?.sections[0];
            if (!first) return;
            document.getElementById(`section-anchor-${first.id}`)?.scrollIntoView?.({ block: "start" });
            document.getElementById(`section-${first.id}`)?.focus({ preventScroll: true });
          }}
        />
      )}
      {/* The parts stay siblings keyed by their own id, so moving one never rebuilds the others;
          where a phase begins is marked on its first part (v0.18.6 review). */}
      {sections.map((section) => (
        <SectionEditor
          key={section.id}
          section={section}
          isFirst={section.id === sections[0]?.id}
          isLast={section.id === sections[sections.length - 1]?.id}
          hasFindings={(findings.data ?? []).some((f) => f.sectionId === section.id)}
          notes={sectionNotes(section.id)}
          noteCount={(findings.data ?? []).filter((f) => f.sectionId === section.id).length}
          capture={capture(section)}
          collapsed={collapsed.has(section.id)}
          onCollapsedChange={(fold) => setCollapsed(fold ? new Set([...collapsed, section.id]) : new Set([...collapsed].filter((id) => id !== section.id)))}
          onAddWriting={() => void addWriting(section)}
          onAddNote={(kind) => {
            expand(section.id);
            openCapture(section.id, kind);
          }}
          onChange={updateSection}
          onMove={(delta) => moveSection(section.id, delta)}
          onDeleted={() => {
            detail.reload();
            findings.reload();
          }}
          onRevealScripture={onRevealScripture}
          reveal={section.id === newSection}
          active={section.id === activeSection}
          phase={journey ? phaseStarts.get(section.id) : undefined}
          onActive={() => setActiveSection(section.id)}
          newBlockId={newBlock}
          typed={typed}
          onContent={onContent}
        />
      ))}

      <FindingsPanel
        studyId={study.id}
        findings={findings.data ?? []}
        sections={sections}
        filter={kindFilter}
        capturing={capturing[""] ?? null}
        onCaptureClose={() => closeCapture("")}
        onChanged={findings.reload}
        onRevealScripture={onRevealScripture}
      />

      {/* The end of the study: another part, or a note that belongs to no part. */}
      <div className="flex flex-wrap items-start gap-2 border-t border-border-subtle pt-3">
        <AddPart template={template} sections={sections} onAdd={addSection} />
        <Button ref={noteButton} variant="quiet" className="min-h-11" onClick={() => openCapture("", lastNoteKind(study.id))}>
          <Plus className="size-4" aria-hidden="true" />
          {t("studies.add.note")}
        </Button>
      </div>
      <NextStep teachings={teachings.data ?? null} onOpenTeaching={() => setView("teaching")} />
      </>
      )}
      {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
    </article>
  );
}

const collapsedKey = (studyId: string) => `study.collapsed.${studyId}`;

/** The kind of note last written in this study (as the note form remembers it), else an observation. */
function lastNoteKind(studyId: string): FindingType {
  const stored = readLocal<string | null>(`study.lastFindingType.${studyId}`, null);
  return FINDING_TYPES.find((type) => type === stored) ?? "observation";
}

/**
 * Autosave, mostly out of sight: nothing when idle, a brief "Saving…" or
 * "Saved" while it happens, and a message that stays when it fails.
 */
function SaveIndicator() {
  const { t } = useTranslation();
  const { status } = useSaveTracker();
  // The "Saved" of one save is put away after a moment (the status object is new for each save).
  const [expired, setExpired] = useState<unknown>(null);
  useEffect(() => {
    if (status.state !== "saved") return;
    const timer = setTimeout(() => setExpired(status), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  const text =
    status.state === "saving" ? t("common.saving") : status.state === "saved" && expired !== status ? t("studies.editor.saved") : status.state === "error" ? status.message : "";
  return (
    <span role="status" className={status.state === "error" ? "text-danger" : ""}>
      {text}
    </span>
  );
}
