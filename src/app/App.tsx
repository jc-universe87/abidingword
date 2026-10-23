import { StudyFocusProvider } from "@/features/studies/StudyFocus";
import { ComparisonProvider } from "@/features/ai/Comparison";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { localizeError } from "@/i18n/messages";
import type { Api } from "@/lib/api";
import { noUpdater, type Updater } from "@/lib/updater";
import { PdfEngineProvider } from "@/features/library/PdfEngineContext";
import type { PdfEngine } from "@/lib/pdfEngine";
import { UpdatesProvider } from "@/features/updates/UpdatesContext";
import { ApiProvider, useApi } from "@/lib/ApiContext";
import { useLoad } from "@/hooks/useLoad";
import { ScriptureProvider } from "@/features/scripture/ScriptureContext";
import { ThemeProvider } from "@/features/settings/ThemeContext";
import type { AppInfo } from "@/types/domain";
import { ErrorBoundary } from "./ErrorBoundary";
import { Shell } from "./Shell";
import { StartupScreen } from "./StartupScreen";

export function App({ api, updater = noUpdater, pdfEngine }: { api: Api; updater?: Updater; pdfEngine?: PdfEngine }) {
  // Re-renders the whole interface when the language changes; nothing is
  // remounted, so the open study, passage and layout stay as they are.
  useTranslation();
  return (
    <ApiProvider api={api}>
      <ErrorBoundary onError={(message) => void api.logError(message).catch(() => undefined)}>
        <PdfEngineProvider engine={pdfEngine}>
          <Bootstrap updater={updater} />
        </PdfEngineProvider>
      </ErrorBoundary>
    </ApiProvider>
  );
}

/** Checks that the native core started, then loads what the shell needs. */
function Bootstrap({ updater }: { updater: Updater }) {
  const { t } = useTranslation();
  const api = useApi();
  const info = useLoad(useCallback(() => api.appInfo(), [api]));

  if (info.error) return <StartupScreen message={info.error.message} />;
  if (!info.data) return <StartupScreen />;
  if (!info.data.ready) {
    return (
      <StartupScreen
        message={
          info.data.error
            ? localizeError(info.data.error.kind, info.data.error.message, info.data.error.code, info.data.error.params)
            : t("app.startup.couldNotStart")
        }
        logDirectory={info.data.logDirectory}
      />
    );
  }
  return <Workspace info={info.data} updater={updater} />;
}

function Workspace({ info, updater }: { info: AppInfo; updater: Updater }) {
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
        <UpdatesProvider updater={updater} enabled={info.updatesEnabled} version={info.version}>
          <StudyFocusProvider>
            <ComparisonProvider>
              <Shell info={info} workspace={loaded.data.workspace} />
            </ComparisonProvider>
          </StudyFocusProvider>
        </UpdatesProvider>
      </ScriptureProvider>
    </ThemeProvider>
  );
}
