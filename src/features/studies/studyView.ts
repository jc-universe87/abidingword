import { readLocal, writeLocal } from "@/lib/storage";

/** The two ways of working with a study: understanding the text, and preparing to teach it. */
export type StudyView = "study" | "teaching";

const key = (studyId: string) => `study.view.${studyId}`;

/** The side of a study last worked on, on this computer (a convenience, never study data). */
export function lastView(studyId: string): StudyView {
  return readLocal<string>(key(studyId), "study") === "teaching" ? "teaching" : "study";
}

export function rememberView(studyId: string, view: StudyView) {
  writeLocal(key(studyId), view);
}

/** A study made to prepare a teaching opens on its Bible Teaching side. */
export function openInTeaching(studyId: string) {
  rememberView(studyId, "teaching");
}
