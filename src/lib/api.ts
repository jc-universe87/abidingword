// The frontend's only door to the native core. Components use the `Api`
// interface through `useApi()`, never `invoke` directly, so tests can supply
// an in-memory implementation.
import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  AppSettings,
  CreateProject,
  CreateStudy,
  CreateStudyBlock,
  ErrorKind,
  Project,
  Study,
  StudyBlock,
  StudyDetail,
  StudySection,
  UpdateProject,
  UpdateSettings,
  UpdateStudy,
  UpdateStudyBlock,
  UpdateStudySection,
  Workspace,
} from "@/types/domain";

export interface Api {
  appInfo(): Promise<AppInfo>;
  logError(message: string): Promise<void>;
  workspaceGetDefault(): Promise<Workspace>;
  projectList(workspaceId: string): Promise<Project[]>;
  projectGet(id: string): Promise<Project>;
  projectCreate(input: CreateProject): Promise<Project>;
  projectUpdate(input: UpdateProject): Promise<Project>;
  studyList(projectId: string): Promise<Study[]>;
  studyGet(id: string): Promise<StudyDetail>;
  studyCreate(input: CreateStudy): Promise<StudyDetail>;
  studyUpdate(input: UpdateStudy): Promise<Study>;
  studySectionList(studyId: string): Promise<StudySection[]>;
  studySectionUpdate(input: UpdateStudySection): Promise<StudySection>;
  studyBlockCreate(input: CreateStudyBlock): Promise<StudyBlock>;
  studyBlockUpdate(input: UpdateStudyBlock): Promise<StudyBlock>;
  studyBlockDelete(id: string): Promise<void>;
  settingsGet(): Promise<AppSettings>;
  settingsUpdate(input: UpdateSettings): Promise<AppSettings>;
}

/** An error with a message that is safe to show to the user. */
export class ApiError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
  }
}

const GENERIC_MESSAGE = "Something unexpected went wrong. Details are in the log file.";

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return new ApiError(error.kind as ErrorKind, error.message);
  }
  return new ApiError("unexpected", GENERIC_MESSAGE);
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toApiError(error);
  }
}

export const tauriApi: Api = {
  appInfo: () => call("app_info"),
  logError: (message) => call("app_log_error", { message }),
  workspaceGetDefault: () => call("workspace_get_default"),
  projectList: (workspaceId) => call("project_list", { workspaceId }),
  projectGet: (id) => call("project_get", { id }),
  projectCreate: (input) => call("project_create", { input }),
  projectUpdate: (input) => call("project_update", { input }),
  studyList: (projectId) => call("study_list", { projectId }),
  studyGet: (id) => call("study_get", { id }),
  studyCreate: (input) => call("study_create", { input }),
  studyUpdate: (input) => call("study_update", { input }),
  studySectionList: (studyId) => call("study_section_list", { studyId }),
  studySectionUpdate: (input) => call("study_section_update", { input }),
  studyBlockCreate: (input) => call("study_block_create", { input }),
  studyBlockUpdate: (input) => call("study_block_update", { input }),
  studyBlockDelete: (id) => call("study_block_delete", { id }),
  settingsGet: () => call("settings_get"),
  settingsUpdate: (input) => call("settings_update", { input }),
};
