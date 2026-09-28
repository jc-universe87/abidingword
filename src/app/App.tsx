import { useCallback } from "react";
import type { Api } from "@/lib/api";
import { ApiProvider, useApi } from "@/lib/ApiContext";
import { useLoad } from "@/hooks/useLoad";
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
      const [workspace, settings] = await Promise.all([api.workspaceGetDefault(), api.settingsGet()]);
      return { workspace, settings };
    }, [api]),
  );

  if (loaded.error) return <StartupScreen message={loaded.error.message} logDirectory={info.logDirectory} />;
  if (!loaded.data) return <StartupScreen />;
  return (
    <ThemeProvider initial={loaded.data.settings.theme}>
      <Shell info={info} workspace={loaded.data.workspace} />
    </ThemeProvider>
  );
}
