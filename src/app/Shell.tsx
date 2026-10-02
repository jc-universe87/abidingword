import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddBibleView } from "@/features/scripture/AddBibleView";
import { ScripturePane } from "@/features/scripture/ScripturePane";
import { AddSourceView } from "@/features/library/AddSourceView";
import { LibraryNavProvider, type LibraryNav } from "@/features/library/LibraryNav";
import { LibraryView } from "@/features/library/LibraryView";
import { SourceReader } from "@/features/library/SourceReader";
import { SourcesPane, type PaneSource } from "@/features/library/SourcesPane";
import { SettingsView } from "@/features/settings/SettingsView";
import { TemplateEditor } from "@/features/settings/TemplateEditor";
import { StudyPane } from "@/features/studies/StudyPane";
import { AppBar } from "@/layouts/AppBar";
import { NARROW_WIDTH, useWorkspaceLayout } from "@/layouts/layoutPrefs";
import { WorkspaceLayout } from "@/layouts/WorkspaceLayout";
import type { AppInfo, Workspace } from "@/types/domain";

type View = "workspace" | "settings" | "addBible" | "template" | "library" | "source" | "addSource";

export function Shell({ info, workspace }: { info: AppInfo; workspace: Workspace }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("workspace");
  const [returnTo, setReturnTo] = useState<View>("workspace");
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [studySearch, setStudySearch] = useState<string | null>(null);
  // Each request to open the library (id) remembers its latest search.
  const [library, setLibrary] = useState<{ id: number; query?: string }>({ id: 0 });
  // The full-width reader, and where its Back returns to.
  const [reading, setReading] = useState<{ sourceId: string; segmentId?: string; from: View } | null>(null);
  // A source read inside the Sources pane. Kept here, not in the pane, so it
  // is still open after a visit to the full reader, Settings or the Library.
  const [paneSource, setPaneSource] = useState<PaneSource | null>(null);
  const layout = useWorkspaceLayout();
  const { open, setOpen } = layout;

  const addBible = () => {
    setReturnTo(view);
    setView("addBible");
  };
  const revealScripture = () => {
    if (!open.scripture) setOpen("scripture", true);
  };
  const sideOf = (pane: "scripture" | "sources") =>
    layout.order.indexOf(pane) < layout.order.indexOf("study") ? "left" : "right";
  const libraryNav = useMemo<LibraryNav>(
    () => ({
      openLibrary: (query) => {
        setLibrary((current) => ({ id: current.id + 1, query }));
        setView("library");
      },
      // From the workspace a source opens in the Sources pane, beside
      // Scripture and the Study. On a narrow window with that pane hidden,
      // and from every other screen, it opens in the full-width reader,
      // whose Back returns to where it was opened from (after adding a
      // source: the library).
      openSource: (sourceId, segmentId) => {
        if (view === "workspace" && (open.sources || window.innerWidth >= NARROW_WIDTH)) {
          if (!open.sources) setOpen("sources", true);
          const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setPaneSource((current) => ({ sourceId, segmentId, opener, key: (current?.key ?? 0) + 1 }));
          return;
        }
        const from = view === "addSource" ? "library" : view === "source" ? (reading?.from ?? "workspace") : view;
        setReading({ sourceId, segmentId, from });
        setView("source");
      },
      addSource: () => {
        setReturnTo(view);
        setView("addSource");
      },
    }),
    [view, reading?.from, open.sources, setOpen],
  );

  return (
    <LibraryNavProvider value={libraryNav}>
    <div className="flex h-screen flex-col bg-bg text-text">
      <a
        href="#pane-study"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-10 focus:rounded-aw focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
      >
        {t("app.skipToStudy")}
      </a>
      <AppBar
        view={
          view === "workspace"
            ? "workspace"
            : view === "library" || view === "source" || view === "addSource"
              ? "library"
              : "settings"
        }
        scriptureOpen={open.scripture}
        sourcesOpen={open.sources}
        scriptureSide={sideOf("scripture")}
        sourcesSide={sideOf("sources")}
        onToggleScripture={() => setOpen("scripture", !open.scripture)}
        onToggleSources={() => setOpen("sources", !open.sources)}
        onOpenSettings={() => setView(view === "settings" ? "workspace" : "settings")}
        onSearch={revealScripture}
        onSearchStudies={setStudySearch}
        onSearchLibrary={libraryNav.openLibrary}
      />
      {view === "settings" && (
        <SettingsView
          info={info}
          onClose={() => setView("workspace")}
          onResetLayout={layout.reset}
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
          onRemoved={(sourceId) => setPaneSource((current) => (current?.sourceId === sourceId ? null : current))}
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
          layout={layout}
          scripture={<ScripturePane onAddBible={addBible} />}
          study={
            <StudyPane
              workspace={workspace}
              onRevealScripture={revealScripture}
              search={studySearch}
              onCloseSearch={() => setStudySearch(null)}
            />
          }
          sources={
            <SourcesPane
              reading={paneSource}
              onCloseReader={() => setPaneSource(null)}
              onExpandReader={() => {
                if (!paneSource) return;
                setReading({ sourceId: paneSource.sourceId, segmentId: paneSource.segmentId, from: "workspace" });
                setView("source");
              }}
            />
          }
        />
      )}
    </div>
    </LibraryNavProvider>
  );
}
