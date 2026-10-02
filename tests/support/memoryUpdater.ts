import type { AvailableUpdate, UpdateProgress, Updater } from "@/lib/updater";

export interface MemoryUpdater extends Updater {
  checks: number;
  installs: number;
  /** What the next checks find (null = up to date). */
  available: AvailableUpdate | null;
  checkError: Error | null;
  installError: Error | null;
  /** Progress events the next install reports. */
  progress: UpdateProgress[];
}

/** A fake updater for tests: no plugin, no network. */
export function createMemoryUpdater(fields: Partial<Pick<MemoryUpdater, "available" | "checkError" | "installError" | "progress">> = {}): MemoryUpdater {
  const updater: MemoryUpdater = {
    checks: 0,
    installs: 0,
    available: null,
    checkError: null,
    installError: null,
    progress: [],
    ...fields,
    async check() {
      updater.checks += 1;
      if (updater.checkError) throw updater.checkError;
      return updater.available;
    },
    async install(onProgress) {
      updater.installs += 1;
      for (const p of updater.progress) onProgress(p);
      if (updater.installError) throw updater.installError;
    },
  };
  return updater;
}
