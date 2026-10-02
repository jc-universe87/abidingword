import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApi } from "@/lib/ApiContext";
import type { AvailableUpdate, UpdateProgress, Updater } from "@/lib/updater";

import { STARTUP_CHECK_DELAY_MS } from "./timing";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "installing"; update: AvailableUpdate; progress: UpdateProgress | null }
  | { kind: "failed"; step: "check" | "install"; update?: AvailableUpdate };

interface Updates {
  /** False in builds without an updater: nothing is offered and nothing is checked. */
  enabled: boolean;
  version: string;
  state: UpdateState;
  /** True once the user chose Later for this version. */
  dismissed: boolean;
  check: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

const UpdatesContext = createContext<Updates | null>(null);

export function useUpdates(): Updates {
  const updates = useContext(UpdatesContext);
  if (!updates) throw new Error("useUpdates must be used inside <UpdatesProvider>");
  return updates;
}

interface ProviderProps {
  updater: Updater;
  enabled: boolean;
  /** The running version. */
  version: string;
  children: ReactNode;
}

/**
 * Looks for an update once, a little after startup, and on request. A failed
 * automatic check is invisible (the app works the same offline); a failed
 * manual check or installation is reported.
 */
export function UpdatesProvider({ updater, enabled, version, children }: ProviderProps) {
  const api = useApi();
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const busy = useRef(false);

  const note = useCallback(
    (what: string, error: unknown) =>
      // Details go to the log file only; the interface shows its own wording.
      void api.logError(`${what}: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined),
    [api],
  );

  const check = useCallback(
    async (automatic = false) => {
      if (!enabled || busy.current) return;
      busy.current = true;
      if (!automatic) setState({ kind: "checking" });
      try {
        const update = await updater.check();
        setState(update ? { kind: "available", update } : automatic ? { kind: "idle" } : { kind: "upToDate" });
      } catch (error) {
        note("Update check failed", error);
        setState(automatic ? { kind: "idle" } : { kind: "failed", step: "check" });
      } finally {
        busy.current = false;
      }
    },
    [enabled, updater, note],
  );

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void check(true), STARTUP_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, check]);

  const install = useCallback(async () => {
    if (!enabled || busy.current || (state.kind !== "available" && !(state.kind === "failed" && state.update))) return;
    const update = state.kind === "available" ? state.update : state.update!;
    busy.current = true;
    setState({ kind: "installing", update, progress: null });
    try {
      await updater.install((progress) => setState({ kind: "installing", update, progress }));
      // On Windows the installer ends the app before this point is reached.
    } catch (error) {
      note("Update installation failed", error);
      setState({ kind: "failed", step: "install", update });
    } finally {
      busy.current = false;
    }
  }, [enabled, state, updater, note]);

  const value = useMemo<Updates>(
    () => ({
      enabled,
      version,
      state,
      dismissed: state.kind === "available" && dismissedVersion === state.update.version,
      check: () => check(false),
      install,
      dismiss: () => state.kind === "available" && setDismissedVersion(state.update.version),
    }),
    [enabled, version, state, dismissedVersion, check, install],
  );
  return <UpdatesContext.Provider value={value}>{children}</UpdatesContext.Provider>;
}
