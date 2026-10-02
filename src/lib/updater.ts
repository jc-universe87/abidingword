/**
 * A thin adapter over the Tauri updater plugin, so the interface (and its
 * tests) never talk to the plugin or the network directly. Only builds made
 * by the test-update workflow carry an updater (docs/updates.md); the
 * interface asks `AppInfo.updatesEnabled` before using this at all.
 *
 * Updates are signed: the plugin refuses anything not signed by the key
 * whose public half is built into the app. Raw plugin messages are never
 * shown; callers show their own translated text.
 */

export interface AvailableUpdate {
  /** SemVer of the newer build, e.g. 0.5.0-dev.12. */
  version: string;
  notes: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  /** Null when the server did not say how large the download is. */
  total: number | null;
}

export interface Updater {
  /** The newer build, or null when this one is current. Rejects when it cannot check. */
  check(): Promise<AvailableUpdate | null>;
  /**
   * Downloads and installs the build found by the last `check()`. On Windows
   * the installer then closes the app and starts the new version.
   */
  install(onProgress: (progress: UpdateProgress) => void): Promise<void>;
}

/** Used when no updater is supplied: nothing is ever available. */
export const noUpdater: Updater = {
  check: async () => null,
  install: async () => undefined,
};

type PluginUpdate = NonNullable<Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>>;

/** The real updater. The plugin is loaded only when an update is asked for. */
export function createTauriUpdater(): Updater {
  let pending: PluginUpdate | null = null;
  return {
    async check() {
      const { check } = await import("@tauri-apps/plugin-updater");
      pending = await check({ timeout: 15_000 });
      return pending ? { version: pending.version, notes: pending.body ?? null } : null;
    },
    async install(onProgress) {
      if (!pending) throw new Error("No update has been found.");
      let downloaded = 0;
      let total: number | null = null;
      await pending.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? null;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        onProgress({ downloaded, total });
      });
    },
  };
}
