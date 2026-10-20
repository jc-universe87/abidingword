import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { PanelLeft, PanelRight, Search, Settings } from "lucide-react";
import { BrandLockup } from "@/design-system/BrandLockup";
import { useScripture } from "@/features/scripture/ScriptureContext";

interface AppBarProps {
  view: "workspace" | "library" | "settings";
  scriptureOpen: boolean;
  sourcesOpen: boolean;
  /** Which side of the Study pane each side pane is on, for the toggle icons. */
  scriptureSide: "left" | "right";
  sourcesSide: "left" | "right";
  onToggleScripture: () => void;
  onToggleSources: () => void;
  onOpenSettings: () => void;
  /** Called when a Scripture search starts, so the Scripture pane can be shown. */
  onSearch: () => void;
  onSearchStudies: (query: string) => void;
  onSearchLibrary: (query: string) => void;
}

const iconButton =
  "inline-flex size-10 items-center justify-center rounded-aw text-text-strong hover:bg-hover " +
  "aria-pressed:bg-selected aria-pressed:shadow-[inset_0_-2px_0_var(--aw-text-strong)] disabled:opacity-50";

type Scope = "scripture" | "studies" | "library";

export function AppBar(props: AppBarProps) {
  const { t } = useTranslation();
  const inWorkspace = props.view === "workspace";
  const { translation, runSearch } = useScripture();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("scripture");
  // Library search also works from the Library screen itself.
  const scopeEnabled = inWorkspace || props.view === "library";
  const canSearch =
    scope === "library" ? scopeEnabled : inWorkspace && (scope === "studies" || !!translation);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    if (scope === "studies") return props.onSearchStudies(query.trim());
    if (scope === "library") return props.onSearchLibrary(query.trim());
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
          <label htmlFor="app-search-scope" className="sr-only">{t("app.search.scopeLabel")}</label>
          <select
            id="app-search-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            disabled={!scopeEnabled}
            className="h-10 aw-input px-2 text-[0.9375rem] text-text-strong"
          >
            <option value="scripture">{t("app.search.scope.scripture")}</option>
            <option value="studies">{t("app.search.scope.studies")}</option>
            <option value="library">{t("app.search.scope.library")}</option>
          </select>
          <span className="relative flex items-center">
            <label htmlFor="app-search" className="sr-only">{t(`app.search.label.${scope}`)}</label>
            <Search className="pointer-events-none absolute left-3 size-4 text-text-muted" aria-hidden="true" />
            <input
              id="app-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!canSearch}
              placeholder={
                scope === "scripture" && !translation
                  ? t("app.search.placeholder.noBible")
                  : t(`app.search.placeholder.${scope}`)
              }
              className="h-10 w-60 aw-input pl-9 pr-3 text-[0.9375rem] text-text placeholder:text-text-muted disabled:cursor-not-allowed disabled:border-border-subtle"
            />
          </span>
        </form>
        <button
          type="button"
          className={iconButton}
          aria-pressed={props.scriptureOpen}
          aria-label={t("app.toolbar.showScripture")}
          title={t("app.toolbar.showScripture")}
          disabled={!inWorkspace}
          onClick={props.onToggleScripture}
        >
          <SideIcon side={props.scriptureSide} />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-pressed={props.sourcesOpen}
          aria-label={t("app.toolbar.showSources")}
          title={t("app.toolbar.showSources")}
          disabled={!inWorkspace}
          onClick={props.onToggleSources}
        >
          <SideIcon side={props.sourcesSide} />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-pressed={props.view === "settings"}
          aria-label={t("app.toolbar.settings")}
          title={t("app.toolbar.settings")}
          onClick={props.onOpenSettings}
        >
          <Settings className="size-5" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function SideIcon({ side }: { side: "left" | "right" }) {
  const Icon = side === "left" ? PanelLeft : PanelRight;
  return <Icon className="size-5" aria-hidden="true" />;
}
