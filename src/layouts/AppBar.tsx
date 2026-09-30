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
  /** Called when a Scripture search starts, so the Scripture pane can be shown. */
  onSearch: () => void;
  onSearchStudies: (query: string) => void;
}

const iconButton =
  "inline-flex size-10 items-center justify-center rounded-aw text-text-strong hover:bg-bg-secondary " +
  "aria-pressed:bg-bg-secondary disabled:opacity-50";

export function AppBar(props: AppBarProps) {
  const inWorkspace = props.view === "workspace";
  const { translation, runSearch } = useScripture();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"scripture" | "studies">("scripture");
  const canSearch = inWorkspace && (scope === "studies" || !!translation);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    if (scope === "studies") return props.onSearchStudies(query.trim());
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
        <form role="search" onSubmit={submit} className="mr-2 hidden items-center gap-1 md:flex">
          <label htmlFor="app-search-scope" className="sr-only">Search in</label>
          <select
            id="app-search-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as "scripture" | "studies")}
            disabled={!inWorkspace}
            className="h-10 rounded-aw border border-border bg-bg-secondary px-2 text-[0.9375rem] text-text-strong"
          >
            <option value="scripture">Scripture</option>
            <option value="studies">Studies</option>
          </select>
          <span className="relative flex items-center">
            <label htmlFor="app-search" className="sr-only">{scope === "studies" ? "Search studies" : "Search Scripture"}</label>
            <Search className="pointer-events-none absolute left-3 size-4 text-text-muted" aria-hidden="true" />
            <input
              id="app-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!canSearch}
              placeholder={
                scope === "studies" ? "Search your studies" : translation ? "Search Scripture" : "Add a Bible first"
              }
              className="h-10 w-60 rounded-aw border border-border bg-bg-secondary pl-9 pr-3 text-[0.9375rem] text-text placeholder:text-text-muted disabled:cursor-not-allowed disabled:border-border-subtle"
            />
          </span>
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
