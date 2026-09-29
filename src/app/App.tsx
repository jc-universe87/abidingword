import { useCallback } from "react";
import type { Api } from "@/lib/api";
import { ApiProvider, useApi } from "@/lib/ApiContext";
import { useLoad } from "@/hooks/useLoad";
import { ScriptureProvider } from "@/features/scripture/ScriptureContext";
import { ThemeProvider } from "@/features/settings/ThemeContext";
import type { AppInfo } from "@/types/domain";
import { ErrorBoundary } from "./ErrorBoundary";
import { Shell } from "./Shell";
import { StartupScreen } from "./StartupScreen";

export function App({ api }: { api: Api }) {
  return (
    <ApiProvider api={api}>
      <ErrorBoundary onError={(message) => void api.logError(message).catch(() => undefined)}>
        <Bootstrap />
      </ErrorBoundary>
    </ApiProvider>
  );
}

/** Checks that the native core started, then loads what the shell needs. */
function Bootstrap() {
  const api = useApi();
  const info = useLoad(useCallback(() => api.appInfo(), [api]));

  if (info.error) return <StartupScreen message={info.error.message} />;
  if (!info.data) return <StartupScreen />;
  if (!info.data.ready) {
    return (
      <StartupScreen
        message={info.data.error?.message ?? "Abiding Word could not start."}
        logDirectory={info.data.logDirectory}
      />
    );
  }
  return <Workspace info={info.data} />;
}

function Workspace({ info }: { info: AppInfo }) {
  const api = useApi();
  const loaded = useLoad(
    useCallback(async () => {
      const [workspace, settings, books, translations] = await Promise.all([
        api.workspaceGetDefault(),
        api.settingsGet(),
        api.scriptureBooks(),
        api.bibleList(),
      ]);
      return { workspace, settings, books, translations };
    }, [api]),
  );

  if (loaded.error) return <StartupScreen message={loaded.error.message} logDirectory={info.logDirectory} />;
  if (!loaded.data) return <StartupScreen />;
  return (
    <ThemeProvider initial={loaded.data.settings.theme}>
      <ScriptureProvider
        settings={loaded.data.settings}
        books={loaded.data.books}
        translations={loaded.data.translations}
      >
        <Shell info={info} workspace={loaded.data.workspace} />
      </ScriptureProvider>
    </ThemeProvider>
  );
}
