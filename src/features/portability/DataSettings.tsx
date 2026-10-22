import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArchiveRestore, HardDriveDownload, Sprout, Upload } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { formatDate } from "@/i18n/format";
import type { BackupPreview, ProjectImportReport, ProjectPackagePreview, RestoreReport, SampleReport } from "@/types/portability";
import { ProjectExport } from "./ProjectExport";
import { backupCountsLine, countsLine, megabytes } from "./format";

/**
 * Settings › Data and backup (v0.19): four separate actions. Export one
 * project, import one (always as a new project), back up everything, and
 * restore everything from a backup after a clear warning.
 */
export function DataSettings() {
  const { t } = useTranslation();
  const api = useApi();
  const workspace = useLoad(useCallback(() => api.workspaceGetDefault(), [api]));
  const workspaceId = workspace.data?.id ?? null;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h3 className="type-group m-0">{t("settings.data.projects")}</h3>
        <p className="m-0 max-w-prose text-[0.9375rem] text-text-muted">{t("settings.data.projectsHint")}</p>
        {workspaceId && <ExportPicker workspaceId={workspaceId} />}
        <ProjectImport />
      </div>
      <div className="flex flex-col gap-4 border-t border-border-subtle pt-6">
        <h3 className="type-group m-0">{t("settings.data.backup")}</h3>
        <p className="m-0 max-w-prose text-[0.9375rem] text-text-muted">{t("settings.data.backupHint")}</p>
        <BackupCreate />
        <BackupRestore />
      </div>
      <div className="flex flex-col gap-4 border-t border-border-subtle pt-6">
        <h3 className="type-group m-0">{t("settings.data.sample")}</h3>
        <p className="m-0 max-w-prose text-[0.9375rem] text-text-muted">{t("settings.data.sampleHint")}</p>
        <SampleInstall />
      </div>
    </div>
  );
}

function ExportPicker({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const projects = useLoad(useCallback(() => api.projectList(workspaceId), [api, workspaceId]));
  const [chosen, setChosen] = useState<string>("");
  const list = projects.data ?? [];
  const selected = list.find((p) => p.id === chosen) ?? list[0] ?? null;
  if (list.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[0.9375rem] font-medium text-text-muted">
        {t("settings.data.exportLabel")}
      </label>
      <select id={id} value={selected?.id ?? ""} onChange={(e) => setChosen(e.target.value)} className="h-11 max-w-sm aw-input px-2 text-text-strong">
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      <ProjectExport key={selected?.id} projectId={selected?.id ?? null} title={selected?.title ?? ""} />
    </div>
  );
}

function MissingList({ missing }: { missing: ProjectPackagePreview["missing"] }) {
  const { t } = useTranslation();
  const rows = [
    [t("settings.data.missingSources"), missing.sources],
    [t("settings.data.missingTemplates"), missing.presentationTemplates],
    [t("settings.data.missingBibles"), missing.bibles],
  ] as const;
  const any = rows.some(([, items]) => items.length > 0) || missing.images > 0;
  if (!any) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 font-medium text-text-strong">{t("settings.data.missingHeading")}</p>
      <ul className="m-0 pl-5">
        {rows
          .filter(([, items]) => items.length > 0)
          .map(([label, items]) => (
            <li key={label}>
              {label}: {items.join(", ")}
            </li>
          ))}
        {missing.images > 0 && <li>{t("settings.data.missingImages", { n: missing.images })}</li>}
      </ul>
      <p className="m-0 type-meta">{t("settings.data.missingHint")}</p>
    </div>
  );
}

function ProjectImport() {
  const { t } = useTranslation();
  const api = useApi();
  const [picked, setPicked] = useState<{ path: string; preview: ProjectPackagePreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ProjectImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    setError(null);
    setDone(null);
    const path = await api.choosePortableFile({ kind: "project", title: t("settings.data.openProject"), filterName: t("settings.data.projectFilter") });
    if (!path) return;
    setBusy(true);
    try {
      setPicked({ path, preview: await api.projectPackageInspect(path) });
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await api.projectImport(picked.path));
      setPicked(null);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button disabled={busy} onClick={() => void choose()}>
          <Upload className="size-4" aria-hidden="true" />
          {t("settings.data.import")}
        </Button>
      </div>
      {picked && (
        <section aria-label={t("settings.data.importPreview")} className="flex flex-col gap-3 rounded-aw border border-border-subtle bg-raised p-4 text-[0.9375rem]">
          <div>
            <p className="m-0 font-medium text-text-strong">{picked.preview.title}</p>
            {picked.preview.description && <p className="m-0 text-text-muted">{picked.preview.description}</p>}
            <p className="m-0 type-meta">{t("settings.data.savedOn", { date: formatDate(picked.preview.createdAt), version: picked.preview.appVersion })}</p>
            <p className="m-0 type-meta">{countsLine(t, picked.preview.counts)}</p>
          </div>
          <p className="m-0">{t("settings.data.importAs", { title: picked.preview.importTitle })}</p>
          <MissingList missing={picked.preview.missing} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
              {busy ? t("settings.data.working") : t("settings.data.importConfirm")}
            </Button>
            <Button disabled={busy} onClick={() => setPicked(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </section>
      )}
      {done && (
        <Notice tone="success">
          <p className="m-0">{t("settings.data.imported", { title: done.title })}</p>
          <p className="m-0 mt-1 type-meta">{countsLine(t, done.counts)}</p>
          {done.citationsKept > 0 && <p className="m-0 mt-1">{t("settings.data.citationsKept", { n: done.citationsKept })}</p>}
          {done.citationsReconnected > 0 && <p className="m-0 mt-1">{t("settings.data.citationsReconnected", { n: done.citationsReconnected })}</p>}
          {done.leftOut > 0 && <p className="m-0 mt-1">{t("settings.data.leftOut", { n: done.leftOut })}</p>}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function BackupCreate() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ path: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setError(null);
    setDone(null);
    const stamp = new Date().toISOString().slice(0, 10);
    const path = await api.choosePortableSaveFile({ kind: "backup", defaultName: `Abiding Word ${stamp}.awbackup`, filterName: t("settings.data.backupFilter") });
    if (!path) return;
    setBusy(true);
    try {
      const [saved, report] = await api.backupCreate(path);
      setDone({ path: saved, size: report.size });
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button disabled={busy} onClick={() => void run()}>
          <HardDriveDownload className="size-4" aria-hidden="true" />
          {busy ? t("settings.data.working") : t("settings.data.backupCreate")}
        </Button>
      </div>
      {busy && <p role="status" className="m-0 type-meta">{t("settings.data.workingLong")}</p>}
      {done && <Notice tone="success">{t("settings.data.backedUp", { path: done.path, size: megabytes(done.size, i18n.language) })}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function BackupRestore() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const [picked, setPicked] = useState<{ path: string; preview: BackupPreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RestoreReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    setError(null);
    setDone(null);
    const path = await api.choosePortableFile({ kind: "backup", title: t("settings.data.openBackup"), filterName: t("settings.data.backupFilter") });
    if (!path) return;
    setBusy(true);
    try {
      setPicked({ path, preview: await api.backupInspect(path) });
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await api.backupRestore(picked.path));
      setPicked(null);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button disabled={busy || done !== null} onClick={() => void choose()}>
          <ArchiveRestore className="size-4" aria-hidden="true" />
          {t("settings.data.restore")}
        </Button>
      </div>
      {picked && (
        <section aria-label={t("settings.data.restorePreview")} className="flex flex-col gap-3 rounded-aw border border-border-subtle bg-raised p-4 text-[0.9375rem]">
          <div>
            <p className="m-0 type-meta">{t("settings.data.savedOn", { date: formatDate(picked.preview.createdAt), version: picked.preview.appVersion })}</p>
            <p className="m-0 type-meta">
              {backupCountsLine(t, picked.preview.counts)} · {t("settings.data.size", { size: megabytes(picked.preview.size, i18n.language) })}
            </p>
          </div>
          <Notice tone="warning">{t("settings.data.restoreWarning")}</Notice>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
              {busy ? t("settings.data.working") : t("settings.data.restoreConfirm")}
            </Button>
            <Button disabled={busy} autoFocus onClick={() => setPicked(null)}>
              {t("common.cancel")}
            </Button>
          </div>
          {busy && <p role="status" className="m-0 type-meta">{t("settings.data.workingLong")}</p>}
        </section>
      )}
      {done && (
        <Notice tone="success">
          <p className="m-0">{t("settings.data.restored")}</p>
          <p className="m-0 mt-1 type-meta">{t("settings.data.safetyCopy", { path: done.safetyCopy })}</p>
          {done.filesSetAside > 0 && <p className="m-0 mt-1">{t("settings.data.setAside", { n: done.filesSetAside })}</p>}
          <div className="mt-3">
            <Button variant="primary" onClick={() => window.location.reload()}>
              {t("settings.data.restoredContinue")}
            </Button>
          </div>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

/** The example project, added only on this explicit request; never twice. */
function SampleInstall() {
  const { t } = useTranslation();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SampleReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone(await api.sampleProjectInstall());
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button disabled={busy} onClick={() => void run()}>
          <Sprout className="size-4" aria-hidden="true" />
          {busy ? t("settings.data.working") : t("settings.data.sampleAdd")}
        </Button>
      </div>
      {done && <Notice tone="success">{t(done.added ? "settings.data.sampleAdded" : "settings.data.sampleThere", { title: done.title })}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
