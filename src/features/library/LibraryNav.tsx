import { createContext, useContext, type ReactNode } from "react";
import type { ScriptureRef } from "@/types/scripture";
import type { CitationPlace } from "@/types/library";
import type { ReaderPosition } from "./SourceReader";

/** Cited words to show marked when a source opens (both ends in the stored text). */
export type QuotedWords = NonNullable<CitationPlace["words"]>;

/** Opening library screens from anywhere (Sources pane, findings, search). */
export interface LibraryNav {
  openLibrary: (query?: string) => void;
  /**
   * Opens a source, at an exact segment when given, or at a view and page (a mark on an Original PDF
   * page). With `words` (v0.15: a citation found exactly), those words are shown marked there.
   */
  openSource: (sourceId: string, segmentId?: string, position?: ReaderPosition, words?: QuotedWords) => void;
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
