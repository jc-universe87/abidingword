import { useTranslation } from "react-i18next";
import { Button } from "@/design-system/Button";
import { useUpdates } from "./UpdatesContext";

/** The line shown while an update downloads: a percentage only when the size is known. */
export function DownloadStatus() {
  const { t } = useTranslation();
  const { state } = useUpdates();
  if (state.kind !== "installing") return null;
  const { progress } = state;
  if (!progress || progress.total === null || progress.total <= 0) return <span>{t("app.updates.downloading")}</span>;
  const percent = Math.min(100, Math.floor((progress.downloaded / progress.total) * 100));
  return (
    <span className="flex items-center gap-3">
      <span>{t("app.updates.downloadingPercent", { percent })}</span>
      <progress className="h-2 w-40" max={100} value={percent} aria-label={t("app.updates.downloading")} />
    </span>
  );
}

/**
 * A slim notice under the app bar when an update is waiting. It never
 * blocks the app: Later hides it for this version.
 */
export function UpdateNotice() {
  const { t } = useTranslation();
  const { enabled, state, dismissed, install, dismiss } = useUpdates();
  if (!enabled) return null;

  const shown =
    (state.kind === "available" && !dismissed) ||
    state.kind === "installing" ||
    (state.kind === "failed" && state.step === "install");
  if (!shown) return null;

  return (
    <div
      role={state.kind === "failed" ? "alert" : "status"}
      aria-label={t("app.updates.noticeLabel")}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-bg-secondary px-4 py-2 font-ui text-[0.9375rem] text-text-strong"
    >
      {state.kind === "available" && (
        <>
          <span className="font-medium">{t("app.updates.available", { version: state.update.version })}</span>
          <span className="flex gap-2">
            <Button variant="primary" onClick={() => void install()}>
              {t("app.updates.updateNow")}
            </Button>
            <Button onClick={dismiss}>{t("app.updates.later")}</Button>
          </span>
        </>
      )}
      {state.kind === "installing" && <DownloadStatus />}
      {state.kind === "failed" && (
        <>
          <span className="text-danger">{t("app.updates.errors.install")}</span>
          <span className="flex gap-2">
            <Button variant="primary" onClick={() => void install()}>
              {t("common.tryAgain")}
            </Button>
          </span>
        </>
      )}
    </div>
  );
}
