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
    <div className="flex flex-col gap-4">
      {(state.kind === "available" || state.kind === "installing" || state.kind === "failed") && (
        <div className="flex flex-col items-start gap-3 rounded-aw border border-border bg-bg-secondary p-4">
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
      <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 text-[0.9375rem] sm:grid-cols-[12rem_1fr]">
        <dt className="font-medium text-text-strong">{t("app.updates.version")}</dt>
        <dd className="m-0" data-testid="update-version">{version}</dd>
        <dt className="font-medium text-text-strong">{t("app.updates.channel")}</dt>
        <dd className="m-0">{t("app.updates.channelTest")}</dd>
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void check()} disabled={busy}>
          {t("app.updates.check")}
        </Button>
        <span role="status" className="text-[0.9375rem]">
          {state.kind === "checking" && t("app.updates.checking")}
          {state.kind === "upToDate" && t("app.updates.upToDate")}
        </span>
      </div>
      <p className="m-0 text-[0.9375rem] text-text-muted">{t("app.updates.help")}</p>
    </div>
  );
}
