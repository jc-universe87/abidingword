// An in-memory implementation of the native API for interface tests.
// It mirrors the behaviour the Rust layer guarantees (validation messages,
// template sections, soft delete), not its storage.
import template from "../../resources/templates/passage-study.json";
import { ApiError, type Api } from "@/lib/api";
import type {
  AppInfo,
  AppSettings,
  Project,
  Study,
  StudyBlock,
  StudySection,
  Workspace,
} from "@/types/domain";

const now = () => new Date().toISOString();
let counter = 0;
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

function requireTitle(value: string, what: string): string {
  const title = value.trim();
  if (!title) throw new ApiError("invalidInput", `Please give the ${what} a title.`);
  return title;
}

export interface MemoryApi extends Api {
  state: {
    info: AppInfo;
    workspace: Workspace;
    projects: Project[];
    studies: Study[];
    sections: StudySection[];
    blocks: StudyBlock[];
    settings: AppSettings;
  };
}

export function createMemoryApi(overrides: Partial<AppInfo> = {}): MemoryApi {
  const stamp = now();
  const state: MemoryApi["state"] = {
    info: {
      version: "0.1.0",
      ready: true,
      error: null,
      dataDirectory: "/home/test/.local/share/Abiding Word",
      databasePath: "/home/test/.local/share/Abiding Word/database/abiding-word.db",
      logDirectory: "/home/test/.local/share/Abiding Word/logs",
      schemaVersion: 1,
      ...overrides,
    },
    workspace: { id: id(), name: "My Workspace", isDefault: true, createdAt: stamp, updatedAt: stamp, revision: 1 },
    projects: [],
    studies: [],
    sections: [],
    blocks: [],
    settings: { theme: "light" },
  };

  const find = <T extends { id: string }>(list: T[], key: string, entity: string): T => {
    const item = list.find((x) => x.id === key);
    if (!item) throw new ApiError("notFound", `This ${entity} could not be found. It may have been deleted.`);
    return item;
  };
  const withCount = (p: Project): Project => ({
    ...p,
    studyCount: state.studies.filter((s) => s.projectId === p.id).length,
  });
  const sectionsOf = (studyId: string): StudySection[] =>
    state.sections
      .filter((s) => s.studyId === studyId)
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ ...s, blocks: state.blocks.filter((b) => b.sectionId === s.id) }));
  const detail = (studyId: string) => ({ study: find(state.studies, studyId, "study"), sections: sectionsOf(studyId) });

  const api: MemoryApi = {
    state,
    appInfo: async () => state.info,
    logError: async () => undefined,
    workspaceGetDefault: async () => state.workspace,
    projectList: async (workspaceId) =>
      state.projects
        .filter((p) => p.workspaceId === workspaceId)
        .map(withCount)
        .sort((a, b) => a.title.localeCompare(b.title)),
    projectGet: async (key) => withCount(find(state.projects, key, "project")),
    projectCreate: async (input) => {
      const t = now();
      const project: Project = {
        id: id(),
        workspaceId: input.workspaceId,
        title: requireTitle(input.title, "project"),
        description: input.description ?? null,
        studyCount: 0,
        createdAt: t,
        updatedAt: t,
        revision: 1,
      };
      state.projects.push(project);
      return project;
    },
    projectUpdate: async (input) => {
      const project = find(state.projects, input.id, "project");
      if (input.title !== undefined) project.title = requireTitle(input.title, "project");
      project.revision += 1;
      return withCount(project);
    },
    studyList: async (projectId) => state.studies.filter((s) => s.projectId === projectId),
    studyGet: async (key) => detail(key),
    studyCreate: async (input) => {
      find(state.projects, input.projectId, "project");
      const t = now();
      const study: Study = {
        id: id(),
        projectId: input.projectId,
        templateId: null,
        title: requireTitle(input.title, "study"),
        createdAt: t,
        updatedAt: t,
        revision: 1,
      };
      state.studies.push(study);
      template.sections.forEach((s, position) => {
        const sectionId = id();
        state.sections.push({
          id: sectionId,
          studyId: study.id,
          key: s.key,
          title: s.title,
          guidance: s.guidance,
          position,
          blocks: [],
          createdAt: t,
          updatedAt: t,
          revision: 1,
        });
        state.blocks.push({
          id: id(),
          sectionId,
          blockType: "paragraph",
          position: 0,
          content: "",
          createdAt: t,
          updatedAt: t,
          revision: 1,
        });
      });
      return detail(study.id);
    },
    studyUpdate: async (input) => {
      const study = find(state.studies, input.id, "study");
      if (input.title !== undefined) study.title = requireTitle(input.title, "study");
      study.revision += 1;
      return { ...study };
    },
    studySectionList: async (studyId) => sectionsOf(studyId),
    studySectionUpdate: async (input) => {
      const section = find(state.sections, input.id, "section");
      if (input.title !== undefined) section.title = requireTitle(input.title, "section");
      return { ...section, blocks: state.blocks.filter((b) => b.sectionId === section.id) };
    },
    studyBlockCreate: async (input) => {
      find(state.sections, input.sectionId, "section");
      const t = now();
      const block: StudyBlock = {
        id: id(),
        sectionId: input.sectionId,
        blockType: input.blockType,
        position: state.blocks.filter((b) => b.sectionId === input.sectionId).length,
        content: input.content ?? "",
        createdAt: t,
        updatedAt: t,
        revision: 1,
      };
      state.blocks.push(block);
      return block;
    },
    studyBlockUpdate: async (input) => {
      const block = find(state.blocks, input.id, "block");
      if (input.content !== undefined) block.content = input.content;
      block.revision += 1;
      return { ...block };
    },
    studyBlockDelete: async (key) => {
      find(state.blocks, key, "block");
      state.blocks = state.blocks.filter((b) => b.id !== key);
    },
    settingsGet: async () => ({ ...state.settings }),
    settingsUpdate: async (input) => {
      if (input.theme) state.settings.theme = input.theme;
      return { ...state.settings };
    },
  };
  return api;
}
