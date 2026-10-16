import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { readLocal } from "@/lib/storage";

/**
 * Which Study the person has open, and where in it they last worked (v0.15),
 * shared at the application level so that reading a source can offer "Add to
 * Study" without reaching into the Study pane. The Study pane says what is
 * open; a source reader reads it, and says when it added a finding so the
 * open Study can show it. Nothing here is saved: the part last worked in
 * lasts for this session only.
 */
export interface StudyFocus {
  /** The Study open in the Study pane, if any (its id; the reader loads the rest). */
  openStudyId: string | null;
  /** The part of the open Study last worked in during this session. */
  activeSectionId: string | null;
  setOpenStudy: (studyId: string | null) => void;
  setActiveSection: (studyId: string, sectionId: string | null) => void;
  /** A finding was added to this Study from elsewhere. */
  findingsChanged: (studyId: string) => void;
  /** Bumped by `findingsChanged`, with the Study it concerns. */
  findingsVersion: { studyId: string | null; n: number };
}

/** The Study the Study pane will open on (its remembered place), before it has said so itself. */
function rememberedStudy(): string | null {
  const location = readLocal<{ kind?: string; studyId?: string } | null>("studyPane.location", null);
  return location?.kind === "study" && typeof location.studyId === "string" ? location.studyId : null;
}

const StudyFocusContext = createContext<StudyFocus | null>(null);

export function StudyFocusProvider({ children }: { children: ReactNode }) {
  const [openStudyId, setOpenStudyId] = useState<string | null>(rememberedStudy);
  const [active, setActive] = useState<{ studyId: string; sectionId: string | null } | null>(null);
  const [findingsVersion, setVersion] = useState<{ studyId: string | null; n: number }>({ studyId: null, n: 0 });
  const setOpenStudy = useCallback((studyId: string | null) => setOpenStudyId(studyId), []);
  const setActiveSection = useCallback((studyId: string, sectionId: string | null) => setActive({ studyId, sectionId }), []);
  const findingsChanged = useCallback((studyId: string) => setVersion((v) => ({ studyId, n: v.n + 1 })), []);
  const value = useMemo<StudyFocus>(
    () => ({
      openStudyId,
      activeSectionId: active && active.studyId === openStudyId ? active.sectionId : null,
      setOpenStudy,
      setActiveSection,
      findingsChanged,
      findingsVersion,
    }),
    [openStudyId, active, setOpenStudy, setActiveSection, findingsChanged, findingsVersion],
  );
  return <StudyFocusContext.Provider value={value}>{children}</StudyFocusContext.Provider>;
}

const NONE: StudyFocus = {
  openStudyId: null,
  activeSectionId: null,
  setOpenStudy: () => undefined,
  setActiveSection: () => undefined,
  findingsChanged: () => undefined,
  findingsVersion: { studyId: null, n: 0 },
};

/** The shared Study focus; outside a provider (isolated tests), no Study is open. */
export function useStudyFocus(): StudyFocus {
  return useContext(StudyFocusContext) ?? NONE;
}
