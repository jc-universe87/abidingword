import { useTranslation } from "react-i18next";
import { Button } from "@/design-system/Button";
import { DownloadStatus } from "./UpdateNotice";
import { useUpdates } from "./UpdatesContext";

/**
 * Settings → Updates, opened: the running version, the channel, a manual
 * check and, when there is one, the update itself. Closed, the section's
 * heading line already says whether all is up to date.
 */
export function UpdateSettings() {
  const { t } = useTranslation();
  const { enabled, version, state, check, install } = useUpdates();

  if (!enabled) {
    return <p className="m-0 text-[0.9375rem] text-text-muted">{t("app.updates.notIncluded")}</p>;
  }
  const busy = state.kind === "checking" || state.kind === "installing";
  const retry = state.kind === "failed" && state.step === "install" && state.update;
  return (
    <div className="flex flex-col gap-3">
      {(state.kind === "available" || state.kind === "installing" || state.kind === "failed") && (
        <div className="flex flex-col items-start gap-2 rounded-aw border border-border bg-bg-secondary px-3 py-2">
          <p role="status" className="m-0 text-text-strong">
            {state.kind === "available" && t("app.updates.available", { version: state.update.version })}
            {state.kind === "installing" && <DownloadStatus />}
            {state.kind === "failed" && <span className="text-danger">{t(`app.updates.errors.${state.step}`)}</span>}
          </p>
          {(state.kind === "available" || retry) && (
            <Button variant="primary" onClick={() => void install()}>
              {t("app.updates.updateNow")}
            </Button>
          )}
        </div>
      )}
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[0.9375rem]">
        <dt className="text-text-muted">{t("app.updates.version")}</dt>
        <dd className="m-0" data-testid="update-version">{version}</dd>
        <dt className="text-text-muted">{t("app.updates.channel")}</dt>
        <dd className="m-0">{t("app.updates.channelTest")}</dd>
      </dl>
      <div>
        <Button onClick={() => void check()} disabled={busy}>
          {state.kind === "checking" ? t("app.updates.checking") : t("app.updates.check")}
        </Button>
        {/* The section's heading line already shows the result; this only tells screen readers. */}
        <span role="status" className="sr-only">
          {state.kind === "checking" && t("app.updates.checking")}
          {state.kind === "upToDate" && t("app.updates.upToDate")}
        </span>
      </div>
      <p className="m-0 text-[0.8125rem] text-text-muted">{t("app.updates.help")}</p>
    </div>
  );
}
