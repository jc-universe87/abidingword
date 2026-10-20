import { useCallback, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Dialog } from "@/design-system/Dialog";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import {
  acceptImport,
  TEMPLATE_ROLES,
  type FontReport,
  type ImportedTemplate,
  type ReportItem,
  type ReportLevel,
  type TemplateDefinition,
  type TemplateRole,
} from "@/types/presentationTemplate";
import { TemplateSlide } from "./TemplateSlide";
import { roleLabel, useTemplateImages, useTemplatePreview } from "./templateSupport";

const LEVELS: { level: ReportLevel; Icon: typeof CircleCheck; tone: string }[] = [
  // Clear, not alarming (v0.18.5): what cannot be carried over is a fact, shown quietly; what needs a look
  // is the one to act on. Each level has its own icon and heading, never colour alone.
  { level: "unsupported", Icon: CircleX, tone: "text-text-muted" },
  { level: "attention", Icon: TriangleAlert, tone: "text-warning" },
  { level: "supported", Icon: CircleCheck, tone: "text-success" },
];

/** Font replacements chosen here, applied to the design's font choices. */
function withReplacements(fonts: TemplateDefinition["fonts"], chosen: Record<string, string>): TemplateDefinition["fonts"] {
  const pick = (f: TemplateDefinition["fonts"]["heading"]) => ({ ...f, replacement: chosen[f.family.toLowerCase()] || null });
  return { heading: pick(fonts.heading), body: pick(fonts.body), others: fonts.others.map(pick) };
}

/**
 * What an imported PowerPoint design brings, before anything is saved:
 * what was taken over, what needs a look and what cannot be reproduced
 * (each with words and a symbol, never colour alone); the fonts and their
 * replacements on this computer (only ever chosen by the person); and which
 * layout each kind of slide uses (suggested where it is obvious).
 */
export function ImportReview({ imported, fileName, onDone }: { imported: ImportedTemplate; fileName: string; onDone: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const installed = useLoad(useCallback(() => api.presentationFonts(), [api]));
  const [name, setName] = useState(imported.name);
  const [mapping, setMapping] = useState<Partial<Record<TemplateRole, string>>>(imported.suggestions);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const report = imported.report;

  const definition = useMemo(() => acceptImport(imported, mapping, withReplacements(imported.definition.fonts, replacements)), [imported, mapping, replacements]);
  const preview = useTemplatePreview(definition, [...TEMPLATE_ROLES]);
  const images = useTemplateImages(imported.definition);
  const families = useMemo(() => [...new Set((installed.data ?? []).map((f) => f.family))].sort((a, b) => a.localeCompare(b)), [installed.data]);

  const save = async () => {
    if (!name.trim()) {
      setError(t("presentation.templates.nameNeeded"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.presentationTemplateCreate({ name: name.trim(), description: "", definition, sourceFormat: "pptx", sourceName: fileName, report });
      onDone();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const grouped = (level: ReportLevel) => {
    const byCode = new Map<string, ReportItem[]>();
    for (const item of report.items.filter((i) => i.level === level)) byCode.set(item.code, [...(byCode.get(item.code) ?? []), item]);
    return [...byCode.entries()];
  };
  const where = (items: ReportItem[]) =>
    items
      .map((i) => [i.layout, i.code === "slidesIgnored" ? null : i.detail].filter(Boolean).join(" – "))
      .filter(Boolean)
      .join(", ");
  const status = (f: FontReport) => t(`presentation.templates.fontStatus.${f.status}`);
  const style = (f: FontReport) => [f.bold ? t("presentation.templates.bold") : null, f.italic ? t("presentation.templates.italic") : null].filter(Boolean).join(", ") || t("presentation.templates.regular");
  const fontRows = report.fonts.filter((f, i, all) => all.findIndex((g) => g.family.toLowerCase() === f.family.toLowerCase()) === i || f.status !== "installed");

  return (
    <Dialog
      wide
      title={t("presentation.templates.reviewTitle")}
      onClose={onDone}
      actions={
        <>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? t("presentation.templates.saving") : t("presentation.templates.keep")}
          </Button>
          <Button onClick={onDone}>{t("common.cancel")}</Button>
        </>
      }
    >
      <p className="type-meta m-0">
        {t("presentation.templates.summary", { file: report.fileName, ratio: report.ratio === "other" ? `${Math.round(report.width)} × ${Math.round(report.height)}` : report.ratio, count: report.layouts })}
      </p>
      <label className="flex flex-col gap-1 text-[0.9375rem]">
        <span className="type-subhead">{t("presentation.templates.name")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="h-11 aw-input px-2" />
      </label>

      <section aria-labelledby={`${id}-report`} className="flex flex-col gap-2">
        <h3 id={`${id}-report`} className="type-group m-0 mt-2">{t("presentation.templates.report")}</h3>
        {LEVELS.map(({ level, Icon, tone }) => {
          const groups = grouped(level);
          if (groups.length === 0) return null;
          return (
            <div key={level} className="flex flex-col gap-1">
              <h4 className="type-group m-0 flex items-center gap-2">
                <Icon className={`size-4 shrink-0 ${tone}`} aria-hidden="true" />
                {t(`presentation.templates.levels.${level}`)}
              </h4>
              <ul className="m-0 flex flex-col gap-1 pl-6 text-[0.9375rem]">
                {groups.map(([code, items]) => (
                  <li key={code}>
                    {t(`presentation.templates.codes.${code}` as never, { count: items[0]?.code === "slidesIgnored" ? Number(items[0].detail ?? 0) : items.length, defaultValue: code })}
                    {where(items) && <span className="text-text-muted">{` — ${where(items)}`}</span>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section aria-labelledby={`${id}-fonts`} className="flex flex-col gap-2">
        <h3 id={`${id}-fonts`} className="type-group m-0 mt-2">{t("presentation.templates.fonts")}</h3>
        <p className="m-0 type-meta">{t("presentation.templates.fontsHint")}</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[0.9375rem]">
            <thead>
              <tr className="border-b border-border">
                <th className="py-1 pr-2 font-medium">{t("presentation.templates.font")}</th>
                <th className="py-1 pr-2 font-medium">{t("presentation.templates.found")}</th>
                <th className="py-1 font-medium">{t("presentation.templates.replacement")}</th>
              </tr>
            </thead>
            <tbody>
              {fontRows.map((f) => {
                const key = f.family.toLowerCase();
                const label = `${f.family} (${style(f)})`;
                return (
                  <tr key={`${f.family}-${f.bold}-${f.italic}`} className="border-b border-border-subtle align-top">
                    <td className="py-2 pr-2">
                      <span className="font-medium">{f.family}</span>
                      <span className="block type-meta">{style(f)}</span>
                    </td>
                    <td className="py-2 pr-2">
                      <span className="inline-flex items-center gap-1">
                        {f.status === "installed" ? <CircleCheck className="size-4 text-primary" aria-hidden="true" /> : <TriangleAlert className="size-4 text-accent" aria-hidden="true" />}
                        {status(f)}
                      </span>
                      {f.status === "installed" && !f.embeddable && <span className="block type-meta">{t("presentation.templates.notEmbeddable")}</span>}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label={t("presentation.templates.replacementFor", { font: label })}
                          value={replacements[key] ?? ""}
                          onChange={(e) => setReplacements((r) => ({ ...r, [key]: e.target.value }))}
                          className="h-11 min-w-0 max-w-full aw-input px-2"
                        >
                          <option value="">{t("presentation.templates.keepFont")}</option>
                          {families.map((family) => (
                            <option key={family} value={family}>{family}</option>
                          ))}
                        </select>
                        {f.suggestion && replacements[key] !== f.suggestion && (
                          <button type="button" onClick={() => setReplacements((r) => ({ ...r, [key]: f.suggestion! }))} className="min-h-11 rounded-aw px-2 font-medium text-link hover:bg-hover">
                            {t("presentation.templates.useSuggestion", { font: f.suggestion })}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby={`${id}-roles`} className="flex flex-col gap-2">
        <h3 id={`${id}-roles`} className="type-group m-0 mt-2">{t("presentation.templates.layouts")}</h3>
        <p className="m-0 type-meta">{t("presentation.templates.layoutsHint")}</p>
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {TEMPLATE_ROLES.map((role) => {
            const page = preview.pages.get(role);
            const suggested = imported.suggestions[role];
            return (
              <li key={role} className="flex flex-col gap-2 rounded-aw border border-border-subtle p-2">
                <label className="flex flex-col gap-1 text-[0.9375rem]">
                  <span className="font-medium text-text-strong">{roleLabel(t, role)}</span>
                  <select
                    value={mapping[role] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [role]: e.target.value || undefined }))}
                    className="h-11 min-w-0 max-w-full aw-input px-2"
                  >
                    <option value="">{t("presentation.templates.builtInArrangement")}</option>
                    {imported.layouts.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.id === suggested ? t("presentation.templates.suggested", { name: l.name }) : l.name}
                      </option>
                    ))}
                  </select>
                </label>
                {page && (
                  <div aria-hidden="true" className="relative w-full overflow-hidden rounded border border-border" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
                    <TemplateSlide page={page} images={images} showOverflow />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {preview.error && <p role="alert" className="m-0 text-danger">{preview.error}</p>}
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
    </Dialog>
  );
}
