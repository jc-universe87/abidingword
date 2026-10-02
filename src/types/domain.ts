// TypeScript mirror of the native domain types (src-tauri/src/domain/mod.rs).
// Keep both files in step when a field changes.
import type { StudyDetails, StudyStatus, StudyType } from "./studies";

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
  studyType: StudyType;
  status: StudyStatus;
  /** The study's purpose, in the user's words. */
  description: string | null;
  details: StudyDetails;
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
export const BLOCK_TYPES = ["paragraph", "note", "heading", "quotation", "question"] as const;
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
  | "conflict"
  | "invalidReference"
  | "importFailed"
  | "unsupportedFormat"
  | "duplicateTranslation"
  | "integrity"
  | "backup"
  | "unexpected";

export interface ErrorPayload {
  kind: ErrorKind;
  /** English; the interface shows `code` translated when it can (docs/i18n.md). */
  message: string;
  /** Stable message code, e.g. "library.passwordProtected". */
  code?: string;
  /** Values for the message, e.g. { fileName: "notes.pdf" }. */
  params?: Record<string, string>;
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
  studyType?: StudyType;
  templateId?: string;
  templateKey?: string;
  /** Canonical reference of the primary passage. */
  primaryPassage?: string;
  description?: string;
}

export interface UpdateStudy {
  id: string;
  title?: string;
  studyType?: StudyType;
  status?: StudyStatus;
  /** "" clears it. */
  description?: string;
  details?: StudyDetails;
}

export interface UpdateStudySection {
  id: string;
  title?: string;
  /** "" clears it. */
  guidance?: string;
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
