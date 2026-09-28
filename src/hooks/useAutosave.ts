import { useCallback, useEffect, useRef } from "react";
import { useSaveTracker } from "./SaveTracker";

export const AUTOSAVE_DELAY_MS = 500;

/**
 * Debounced saving for a text field.
 *
 * `schedule(value)` saves after a short pause in typing; `flush()` saves at
 * once (call it on blur). Pending text is saved when the field unmounts.
 * Saves for one field run strictly in order, so an older value can never
 * overwrite a newer one.
 */
export function useAutosave(
  save: (value: string) => Promise<unknown>,
  delay = AUTOSAVE_DELAY_MS,
) {
  // Only the stable `track` function, so `flush` never changes identity.
  const { track } = useSaveTracker();
  const saveRef = useRef(save);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const value = pending.current;
    if (value === null) return;
    pending.current = null;
    const run = chain.current.catch(() => undefined).then(() => saveRef.current(value));
    chain.current = run;
    track(run);
  }, [track]);

  const schedule = useCallback(
    (value: string) => {
      pending.current = value;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [flush, delay],
  );

  useEffect(() => flush, [flush]);

  return { schedule, flush };
}
