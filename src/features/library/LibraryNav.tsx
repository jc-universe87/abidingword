import { createContext, useContext, type ReactNode } from "react";
import type { ScriptureRef } from "@/types/scripture";
import type { ReaderPosition } from "./SourceReader";

/** Opening library screens from anywhere (Sources pane, findings, search). */
export interface LibraryNav {
  openLibrary: (query?: string) => void;
  /** Opens a source, at an exact segment when given. */
  openSource: (sourceId: string, segmentId?: string) => void;
  addSource: () => void;
  /**
   * Shows a passage in the Scripture pane (a reference read in a source). Navigation
   * only: no Study changes. From the full reader, the source moves to the Sources
   * pane at `position`, beside Scripture.
   */
  openInBible: (reference: ScriptureRef, position?: ReaderPosition) => void;
}

const LibraryNavContext = createContext<LibraryNav | null>(null);

export function LibraryNavProvider({ value, children }: { value: LibraryNav; children: ReactNode }) {
  return <LibraryNavContext.Provider value={value}>{children}</LibraryNavContext.Provider>;
}

export function useLibraryNav(): LibraryNav {
  const value = useContext(LibraryNavContext);
  if (!value) throw new Error("useLibraryNav must be used inside <LibraryNavProvider>");
  return value;
}
