import { useCallback, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Trash2, X } from "lucide-react";
import { Button } from "@/design-system/Button";
import { FindingSources } from "@/features/library/FindingSources";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { useAutosave } from "@/hooks/useAutosave";
import { referenceLabel } from "@/i18n/scripture";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { StudySection } from "@/types/domain";
import { FINDING_TYPES, type Finding, type FindingType } from "@/types/studies";
import { sectionTitle } from "./builtinText";
import { findingInline, findingLabel } from "./labels";

interface FindingNoteProps {
  finding: Finding;
  sections: StudySection[];
  /** Every finding of the study, in order (what a reorder is sent as). */
  order: string[];
  /** The findings shown together with this one (its section, or the study's own), in order. */
  group: string[];
  canMove: boolean;
  onChanged: () => void;
  onRevealScripture: () => void;
}

/** One finding, as a note in the flow of the study: its text, and its kind and the rest under Details. */
export function FindingNote({ finding, sections, order, group, canMove, onChanged, onRevealScripture }: FindingNoteProps) {
  const { t } = useTranslation();
  const api = useApi();
  const { goTo, currentPassage } = useScripture();
  const detailsId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(finding.content);
  const [tags, setTags] = useState(finding.tags.join(", "));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = findingLabel(t, finding.findingType);
  const type = findingInline(t, finding.findingType);

  const save = useCallback((content: string) => api.findingUpdate({ id: finding.id, content }), [api, finding.id]);
  const { schedule, flush } = useAutosave(save);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  // Moves within what is shown together; the other findings keep their places.
  const move = (delta: -1 | 1) => {
    const neighbour = group[group.indexOf(finding.id) + delta];
    if (neighbour === undefined) return;
    const ids = [...order];
    const [from, to] = [ids.indexOf(finding.id), ids.indexOf(neighbour)];
    if (from < 0 || to < 0) return;
    [ids[from], ids[to]] = [neighbour, finding.id];
    void act(() => api.findingReorder({ parentId: finding.studyId, ids }));
  };
  const position = group.indexOf(finding.id);
  const linked = currentPassage && finding.passages.some((p) => p.reference.canonical === currentPassage.canonical);
  const excerpt = finding.content.slice(0, 60);

  const field = "h-11 min-w-0 max-w-full rounded-aw border border-border bg-bg px-2";
  const quiet = "inline-flex min-h-11 items-center rounded-aw px-2 text-text-muted hover:bg-bg-secondary hover:text-text-strong disabled:opacity-40";

  return (
    <li>
      <article
        aria-label={t("studies.findings.itemLabel", { type: label, excerpt })}
        className="flex flex-col gap-1 border-l-[3px] border-border py-1 pl-4"
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
            toggle.current?.focus();
          }
        }}
      >
        {/* Its kind, as a quiet label: the part it is in is the heading it sits under. */}
        <p className="m-0 text-[0.9375rem] font-medium text-text-muted">{label}</p>

        <textarea
          aria-label={t("studies.findings.text", { type: label })}
          rows={2}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            schedule(e.target.value);
          }}
          onBlur={flush}
          className="reading w-full resize-y rounded-aw border border-transparent border-b-border-subtle bg-transparent px-2 py-1 -mx-2 text-[1rem] hover:border-border-subtle focus:border-border"
        />

        {(finding.passages.length > 0 || finding.sources.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
            {finding.passages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  goTo(p.reference);
                  onRevealScripture();
                }}
                className="min-h-11 rounded-aw border border-border px-2 font-medium text-link hover:bg-bg-secondary"
              >
                {referenceLabel(p.reference)}
              </button>
            ))}
          </div>
        )}
        <FindingSources
          finding={finding}
          canAdd={open}
          onChanged={onChanged}
          onQuote={
            finding.findingType === "quotation"
              ? (quotation) => {
                  setText(quotation);
                  schedule(quotation);
                }
              : undefined
          }
        />

        <div>
          <button
            ref={toggle}
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={t("studies.findings.detailsFor", { type, excerpt })}
            onClick={() => setOpen(!open)}
            className={`${quiet} -ml-2 gap-1 text-[0.9375rem]`}
          >
            {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
            {t("studies.findings.details")}
          </button>
        </div>

        {open && (
          <div id={detailsId} className="flex flex-col gap-3 rounded-aw border border-border-subtle bg-bg-secondary px-3 py-3 text-[0.9375rem]">
            <div className="flex flex-col gap-2 @md:flex-row @md:flex-wrap @md:items-center @md:gap-4">
              <label className="flex items-center gap-2">
                <span className="text-text-muted">{t("studies.findings.typeLabel")}</span>
                <select
                  value={finding.findingType}
                  onChange={(e) => act(() => api.findingUpdate({ id: finding.id, findingType: e.target.value as FindingType }))}
                  className={field}
                >
                  {FINDING_TYPES.map((option) => (
                    <option key={option} value={option}>{findingLabel(t, option)}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-text-muted">{t("studies.findings.section")}</span>
                <select
                  value={finding.sectionId ?? ""}
                  onChange={(e) => act(() => api.findingUpdate({ id: finding.id, sectionId: e.target.value }))}
                  className={field}
                >
                  <option value="">{t("studies.findings.wholeStudy")}</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>{sectionTitle(s)}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-text-muted">{t("studies.findings.tags")}</span>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  onBlur={() => {
                    const next = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
                    if (next.join(",") !== finding.tags.join(",")) void act(() => api.findingSetTags({ findingId: finding.id, tags: next }));
                  }}
                  placeholder={t("studies.findings.tagsPlaceholder")}
                  className={`${field} w-44`}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {finding.passages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => act(() => api.findingUnlinkPassage(p.id))}
                  aria-label={t("studies.findings.unlink", { passage: referenceLabel(p.reference) })}
                  className="inline-flex min-h-11 items-center gap-1 rounded-aw border border-border px-2 text-text-muted hover:bg-bg"
                >
                  {referenceLabel(p.reference)}
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              ))}
              {currentPassage && !linked && (
                <button
                  type="button"
                  onClick={() => act(() => api.findingLinkPassage({ findingId: finding.id, reference: currentPassage.canonical }))}
                  className="min-h-11 rounded-aw px-2 text-text-muted underline-offset-2 hover:text-text-strong hover:underline"
                >
                  {t("studies.findings.link", { passage: referenceLabel(currentPassage) })}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {canMove && (
                <>
                  <button type="button" className={quiet} disabled={position <= 0} onClick={() => move(-1)} aria-label={t("studies.findings.moveUp", { type })}>
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" className={quiet} disabled={position >= group.length - 1} onClick={() => move(1)} aria-label={t("studies.findings.moveDown", { type })}>
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </button>
                </>
              )}
              <button
                type="button"
                className={`${quiet} ml-auto gap-1 hover:text-danger`}
                onClick={() => (text.trim() ? setConfirming(true) : act(() => api.findingDelete(finding.id)))}
                aria-label={t("studies.findings.delete", { type })}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t("common.delete")}
              </button>
            </div>
          </div>
        )}

        {confirming && (
          <div role="alertdialog" aria-label={t("studies.findings.confirmDelete", { type })} className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
            <span>{t("studies.findings.confirmDelete", { type })}</span>
            <Button variant="primary" onClick={() => act(() => api.findingDelete(finding.id))}>{t("common.delete")}</Button>
            <Button autoFocus onClick={() => setConfirming(false)}>{t("common.keep")}</Button>
          </div>
        )}
        {error && <p role="alert" className="m-0 text-[0.9375rem] text-danger">{error}</p>}
      </article>
    </li>
  );
}
