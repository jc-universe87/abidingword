import { useCallback, useEffect } from "react";
import { Notice } from "@/design-system/Notice";
import { useSaveTracker } from "@/hooks/SaveTracker";
import { useLoad } from "@/hooks/useLoad";
import { useApi } from "@/lib/ApiContext";
import type { StudySection } from "@/types/domain";
import { EditableTitle } from "./EditableTitle";
import { SectionEditor } from "./SectionEditor";

interface StudyEditorProps {
  studyId: string;
  onMissing: () => void;
}

export function StudyEditor({ studyId, onMissing }: StudyEditorProps) {
  const api = useApi();
  const detail = useLoad(useCallback(() => api.studyGet(studyId), [api, studyId]));
  const rename = useCallback((title: string) => api.studyUpdate({ id: studyId, title }), [api, studyId]);
  const missing = detail.error?.kind === "notFound";

  useEffect(() => {
    if (missing) onMissing();
  }, [missing, onMissing]);

  if (missing) return null;
  if (detail.error) return <Notice tone="error">{detail.error.message}</Notice>;
  if (!detail.data) return <p className="text-text-muted">Opening study…</p>;

  const { study, sections } = detail.data;
  const current = detail.data;
  const updateSection = (section: StudySection) =>
    detail.setData({ ...current, sections: sections.map((s) => (s.id === section.id ? section : s)) });

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="caps-label m-0">Study</p>
        <EditableTitle key={study.id} label="Study title" value={study.title} onSave={rename} />
        <SaveStatusLine />
        <nav aria-label="Sections">
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[0.9375rem]">
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#section-anchor-${section.id}`} className="text-link underline-offset-4 hover:underline">
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {sections.map((section) => (
        <SectionEditor key={section.id} section={section} onChange={updateSection} />
      ))}
    </article>
  );
}

function SaveStatusLine() {
  const { status } = useSaveTracker();
  const text = {
    idle: "Changes are saved automatically.",
    saving: "Saving…",
    saved: "All changes saved.",
    error: status.state === "error" ? status.message : "",
  }[status.state];
  return (
    <p role="status" className={`m-0 text-[0.9375rem] ${status.state === "error" ? "text-danger" : "text-text-muted"}`}>
      {text}
    </p>
  );
}
