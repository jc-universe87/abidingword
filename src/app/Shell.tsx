import { useState } from "react";
import { SourcesPane } from "@/features/library/SourcesPane";
import { ScripturePane } from "@/features/scripture/ScripturePane";
import { SettingsView } from "@/features/settings/SettingsView";
import { StudyPane } from "@/features/studies/StudyPane";
import { AppBar } from "@/layouts/AppBar";
import { WorkspaceLayout } from "@/layouts/WorkspaceLayout";
import { readLocal, writeLocal } from "@/lib/storage";
import type { AppInfo, Workspace } from "@/types/domain";

export function Shell({ info, workspace }: { info: AppInfo; workspace: Workspace }) {
  const [view, setView] = useState<"workspace" | "settings">("workspace");
  const [scriptureOpen, setScriptureOpen] = useState(() => readLocal("layout.scriptureOpen", true));
  const [sourcesOpen, setSourcesOpen] = useState(() => readLocal("layout.sourcesOpen", true));

  const toggle = (key: string, value: boolean, set: (v: boolean) => void) => {
    set(!value);
    writeLocal(key, !value);
  };

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <a
        href="#pane-study"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-10 focus:rounded-aw focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
      >
        Skip to study
      </a>
      <AppBar
        view={view}
        scriptureOpen={scriptureOpen}
        sourcesOpen={sourcesOpen}
        onToggleScripture={() => toggle("layout.scriptureOpen", scriptureOpen, setScriptureOpen)}
        onToggleSources={() => toggle("layout.sourcesOpen", sourcesOpen, setSourcesOpen)}
        onOpenSettings={() => setView(view === "settings" ? "workspace" : "settings")}
      />
      {view === "settings" ? (
        <SettingsView info={info} onClose={() => setView("workspace")} />
      ) : (
        <WorkspaceLayout
          scriptureOpen={scriptureOpen}
          sourcesOpen={sourcesOpen}
          scripture={<ScripturePane />}
          study={<StudyPane workspace={workspace} />}
          sources={<SourcesPane />}
        />
      )}
    </div>
  );
}
