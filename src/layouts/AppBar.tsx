import { PanelLeft, PanelRight, Search, Settings } from "lucide-react";
import { Logomark } from "@/design-system/Logomark";

interface AppBarProps {
  view: "workspace" | "settings";
  scriptureOpen: boolean;
  sourcesOpen: boolean;
  onToggleScripture: () => void;
  onToggleSources: () => void;
  onOpenSettings: () => void;
}

const iconButton =
  "inline-flex size-10 items-center justify-center rounded-aw text-text-strong hover:bg-bg-secondary " +
  "aria-pressed:bg-bg-secondary disabled:opacity-50";

export function AppBar(props: AppBarProps) {
  const inWorkspace = props.view === "workspace";
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-bg px-4">
      <div className="flex items-center gap-3">
        <Logomark height={22} />
        <span className="font-display text-[1.3125rem] font-semibold text-text-strong">Abiding Word</span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <label className="relative mr-2 hidden items-center md:flex">
          <span className="sr-only">Search (available in a later version)</span>
          <Search className="pointer-events-none absolute left-3 size-4 text-text-muted" aria-hidden="true" />
          <input
            type="search"
            disabled
            placeholder="Search arrives in a later version"
            className="h-10 w-72 rounded-aw border border-border-subtle bg-bg-secondary pl-9 pr-3 text-[0.9375rem] text-text placeholder:text-text-muted disabled:cursor-not-allowed"
          />
        </label>
        <button
          type="button"
          className={iconButton}
          aria-pressed={props.scriptureOpen}
          aria-label="Show Scripture pane"
          title="Show Scripture pane"
          disabled={!inWorkspace}
          onClick={props.onToggleScripture}
        >
          <PanelLeft className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-pressed={props.sourcesOpen}
          aria-label="Show Sources pane"
          title="Show Sources pane"
          disabled={!inWorkspace}
          onClick={props.onToggleSources}
        >
          <PanelRight className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-pressed={!inWorkspace}
          aria-label="Settings"
          title="Settings"
          onClick={props.onOpenSettings}
        >
          <Settings className="size-5" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
