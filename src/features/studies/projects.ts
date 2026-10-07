// Which project a new study goes into, so that nobody has to choose one.
//
// Projects stay a way to organise studies, but they are not a prerequisite:
//   1. No project yet: one is made, "My studies" (in the interface language).
//   2. One project: that one.
//   3. Several: the one last worked in on this device, if it still exists;
//      otherwise the project of the most recently changed study; otherwise
//      the first project in the list (by title). Deterministic: the same
//      library always gives the same answer.
import type { TFunction } from "i18next";
import { readLocal, writeLocal } from "@/lib/storage";
import type { Api } from "@/lib/api";
import type { Project } from "@/types/domain";
import type { StudySummary } from "@/types/studies";

const LAST_PROJECT_KEY = "studyPane.lastProject";

/** Remembers where the user last worked (a per-device convenience, never study data). */
export function rememberProject(projectId: string): void {
  writeLocal(LAST_PROJECT_KEY, projectId);
}

/** The project a new study belongs in, among existing ones; null when there are none. */
export function pickProject(projects: Project[], studies: StudySummary[], last: string | null = readLocal<string | null>(LAST_PROJECT_KEY, null)): string | null {
  if (projects.length === 0) return null;
  if (projects.length === 1) return projects[0]!.id;
  if (last && projects.some((p) => p.id === last)) return last;
  const known = new Set(projects.map((p) => p.id));
  const latest = studies
    .filter((s) => known.has(s.projectId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
  return latest ? latest.projectId : projects[0]!.id;
}

let creating: Promise<string> | null = null;

/** The id of the project for a new study, making the default one when the workspace has none. */
export async function ensureStudyProject(api: Api, workspaceId: string, t: TFunction): Promise<string> {
  const projects = await api.projectList(workspaceId);
  const studies = projects.length > 1 ? await api.studyList({}) : [];
  const existing = pickProject(projects, studies);
  if (existing) return existing;
  // Two quick creations must not make two default projects.
  creating ??= api
    .projectCreate({ workspaceId, title: t("studies.projects.defaultTitle") })
    .then((project) => project.id)
    .finally(() => {
      creating = null;
    });
  return creating;
}
