import { useState, type FormEvent } from "react";
import { PanelLeft, PanelRight, Search, Settings } from "lucide-react";
import { BrandLockup } from "@/design-system/BrandLockup";
import { useScripture } from "@/features/scripture/ScriptureContext";

interface AppBarProps {
  view: "workspace" | "settings";
  scriptureOpen: boolean;
  sourcesOpen: boolean;
  onToggleScripture: () => void;
  onToggleSources: () => void;
  onOpenSettings: () => void;
  /** Called when a search starts, so the Scripture pane can be shown. */
  onSearch: () => void;
}

const iconButton =
  "inline-flex size-10 items-center justify-center rounded-aw text-text-strong hover:bg-bg-secondary " +
  "aria-pressed:bg-bg-secondary disabled:opacity-50";

export function AppBar(props: AppBarProps) {
  const inWorkspace = props.view === "workspace";
  const { translation, runSearch } = useScripture();
  const [query, setQuery] = useState("");
  const canSearch = inWorkspace && !!translation;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    props.onSearch();
    void runSearch({ query, currentOnly: true, book: "" });
  };
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-bg px-4">
      {/* The lockup's own clearspace provides the left margin. */}
      <div className="-ml-4 flex items-center">
        <BrandLockup height={44} />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <form role="search" onSubmit={submit} className="relative mr-2 hidden items-center md:flex">
          <label htmlFor="app-search" className="sr-only">Search Scripture</label>
          <Search className="pointer-events-none absolute left-3 size-4 text-text-muted" aria-hidden="true" />
          <input
            id="app-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!canSearch}
            placeholder={translation ? "Search Scripture" : "Search needs a Bible added"}
            className="h-10 w-72 rounded-aw border border-border bg-bg-secondary pl-9 pr-3 text-[0.9375rem] text-text placeholder:text-text-muted disabled:cursor-not-allowed disabled:border-border-subtle"
          />
        </form>
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
