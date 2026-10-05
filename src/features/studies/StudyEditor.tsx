import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Notice } from "@/design-system/Notice";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { useSaveTracker } from "@/hooks/SaveTracker";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { StudySection } from "@/types/domain";
import { EditableTitle } from "./EditableTitle";
import { FindingsPanel } from "./FindingsPanel";
import { RelatedStudies } from "./RelatedStudies";
import { SectionEditor } from "./SectionEditor";
import { StudyAdd } from "./StudyAdd";
import { StudyContents } from "./StudyContents";
import { StudyDetailsPanel } from "./StudyDetails";
import { StudyPassages } from "./StudyPassages";

interface StudyEditorProps {
  studyId: string;
  /** True when the user just opened this study: show its primary passage. */
  revealPrimary: boolean;
  onMissing: () => void;
  onOpenStudy: (study: { id: string; projectId: string }) => void;
  onRevealScripture: () => void;
}

export function StudyEditor({ studyId, revealPrimary, onMissing, onOpenStudy, onRevealScripture }: StudyEditorProps) {
  const { t } = useTranslation();
  const api = useApi();
  const { goTo } = useScripture();
  const detail = useLoad(useCallback(() => api.studyGet(studyId), [api, studyId]));
  const findings = useLoad(useCallback(() => api.findingList(studyId), [api, studyId]));
  const templates = useLoad(useCallback(() => api.templateList(), [api]));
  const passages = useLoad(useCallback(() => api.studyPassageList(studyId), [api, studyId]));
  const relations = useLoad(useCallback(() => api.studyRelationList(studyId), [api, studyId]));
  const detailsId = useId();
  const [showDetails, setShowDetails] = useState(false);
  const [capturing, setCapturing] = useState(false);
  // What the user has typed but the saved copy may not hold yet (block id -> has writing).
  const [typed, setTyped] = useState<Record<string, boolean>>({});
  const onContent = useCallback((blockId: string, has: boolean) => setTyped((prev) => (prev[blockId] === has ? prev : { ...prev, [blockId]: has })), []);
  const [newSection, setNewSection] = useState<string | null>(null);
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

  const sections = useMemo(() => detail.data?.sections ?? [], [detail.data]);
  if (missing) return null;
  if (detail.error) return <Notice tone="error">{detail.error.message}</Notice>;
  if (!detail.data) return <p className="text-text-muted">{t("studies.editor.opening")}</p>;

  const { study } = detail.data;
  const current = detail.data;
  // Nothing of the user's yet: no findings and no writing in any section.
  const blank = (findings.data ?? []).length === 0 && sections.every((sec) => sec.blocks.every((b) => !(typed[b.id] ?? b.content.trim().length > 0)));
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

  const addSection = async () => {
    setError(null);
    try {
      const created = await api.studySectionCreate({ studyId: study.id, title: t("studies.editor.newSectionTitle") });
      setNewSection(created.id);
      detail.reload();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <article ref={article} className="flex flex-col gap-6">
      <header
        id="study-overview"
        className="scroll-mt-4 flex flex-col gap-3"
        onKeyDown={(e) => {
          if (e.key === "Escape" && showDetails) {
            e.stopPropagation();
            setShowDetails(false);
            toggle.current?.focus();
          }
        }}
      >
        <EditableTitle key={study.id} label={t("studies.editor.titleLabel")} value={study.title} onSave={rename} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9375rem] text-text-muted">
          <button
            ref={toggle}
            type="button"
            aria-expanded={showDetails}
            aria-controls={detailsId}
            onClick={() => setShowDetails(!showDetails)}
            className="inline-flex min-h-9 items-center gap-1 rounded-aw px-1 hover:text-text-strong"
          >
            {showDetails ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
            {t("studies.header.detailsToggle")}
          </button>
          <StudyContents sections={sections} hasFindings={(findings.data ?? []).length > 0} />
          <SaveIndicator />
        </div>
        <StudyPassages studyId={study.id} title={study.title} passages={passages.data ?? []} reload={passages.reload} onReveal={onRevealScripture} />
        <RelatedStudies relations={relations.data ?? []} onOpen={onOpenStudy} />
        {showDetails && (
          <StudyDetailsPanel
            id={detailsId}
            study={study}
            findings={findings.data ?? []}
            templates={templates.data ?? []}
            passages={passages.data ?? []}
            relations={relations.data ?? []}
            reloadPassages={passages.reload}
            reloadRelations={relations.reload}
            onChanged={(s) => detail.setData({ ...current, study: s })}
            onDuplicated={(id) => onOpenStudy({ id, projectId: study.projectId })}
          />
        )}
      </header>

      <StudyAdd empty={blank} onAddNote={() => setCapturing(true)} onAddSection={addSection} />

      <FindingsPanel
        studyId={study.id}
        findings={findings.data ?? []}
        sections={sections}
        capturing={capturing}
        onCaptureClose={() => setCapturing(false)}
        onChanged={findings.reload}
        onRevealScripture={onRevealScripture}
      />

      {sections.map((section, index) => (
        <SectionEditor
          key={section.id}
          section={section}
          isFirst={index === 0}
          isLast={index === sections.length - 1}
          hasFindings={(findings.data ?? []).some((f) => f.sectionId === section.id)}
          onChange={updateSection}
          onMove={(delta) => moveSection(section.id, delta)}
          onDeleted={() => {
            detail.reload();
            findings.reload();
          }}
          onRevealScripture={onRevealScripture}
          reveal={section.id === newSection}
          typed={typed}
          onContent={onContent}
        />
      ))}
      {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
    </article>
  );
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
