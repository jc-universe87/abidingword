import { useTranslation } from "react-i18next";
import { Logomark } from "@/design-system/Logomark";

interface StartupScreenProps {
  /** Present when startup failed. */
  message?: string;
  logDirectory?: string | null;
}

/** Shown while the workspace opens, or instead of it if startup failed. */
export function StartupScreen({ message, logDirectory }: StartupScreenProps) {
  const { t } = useTranslation();
  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center-safe gap-6 overflow-y-auto bg-bg px-8 text-center text-text">
      <Logomark height={56} />
      <p className="type-title m-0">{t("common.appName")}</p>
      {message ? (
        <div role="alert" className="flex max-w-[36rem] flex-col gap-3">
          <p className="m-0 text-[1.0625rem] text-danger">{message}</p>
          {logDirectory && (
            <p className="m-0 text-[0.9375rem] text-text-muted">
              {t("app.startup.logFiles")} <code className="break-all">{logDirectory}</code>
            </p>
          )}
        </div>
      ) : (
        <p role="status" className="m-0 text-text-muted">
          {t("app.startup.opening")}
        </p>
      )}
    </main>
  );
}
