// TypeScript mirror of the native domain types (src-tauri/src/domain/mod.rs).
// Keep both files in step when a field changes.

export interface Workspace {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface Project {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  studyCount: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface Study {
  id: string;
  projectId: string;
  templateId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface StudyDetail {
  study: Study;
  sections: StudySection[];
}

export interface StudySection {
  id: string;
  studyId: string;
  key: string | null;
  title: string;
  guidance: string | null;
  position: number;
  blocks: StudyBlock[];
  createdAt: string;
  updatedAt: string;
  revision: number;
}

/** Block types available in this version. Later: quotation, word_study, ... */
export const BLOCK_TYPES = ["paragraph", "note", "heading"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export interface StudyBlock {
  id: string;
  sectionId: string;
  blockType: BlockType;
  position: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export type Theme = "light" | "dark" | "system";

export interface AppSettings {
  theme: Theme;
  /** The translation the Scripture pane shows. */
  scriptureTranslationId: string | null;
  /** The active passage as a canonical reference, e.g. "JHN.15.1-JHN.15.11". */
  scripturePassage: string | null;
}

export type ErrorKind =
  | "database"
  | "filesystem"
  | "invalidInput"
  | "notFound"
  | "migration"
  | "invalidReference"
  | "importFailed"
  | "unsupportedFormat"
  | "duplicateTranslation"
  | "integrity"
  | "backup"
  | "unexpected";

export interface ErrorPayload {
  kind: ErrorKind;
  message: string;
}

export interface AppInfo {
  version: string;
  ready: boolean;
  error: ErrorPayload | null;
  dataDirectory: string | null;
  databasePath: string | null;
  logDirectory: string | null;
  schemaVersion: number | null;
}

// Command inputs

export interface CreateProject {
  workspaceId: string;
  title: string;
  description?: string;
}

export interface UpdateProject {
  id: string;
  title?: string;
  description?: string;
}

export interface CreateStudy {
  projectId: string;
  title: string;
  templateKey?: string;
}

export interface UpdateStudy {
  id: string;
  title?: string;
}

export interface UpdateStudySection {
  id: string;
  title?: string;
}

export interface CreateStudyBlock {
  sectionId: string;
  blockType: BlockType;
  content?: string;
}

export interface UpdateStudyBlock {
  id: string;
  content?: string;
}

export interface UpdateSettings {
  theme?: Theme;
  /** An empty string clears it. */
  scriptureTranslationId?: string;
  /** A canonical reference; an empty string clears it. */
  scripturePassage?: string;
}
