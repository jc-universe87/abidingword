// Moving work between computers (v0.19): mirrors src-tauri/src/portability.

export interface ProjectCounts {
  studies: number;
  teachings: number;
  presentations: number;
  notes: number;
  images: number;
}

/** Something a project refers to that is not in its package. */
export interface PackageExternal {
  id: string;
  name: string;
  contentHash?: string;
}

export interface PackageExternals {
  sources: PackageExternal[];
  presentationTemplates: PackageExternal[];
  bibles: PackageExternal[];
}

/** What this computer lacks of what a package refers to. */
export interface PackageMissing {
  sources: string[];
  presentationTemplates: string[];
  bibles: string[];
  images: number;
}

export interface ProjectExportReport {
  title: string;
  counts: ProjectCounts;
  external: PackageExternals;
  missingImages: number;
}

export interface ProjectPackagePreview {
  title: string;
  description: string | null;
  createdAt: string;
  appVersion: string;
  counts: ProjectCounts;
  /** The title it will have here ("John (2)" when "John" exists). */
  importTitle: string;
  missing: PackageMissing;
}

export interface ProjectImportReport {
  projectId: string;
  title: string;
  counts: ProjectCounts;
  missing: PackageMissing;
  /** Rows left out because what they belonged to is not in the file, or they could not be read. */
  leftOut: number;
  /** Citations kept whose library source is not on this computer. */
  citationsKept: number;
  /** Citations that point at exactly the same file here, under another id. */
  citationsReconnected: number;
}

export interface BackupCounts {
  projects: number;
  studies: number;
  teachings: number;
  sources: number;
  bibles: number;
  files: number;
}

export interface BackupReport {
  counts: BackupCounts;
  size: number;
}

export interface BackupPreview {
  createdAt: string;
  appVersion: string;
  counts: BackupCounts;
  size: number;
}

export interface RestoreReport {
  counts: BackupCounts;
  /** The copy of the database as it was just before restoring. */
  safetyCopy: string;
  filesAdded: number;
  filesSetAside: number;
}

/** The example project (v0.19). */
export interface SampleReport {
  projectId: string;
  title: string;
  /** False when it was already there and nothing was added. */
  added: boolean;
}
