import { useCallback, useEffect, useState } from "react";
import { ApiError, toApiError } from "@/lib/api";

interface LoadState<T> {
  source: unknown;
  data?: T;
  error?: ApiError;
}

export interface Loaded<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  /** Loads again, keeping the current data visible until the new data arrives. */
  reload: () => void;
  /** Replaces the data locally, e.g. after a successful save. */
  setData: (data: T) => void;
}

/**
 * Runs `load` and tracks its result. `load` must be stable (wrap it in
 * useCallback); a new function starts a fresh load.
 */
export function useLoad<T>(load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<LoadState<T>>({ source: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    load().then(
      (data) => active && setState({ source: load, data }),
      (error: unknown) => active && setState({ source: load, error: toApiError(error) }),
    );
    return () => {
      active = false;
    };
  }, [load, version]);

  const current = state.source === load;
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const setData = useCallback((data: T) => setState({ source: load, data }), [load]);

  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: !current,
    reload,
    setData,
  };
}
