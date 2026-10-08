import type { ScriptureRef } from "@/types/scripture";

/**
 * Where the Scripture pane has been, for Back and Forward (docs/scripture-links-v0.11.md).
 * Canonical passages only: a translation is how a place is read, not a place, so
 * changing it never makes an entry. Session state: nothing here is saved, and
 * nothing here is a Study's passage.
 */
export interface ScriptureHistory {
  back: ScriptureRef[];
  current: ScriptureRef;
  forward: ScriptureRef[];
}

/** Older places beyond this are forgotten, so a long session never grows without end. */
export const HISTORY_LIMIT = 100;

export function startHistory(current: ScriptureRef): ScriptureHistory {
  return { back: [], current, forward: [] };
}

/** Going somewhere new: the place left can be gone back to; Forward is cleared. Going where one already is changes nothing. */
export function visit(history: ScriptureHistory, to: ScriptureRef): ScriptureHistory {
  if (to.canonical === history.current.canonical) return { ...history, current: to };
  return { back: [...history.back, history.current].slice(-HISTORY_LIMIT), current: to, forward: [] };
}

export function canGoBack(history: ScriptureHistory): boolean {
  return history.back.length > 0;
}

export function canGoForward(history: ScriptureHistory): boolean {
  return history.forward.length > 0;
}

export function goBack(history: ScriptureHistory): ScriptureHistory {
  const previous = history.back.at(-1);
  if (!previous) return history;
  return { back: history.back.slice(0, -1), current: previous, forward: [history.current, ...history.forward] };
}

export function goForward(history: ScriptureHistory): ScriptureHistory {
  const [next, ...rest] = history.forward;
  if (!next) return history;
  return { back: [...history.back, history.current].slice(-HISTORY_LIMIT), current: next, forward: rest };
}
