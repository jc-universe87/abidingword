import { useMemo, useState } from "react";
import { AddBibleView } from "@/features/scripture/AddBibleView";
import { ScripturePane } from "@/features/scripture/ScripturePane";
import { AddSourceView } from "@/features/library/AddSourceView";
import { LibraryNavProvider, type LibraryNav } from "@/features/library/LibraryNav";
import { LibraryView } from "@/features/library/LibraryView";
import { SourceReader } from "@/features/library/SourceReader";
import { SourcesPane } from "@/features/library/SourcesPane";
import { SettingsView } from "@/features/settings/SettingsView";
import { TemplateEditor } from "@/features/settings/TemplateEditor";
import { StudyPane } from "@/features/studies/StudyPane";
import { AppBar } from "@/layouts/AppBar";
import { WorkspaceLayout } from "@/layouts/WorkspaceLayout";
import { readLocal, writeLocal } from "@/lib/storage";
import type { AppInfo, Workspace } from "@/types/domain";

type View = "workspace" | "settings" | "addBible" | "template" | "library" | "source" | "addSource";

/** Below this window width the Sources pane starts hidden (it can be shown). */
const NARROW_WIDTH = 1100;

export function Shell({ info, workspace }: { info: AppInfo; workspace: Workspace }) {
  const [view, setView] = useState<View>("workspace");
  const [returnTo, setReturnTo] = useState<View>("workspace");
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [studySearch, setStudySearch] = useState<string | null>(null);
  // Each request to open the library (id) remembers its latest search.
  const [library, setLibrary] = useState<{ id: number; query?: string }>({ id: 0 });
  const [reading, setReading] = useState<{ sourceId: string; segmentId?: string; from: View } | null>(null);
  const [scriptureOpen, setScriptureOpen] = useState(() => readLocal("layout.scriptureOpen", true));
  const [sourcesOpen, setSourcesOpen] = useState(() =>
    readLocal("layout.sourcesOpen", window.innerWidth >= NARROW_WIDTH),
  );

  const setOpen = (key: string, value: boolean, set: (v: boolean) => void) => {
    set(value);
    writeLocal(key, value);
  };
  const addBible = () => {
    setReturnTo(view);
    setView("addBible");
  };
  const revealScripture = () => {
    if (!scriptureOpen) setOpen("layout.scriptureOpen", true, setScriptureOpen);
  };
  const libraryNav = useMemo<LibraryNav>(
    () => ({
      openLibrary: (query) => {
        setLibrary((current) => ({ id: current.id + 1, query }));
        setView("library");
      },
      // The reader's Back returns to where the source was opened from; after
      // adding a source it returns to the library.
      openSource: (sourceId, segmentId) => {
        const from = view === "addSource" ? "library" : view === "source" ? (reading?.from ?? "workspace") : view;
        setReading({ sourceId, segmentId, from });
        setView("source");
      },
      addSource: () => {
        setReturnTo(view);
        setView("addSource");
      },
    }),
    [view, reading?.from],
  );

  return (
    <LibraryNavProvider value={libraryNav}>
    <div className="flex h-screen flex-col bg-bg text-text">
      <a
        href="#pane-study"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-10 focus:rounded-aw focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
      >
        Skip to study
      </a>
      <AppBar
        view={
          view === "workspace"
            ? "workspace"
            : view === "library" || view === "source" || view === "addSource"
              ? "library"
              : "settings"
        }
        scriptureOpen={scriptureOpen}
        sourcesOpen={sourcesOpen}
        onToggleScripture={() => setOpen("layout.scriptureOpen", !scriptureOpen, setScriptureOpen)}
        onToggleSources={() => setOpen("layout.sourcesOpen", !sourcesOpen, setSourcesOpen)}
        onOpenSettings={() => setView(view === "settings" ? "workspace" : "settings")}
        onSearch={revealScripture}
        onSearchStudies={setStudySearch}
        onSearchLibrary={libraryNav.openLibrary}
      />
      {view === "settings" && (
        <SettingsView
          info={info}
          onClose={() => setView("workspace")}
          onAddBible={addBible}
          onEditTemplate={(templateId) => {
            setEditingTemplate(templateId);
            setView("template");
          }}
        />
      )}
      {view === "library" && (
        <LibraryView
          key={library.id}
          initialQuery={library.query}
          onSearched={(query) => setLibrary((current) => ({ ...current, query }))}
          onClose={() => setView("workspace")}
        />
      )}
      {view === "addSource" && <AddSourceView onClose={() => setView(returnTo)} />}
      {view === "source" && reading && (
        <SourceReader
          key={`${reading.sourceId}-${reading.segmentId ?? ""}`}
          sourceId={reading.sourceId}
          segmentId={reading.segmentId}
          onClose={() => setView(reading.from)}
        />
      )}
      {view === "addBible" && <AddBibleView onClose={() => setView(returnTo)} />}
      {view === "template" && <TemplateEditor templateId={editingTemplate} onClose={() => setView("settings")} />}
      {view === "workspace" && (
        <WorkspaceLayout
          scriptureOpen={scriptureOpen}
          sourcesOpen={sourcesOpen}
          scripture={<ScripturePane onAddBible={addBible} />}
          study={
            <StudyPane
              workspace={workspace}
              onRevealScripture={revealScripture}
              search={studySearch}
              onCloseSearch={() => setStudySearch(null)}
            />
          }
          sources={<SourcesPane />}
        />
      )}
    </div>
    </LibraryNavProvider>
  );
}
