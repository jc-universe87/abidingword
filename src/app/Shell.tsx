import { useMemo, useState } from "react";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { useTranslation } from "react-i18next";
import { AddBibleView } from "@/features/scripture/AddBibleView";
import { ScripturePane } from "@/features/scripture/ScripturePane";
import { AddSourceView } from "@/features/library/AddSourceView";
import { LibraryNavProvider, type LibraryNav, type QuotedWords } from "@/features/library/LibraryNav";
import { LibraryView } from "@/features/library/LibraryView";
import { SourceReader, type ReaderPosition } from "@/features/library/SourceReader";
import { SourcesPane, type PaneSource } from "@/features/library/SourcesPane";
import { UpdateNotice } from "@/features/updates/UpdateNotice";
import { Sheet } from "@/design-system/Sheet";
import { SettingsView } from "@/features/settings/SettingsView";
import { TeachingTemplateEditor } from "@/features/settings/TeachingTemplateEditor";
import { TemplateEditor } from "@/features/settings/TemplateEditor";
import { StudyPane } from "@/features/studies/StudyPane";
import { AppBar } from "@/layouts/AppBar";
import { NARROW_WIDTH, useWorkspaceLayout } from "@/layouts/layoutPrefs";
import { WorkspaceLayout } from "@/layouts/WorkspaceLayout";
import type { AppInfo, Workspace } from "@/types/domain";

type View = "workspace" | "settings" | "library" | "source" | "addSource";
/** Tasks that open over the current page, which stays as it was behind them. */
type Overlay = { kind: "addBible" } | { kind: "template"; templateId: string | null } | { kind: "teachingTemplate"; templateId: string | null } | null;

export function Shell({ info, workspace }: { info: AppInfo; workspace: Workspace }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("workspace");
  const [returnTo, setReturnTo] = useState<View>("workspace");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [templatesVersion, setTemplatesVersion] = useState(0);
  const [teachingTemplatesVersion, setTeachingTemplatesVersion] = useState(0);
  const [studySearch, setStudySearch] = useState<string | null>(null);
  // Each request to open the library (id) remembers its latest search.
  const [library, setLibrary] = useState<{ id: number; query?: string }>({ id: 0 });
  // The full-width reader, and where its Back returns to.
  const [reading, setReading] = useState<{ sourceId: string; segmentId?: string; from: View; position?: ReaderPosition; words?: QuotedWords } | null>(null);
  // A source read inside the Sources pane. Kept here, not in the pane, so it
  // is still open after a visit to the full reader, Settings or the Library.
  const [paneSource, setPaneSource] = useState<PaneSource | null>(null);
  const layout = useWorkspaceLayout();
  const { goTo } = useScripture();
  const { open, setOpen } = layout;

  const addBible = () => setOverlay({ kind: "addBible" });
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
      openSource: (sourceId, segmentId, position, words) => {
        if (view === "workspace" && (open.sources || window.innerWidth >= NARROW_WIDTH)) {
          if (!open.sources) setOpen("sources", true);
          const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setPaneSource((current) => ({ sourceId, segmentId, position, words, opener, key: (current?.key ?? 0) + 1 }));
          return;
        }
        const from = view === "addSource" ? "library" : view === "source" ? (reading?.from ?? "workspace") : view;
        setReading({ sourceId, segmentId, from, position, words });
        setView("source");
      },
      addSource: () => {
        setReturnTo(view);
        setView("addSource");
      },
      // A reference read in a source: Scripture goes there; nothing about a Study changes.
      // From the full reader the source moves into the Sources pane, at the same place, beside Scripture.
      openInBible: (reference, position) => {
        goTo(reference);
        if (!open.scripture) setOpen("scripture", true);
        if (view === "source" && reading) {
          if (!open.sources) setOpen("sources", true);
          setPaneSource((current) => ({ sourceId: reading.sourceId, segmentId: reading.segmentId, position, opener: null, key: (current?.key ?? 0) + 1 }));
          setView("workspace");
        }
      },
    }),
    [view, reading, open.sources, open.scripture, setOpen, goTo],
  );

  return (
    <LibraryNavProvider value={libraryNav}>
    {/* Pinned to the window, not sized from 100vh: it fills the window at any size or display scale. */}
    <div data-testid="app-shell" className="fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-bg text-text">
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
      <UpdateNotice />
      {view === "settings" && (
        <SettingsView
          info={info}
          onClose={() => setView("workspace")}
          onResetLayout={layout.reset}
          onAddBible={addBible}
          onEditTemplate={(templateId) => setOverlay({ kind: "template", templateId })}
          templatesVersion={templatesVersion}
          onEditTeachingTemplate={(templateId) => setOverlay({ kind: "teachingTemplate", templateId })}
          teachingTemplatesVersion={teachingTemplatesVersion}
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
          initialPosition={reading.position}
          quotedWords={reading.words}
          onClose={(position) => {
            // Back to the workspace: the pane continues where this reader was.
            if (reading.from === "workspace") {
              setPaneSource((current) =>
                current?.sourceId === reading.sourceId ? { ...current, position, key: current.key + 1 } : current,
              );
            }
            setView(reading.from);
          }}
        />
      )}
      {overlay?.kind === "addBible" && (
        <Sheet labelledBy="add-bible-title">
          <AddBibleView onClose={() => setOverlay(null)} />
        </Sheet>
      )}
      {overlay?.kind === "template" && (
        <Sheet labelledBy="template-editor-title">
          <TemplateEditor
            templateId={overlay.templateId}
            onClose={() => {
              setOverlay(null);
              setTemplatesVersion((v) => v + 1);
            }}
          />
        </Sheet>
      )}
      {overlay?.kind === "teachingTemplate" && (
        <Sheet labelledBy="teaching-template-editor-title">
          <TeachingTemplateEditor
            templateId={overlay.templateId}
            onClose={() => {
              setOverlay(null);
              setTeachingTemplatesVersion((v) => v + 1);
            }}
          />
        </Sheet>
      )}
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
              onExpandReader={(position) => {
                if (!paneSource) return;
                setReading({ sourceId: paneSource.sourceId, segmentId: paneSource.segmentId, from: "workspace", position });
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
