import { createContext, useContext, type ReactNode } from "react";

/** Opening library screens from anywhere (Sources pane, findings, search). */
export interface LibraryNav {
  openLibrary: (query?: string) => void;
  /** Opens a source, at an exact segment when given. */
  openSource: (sourceId: string, segmentId?: string) => void;
  addSource: () => void;
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
