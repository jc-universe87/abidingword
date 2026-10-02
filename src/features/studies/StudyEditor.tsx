import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { useSaveTracker } from "@/hooks/SaveTracker";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { StudySection } from "@/types/domain";
import { EditableTitle } from "./EditableTitle";
import { FindingsPanel, type FindingsPanelHandle } from "./FindingsPanel";
import { sectionTitle } from "./builtinText";
import { studyTypeLabel } from "./labels";
import { RelatedStudies } from "./RelatedStudies";
import { SectionEditor } from "./SectionEditor";
import { StudyHeader } from "./StudyHeader";
import { StudyPassages } from "./StudyPassages";
import { useStudyShortcuts } from "./useStudyShortcuts";

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
  const rename = useCallback((title: string) => api.studyUpdate({ id: studyId, title }), [api, studyId]);
  const findingsPanel = useRef<FindingsPanelHandle>(null);
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
  const jumpSection = useCallback(
    (delta: 1 | -1) => {
      const anchors = ["study-overview", "study-findings", ...sections.map((s) => `section-anchor-${s.id}`)];
      const scroller = document.querySelector("#pane-study [data-scroll-root]");
      const top = scroller?.getBoundingClientRect().top ?? 0;
      const positions = anchors.map((id) => document.getElementById(id)?.getBoundingClientRect().top ?? 0);
      const current = positions.reduce((best, pos, i) => (pos - top <= 8 ? i : best), 0);
      const target = anchors[Math.min(anchors.length - 1, Math.max(0, current + delta))];
      const element = target ? document.getElementById(target) : null;
      element?.scrollIntoView?.({ block: "start" });
      element?.querySelector<HTMLElement>("h2, textarea")?.focus({ preventScroll: true });
    },
    [sections],
  );
  useStudyShortcuts({
    onCapture: useCallback((type) => {
      document.getElementById("study-findings")?.scrollIntoView?.({ block: "start" });
      findingsPanel.current?.capture(type);
    }, []),
    onSection: jumpSection,
  });

  if (missing) return null;
  if (detail.error) return <Notice tone="error">{detail.error.message}</Notice>;
  if (!detail.data) return <p className="text-text-muted">{t("studies.editor.opening")}</p>;

  const { study } = detail.data;
  const current = detail.data;
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
      await api.studySectionCreate({ studyId: study.id, title: t("studies.editor.newSectionTitle") });
      detail.reload();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <article className="flex flex-col gap-6">
      <header id="study-overview" className="scroll-mt-4 flex flex-col gap-3">
        <p className="caps-label m-0">{studyTypeLabel(t, study.studyType)}</p>
        <EditableTitle key={study.id} label={t("studies.editor.titleLabel")} value={study.title} onSave={rename} />
        <StudyHeader
          study={study}
          findings={findings.data ?? []}
          templates={templates.data ?? []}
          onChanged={(s) => detail.setData({ ...current, study: s })}
          onDuplicated={(id) => onOpenStudy({ id, projectId: study.projectId })}
        />
        <StudyPassages studyId={study.id} onReveal={onRevealScripture} />
        <RelatedStudies studyId={study.id} onOpen={onOpenStudy} />
        <SaveStatusLine />
        <nav aria-label={t("studies.editor.contents")}>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[0.9375rem]">
            <li>
              <a href="#study-findings" className="font-medium text-link underline-offset-4 hover:underline">
                {findings.data && findings.data.length > 0
                  ? t("studies.editor.findingsLinkCount", { count: findings.data.length })
                  : t("studies.editor.findingsLink")}
              </a>
            </li>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#section-anchor-${section.id}`} className="text-link underline-offset-4 hover:underline">
                  {sectionTitle(section)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <FindingsPanel
        ref={findingsPanel}
        studyId={study.id}
        findings={findings.data ?? []}
        sections={sections}
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
        />
      ))}

      <div className="border-t border-border-subtle pt-4">
        <Button onClick={addSection}>
          <Plus className="size-4" aria-hidden="true" />
          {t("studies.editor.addSection")}
        </Button>
      </div>
      {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
    </article>
  );
}

function SaveStatusLine() {
  const { t } = useTranslation();
  const { status } = useSaveTracker();
  const text = {
    idle: t("studies.editor.savedAutomatically"),
    saving: t("common.saving"),
    saved: t("studies.editor.allSaved"),
    error: status.state === "error" ? status.message : "",
  }[status.state];
  return (
    <p role="status" className={`m-0 text-[0.9375rem] ${status.state === "error" ? "text-danger" : "text-text-muted"}`}>
      {text}
    </p>
  );
}
