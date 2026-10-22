import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Notice } from "@/design-system/Notice";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { ProjectExportReport } from "@/types/portability";
import { countsLine, fileName } from "./format";

/**
 * "Export project…" (v0.19): the save dialog, then the package, then what
 * was saved and what it only names (library sources, church templates,
 * Bibles), which stay on this computer.
 */
export function ProjectExport({ projectId, title, quiet = false }: { projectId: string | null; title: string; quiet?: boolean }) {
  const { t } = useTranslation();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ path: string; report: ProjectExportReport } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!projectId || busy) return;
    setError(null);
    setDone(null);
    const path = await api.choosePortableSaveFile({ kind: "project", defaultName: `${fileName(title)}.awproject`, filterName: t("settings.data.projectFilter") });
    if (!path) return;
    setBusy(true);
    try {
      const [saved, report] = await api.projectExport({ projectId, path });
      setDone({ path: saved, report });
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const named = done
    ? [
        [t("settings.data.missingSources"), done.report.external.sources],
        [t("settings.data.missingTemplates"), done.report.external.presentationTemplates],
        [t("settings.data.missingBibles"), done.report.external.bibles],
      ].filter(([, items]) => (items as unknown[]).length > 0)
    : [];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button variant={quiet ? "quiet" : "secondary"} disabled={!projectId || busy} onClick={() => void run()}>
          <Download className="size-4" aria-hidden="true" />
          {busy ? t("settings.data.working") : t("settings.data.export")}
        </Button>
      </div>
      {done && (
        <Notice tone="success">
          <p className="m-0">{t("settings.data.exported", { title: done.report.title, path: done.path })}</p>
          <p className="m-0 mt-1 type-meta">{countsLine(t, done.report.counts)}</p>
          {named.length > 0 && (
            <div className="mt-2">
              <p className="m-0">{t("settings.data.namedOnly")}</p>
              <ul className="m-0 mt-1 pl-5">
                {named.map(([label, items]) => (
                  <li key={label as string}>
                    {label as string}: {(items as { name: string }[]).map((i) => i.name).join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
