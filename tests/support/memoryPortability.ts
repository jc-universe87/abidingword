// In-memory project packages and backups (v0.19) for interface tests and
// screenshots. Mirrors src-tauri/src/portability: a package's import always
// adds a new project under a free title; nothing is replaced.
import { ApiError, type Api } from "@/lib/api";
import type { Project } from "@/types/domain";
import type { BackupPreview, ProjectPackagePreview } from "@/types/portability";
import type { FindingType } from "@/types/studies";
import type { TeachingKind } from "@/types/teaching";
import sample from "../../resources/sample/abiding-in-christ.json";

export interface PortabilityState {
  /** What the next open and save dialogs return (null = cancelled). */
  nextOpen: string | null;
  nextSave: string | null;
  /** What the package being opened holds; an error to refuse it instead. */
  package: Omit<ProjectPackagePreview, "importTitle"> | ApiError;
  backup: BackupPreview | ApiError;
  exported: { projectId: string; path: string }[];
  backups: string[];
  restored: string[];
  /** The example project once added (as the settings table remembers it). */
  sampleProjectId: string | null;
}

export function newPortabilityState(): PortabilityState {
  return {
    nextOpen: "/home/test/Documents/John.awproject",
    nextSave: "/home/test/Documents/John.awproject",
    package: {
      title: "John",
      description: "Sermons on the Upper Room.",
      createdAt: "2026-10-01T09:30:00.000Z",
      appVersion: "0.19.0",
      counts: { studies: 2, teachings: 1, presentations: 1, notes: 6, images: 1 },
      missing: { sources: ["Commentary on John"], presentationTemplates: [], bibles: [], images: 0 },
    },
    backup: {
      createdAt: "2026-10-01T09:30:00.000Z",
      appVersion: "0.19.0",
      counts: { projects: 3, studies: 12, teachings: 4, sources: 9, bibles: 1, files: 14 },
      size: 48_300_000,
    },
    exported: [],
    backups: [],
    restored: [],
    sampleProjectId: null,
  };
}

type PortabilityApi = Pick<
  Api,
  | "projectExport"
  | "projectPackageInspect"
  | "projectImport"
  | "backupCreate"
  | "backupInspect"
  | "backupRestore"
  | "choosePortableFile"
  | "choosePortableSaveFile"
  | "sampleProjectInstall"
>;

export function portabilityApi(
  state: PortabilityState,
  h: {
    projects: () => Project[];
    createProject: (title: string, description: string | null) => Promise<Project>;
    counts: (projectId: string) => { studies: number; teachings: number; notes: number };
    api: () => Api;
  },
): PortabilityApi {
  const freeTitle = (title: string) => {
    const taken = (t: string) => h.projects().some((p) => p.title.toLowerCase() === t.toLowerCase());
    if (!taken(title)) return title;
    for (let n = 2; ; n++) if (!taken(`${title} (${n})`)) return `${title} (${n})`;
  };
  const withExtension = (path: string, extension: string) => (path.toLowerCase().endsWith(`.${extension}`) ? path : `${path}.${extension}`);
  const opened = () => {
    if (state.package instanceof ApiError) throw state.package;
    return state.package;
  };
  return {
    projectExport: async ({ projectId, path }) => {
      const project = h.projects().find((p) => p.id === projectId);
      if (!project) throw new ApiError("notFound", "Not found.");
      const target = withExtension(path, "awproject");
      state.exported.push({ projectId, path: target });
      const c = h.counts(projectId);
      return [
        target,
        {
          title: project.title,
          counts: { studies: c.studies, teachings: c.teachings, presentations: 0, notes: c.notes, images: 0 },
          external: { sources: [], presentationTemplates: [], bibles: [] },
          missingImages: 0,
        },
      ];
    },
    projectPackageInspect: async () => {
      const p = opened();
      return { ...p, importTitle: freeTitle(p.title) };
    },
    projectImport: async () => {
      const p = opened();
      const project = await h.createProject(freeTitle(p.title), p.description);
      return { projectId: project.id, title: project.title, counts: p.counts, missing: p.missing, leftOut: p.missing.sources.length };
    },
    backupCreate: async (path) => {
      const target = withExtension(path, "awbackup");
      state.backups.push(target);
      return [target, { counts: { projects: h.projects().length, studies: 0, teachings: 0, sources: 0, bibles: 0, files: 0 }, size: 1_200_000 }];
    },
    backupInspect: async () => {
      if (state.backup instanceof ApiError) throw state.backup;
      return state.backup;
    },
    backupRestore: async (path) => {
      if (state.backup instanceof ApiError) throw state.backup;
      state.restored.push(path);
      return {
        counts: state.backup.counts,
        safetyCopy: "/home/test/.local/share/Abiding Word/backups/pre-restore/abiding-word-v15-2026-10-22T10-00-00.000Z.db",
        filesAdded: state.backup.counts.files,
        filesSetAside: 0,
      };
    },
    // As src-tauri/src/sample.rs: the same content, through the same calls.
    sampleProjectInstall: async () => {
      const known = h.projects().find((p) => p.id === state.sampleProjectId);
      if (known) return { projectId: known.id, title: known.title, added: false };
      const api = h.api();
      const project = await h.createProject(sample.project.title, sample.project.description);
      const s = sample.study;
      const { study } = await api.studyCreate({ projectId: project.id, title: s.title, templateKey: s.templateKey, primaryPassage: s.passage, description: s.description });
      const detail = await api.studyGet(study.id);
      const section = (key: string) => {
        const found = detail.sections.find((sec) => sec.key === key);
        if (!found) throw new Error(`example project: no part ${key}`);
        return found;
      };
      for (const [key, text] of Object.entries(s.parts)) await api.studyBlockUpdate({ id: section(key).blocks[0]!.id, content: text });
      for (const note of s.notes)
        await api.findingCreate({ studyId: study.id, findingType: note.type as FindingType, content: note.text, sectionId: section(note.section).id, passage: "passage" in note ? note.passage : undefined });
      for (const t of sample.teachings) {
        const prep = await api.teachingCreate({ studyId: study.id, title: t.title, kind: t.kind as TeachingKind, points: t.points.map((p) => ({ title: p.title, kind: ("kind" in p ? p.kind : null) as never })) });
        await api.teachingUpdate({ id: prep.id, audience: t.audience, purpose: t.purpose, centralMessage: t.centralMessage, introduction: t.introduction, conclusion: t.conclusion });
        for (const [i, p] of t.points.entries()) {
          const point = prep.points[i]!;
          await api.teachingPointUpdate({ id: point.id, explanation: p.explanation, application: p.application, illustration: p.illustration });
          if ("passage" in p && p.passage) await api.teachingPassageAdd({ preparationId: prep.id, pointId: point.id, reference: p.passage as string });
        }
      }
      state.sampleProjectId = project.id;
      return { projectId: project.id, title: project.title, added: true };
    },
    choosePortableFile: async () => state.nextOpen,
    choosePortableSaveFile: async () => state.nextSave,
  };
}
