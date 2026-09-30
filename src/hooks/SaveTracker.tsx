import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { toApiError } from "@/lib/api";

export type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; message: string };

interface SaveTrackerValue {
  status: SaveStatus;
  track: (save: Promise<unknown>) => void;
  /** Resolves once every save started so far has finished. */
  settled: () => Promise<void>;
}

const SaveTrackerContext = createContext<SaveTrackerValue | null>(null);

/** Collects the outcome of every save below it, for one status message. */
export function SaveTrackerProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });
  const inFlight = useRef(0);
  const failed = useRef<string | null>(null);
  const pending = useRef(new Set<Promise<unknown>>());

  const settled = useCallback(async () => {
    await Promise.allSettled([...pending.current]);
  }, []);

  const track = useCallback((save: Promise<unknown>) => {
    pending.current.add(save);
    const forget = () => pending.current.delete(save);
    save.then(forget, forget);
    inFlight.current += 1;
    setStatus({ state: "saving" });
    save.then(
      () => {
        inFlight.current -= 1;
        if (inFlight.current === 0) {
          const message = failed.current;
          failed.current = null;
          setStatus(message ? { state: "error", message } : { state: "saved" });
        }
      },
      (error: unknown) => {
        inFlight.current -= 1;
        failed.current = toApiError(error).message;
        if (inFlight.current === 0) {
          setStatus({ state: "error", message: failed.current });
          failed.current = null;
        }
      },
    );
  }, []);

  const value = useMemo(() => ({ status, track, settled }), [status, track, settled]);
  return <SaveTrackerContext.Provider value={value}>{children}</SaveTrackerContext.Provider>;
}

export function useSaveTracker(): SaveTrackerValue {
  const value = useContext(SaveTrackerContext);
  if (!value) throw new Error("useSaveTracker must be used inside <SaveTrackerProvider>");
  return value;
}
