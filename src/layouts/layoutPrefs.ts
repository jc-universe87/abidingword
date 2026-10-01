// Workspace layout preferences: pane order, widths and visibility.
// These belong to this device's interface (browser storage of the webview),
// not to the user's data folder, so changing the data folder keeps them and
// resetting them never touches studies or the library.
import { useCallback, useState } from "react";
import { readLocal, writeLocal } from "@/lib/storage";

export type PaneId = "scripture" | "study" | "sources";
export type SidePaneId = Exclude<PaneId, "study">;

export const DEFAULT_ORDER: PaneId[] = ["scripture", "study", "sources"];
export const DEFAULT_WIDTHS: Record<SidePaneId, number> = { scripture: 300, sources: 320 };

/** Below this window width the Sources pane starts hidden (it can be shown). */
export const NARROW_WIDTH = 1100;

export const KEYS = {
  order: "layout.order",
  scriptureOpen: "layout.scriptureOpen",
  sourcesOpen: "layout.sourcesOpen",
  scriptureWidth: "layout.scriptureWidth",
  sourcesWidth: "layout.sourcesWidth",
} as const;

export const widthKey = (pane: SidePaneId) => (pane === "scripture" ? KEYS.scriptureWidth : KEYS.sourcesWidth);
export const openKey = (pane: SidePaneId) => (pane === "scripture" ? KEYS.scriptureOpen : KEYS.sourcesOpen);

/** The saved order, or the default if what is stored is not a valid order. */
export function readOrder(): PaneId[] {
  const stored = readLocal<unknown>(KEYS.order, null);
  const valid =
    Array.isArray(stored) &&
    stored.length === DEFAULT_ORDER.length &&
    DEFAULT_ORDER.every((pane) => stored.includes(pane));
  return valid ? (stored as PaneId[]) : [...DEFAULT_ORDER];
}

export function readWidth(pane: SidePaneId): number {
  const stored = readLocal<unknown>(widthKey(pane), null);
  return typeof stored === "number" && Number.isFinite(stored) ? stored : DEFAULT_WIDTHS[pane];
}

/** Visibility before the user has chosen: Sources starts hidden on a narrow window. */
export function defaultOpen(pane: SidePaneId): boolean {
  return pane === "scripture" || window.innerWidth >= NARROW_WIDTH;
}

export function readOpen(pane: SidePaneId): boolean {
  return readLocal(openKey(pane), defaultOpen(pane));
}

/** Forgets every layout preference; the next layout uses the defaults. */
export function resetLayoutPrefs(): void {
  for (const key of Object.values(KEYS)) writeLocal(key, null);
}

/**
 * The workspace layout as state: read once from storage, written back on
 * every change the user makes (never just because the app started).
 */
export function useWorkspaceLayout() {
  const [order, setOrderState] = useState(readOrder);
  const [widths, setWidths] = useState(() => ({ scripture: readWidth("scripture"), sources: readWidth("sources") }));
  const [open, setOpenState] = useState(() => ({ scripture: readOpen("scripture"), sources: readOpen("sources") }));

  const setOrder = useCallback((next: PaneId[]) => {
    setOrderState(next);
    writeLocal(KEYS.order, next);
  }, []);
  const setWidth = useCallback((pane: SidePaneId, width: number) => {
    setWidths((current) => ({ ...current, [pane]: width }));
    writeLocal(widthKey(pane), width);
  }, []);
  const setOpen = useCallback((pane: SidePaneId, value: boolean) => {
    setOpenState((current) => ({ ...current, [pane]: value }));
    writeLocal(openKey(pane), value);
  }, []);
  const reset = useCallback(() => {
    resetLayoutPrefs();
    setOrderState([...DEFAULT_ORDER]);
    setWidths({ ...DEFAULT_WIDTHS });
    setOpenState({ scripture: defaultOpen("scripture"), sources: defaultOpen("sources") });
  }, []);

  return { order, widths, open, setOrder, setWidth, setOpen, reset };
}

export type WorkspaceLayoutState = ReturnType<typeof useWorkspaceLayout>;
