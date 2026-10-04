import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useSaveTracker } from "@/hooks/SaveTracker";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { BLOCK_TYPES, type BlockType, type StudySection } from "@/types/domain";
import { BlockEditor } from "./BlockEditor";
import { sectionGuidance, sectionTitle } from "./builtinText";
import { blockLabel } from "./labels";

interface SectionEditorProps {
  section: StudySection;
  isFirst: boolean;
  isLast: boolean;
  /** Whether findings are assigned to this section. */
  hasFindings: boolean;
  onChange: (section: StudySection) => void;
  onMove: (delta: -1 | 1) => void;
  onDeleted: () => void;
  onRevealScripture: () => void;
  /** A section just added: bring it into view and focus its heading. */
  reveal?: boolean;
}

const tool = "inline-flex min-h-9 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-bg-secondary hover:text-text-strong disabled:opacity-40";

export function SectionEditor(props: SectionEditorProps) {
  const { section, isFirst, isLast, hasFindings, onChange, onMove, onDeleted, onRevealScripture, reveal = false } = props;
  const { t } = useTranslation();
  const api = useApi();
  const { track, settled } = useSaveTracker();
  const [renaming, setRenaming] = useState(false);
  const [managing, setManaging] = useState(false);
  const [adding, setAdding] = useState(false);
  const manageId = useId();
  useEffect(() => {
    if (!reveal) return;
    const heading = document.getElementById(`section-${section.id}`);
    heading?.scrollIntoView?.({ block: "start" });
    heading?.focus({ preventScroll: true });
  }, [reveal, section.id]);
  const manageToggle = useRef<HTMLButtonElement>(null);
  const addToggle = useRef<HTMLButtonElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingId = `section-${section.id}`;
  const title = sectionTitle(section);
  // Guidance is for a section with nothing in it yet; once there is writing it is out of the way.
  const guidance = section.blocks.some((b) => b.content.trim()) ? null : sectionGuidance(section);

  const addBlock = async (blockType: BlockType) => {
    setError(null);
    setAdding(false);
    try {
      const block = await api.studyBlockCreate({ sectionId: section.id, blockType });
      onChange({ ...section, blocks: [...section.blocks, block] });
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const removeBlock = (blockId: string) =>
    onChange({ ...section, blocks: section.blocks.filter((b) => b.id !== blockId) });

  const moveBlock = async (blockId: string, delta: -1 | 1) => {
    const ids = section.blocks.map((b) => b.id);
    const index = ids.indexOf(blockId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    setError(null);
    try {
      const blocks = await api.studyBlockReorder({ parentId: section.id, ids });
      onChange({ ...section, blocks });
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  // The database decides whether the section still has content: text
  // typed a moment ago may not be in this page's copy yet. Pending saves are
  // awaited first; a "conflict" answer means it has content, so ask.
  const remove = async (force: boolean) => {
    setError(null);
    try {
      await settled();
      await api.studySectionDelete({ id: section.id, force });
      onDeleted();
    } catch (e) {
      const error = toApiError(e);
      if (!force && error.kind === "conflict") setConfirmingDelete(true);
      else setError(error.message);
    }
  };

  const rename = async (title: string) => {
    const saving = api.studySectionUpdate({ id: section.id, title });
    track(saving);
    try {
      const updated = await saving;
      onChange({ ...updated, blocks: section.blocks });
      setRenaming(false);
      setError(null);
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      id={`section-anchor-${section.id}`}
      className="scroll-mt-4 border-t border-border-subtle pt-6"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        if (managing) {
          e.stopPropagation();
          setManaging(false);
          manageToggle.current?.focus();
        } else if (adding) {
          e.stopPropagation();
          setAdding(false);
          addToggle.current?.focus();
        }
      }}
    >
      {renaming ? (
        <RenameForm initial={title} onSubmit={rename} onCancel={() => setRenaming(false)} />
      ) : (
        <div className="flex items-baseline gap-2">
          <h2 id={headingId} tabIndex={-1} className="m-0 min-w-0 break-words font-display text-[1.5rem] font-heading text-text-strong">
            {title}
          </h2>
          <button
            ref={manageToggle}
            type="button"
            aria-expanded={managing}
            aria-controls={manageId}
            aria-label={t("studies.sections.options", { title })}
            title={t("studies.sections.optionsTooltip")}
            onClick={() => setManaging(!managing)}
            className="ml-auto inline-flex size-9 shrink-0 items-center justify-center self-center rounded-aw text-text-muted hover:bg-bg-secondary hover:text-text-strong"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
      {managing && !renaming && (
        <div id={manageId} role="group" aria-label={t("studies.sections.optionsGroup", { title })} className="mt-1 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setManaging(false);
              setRenaming(true);
            }}
            aria-label={t("studies.sections.rename", { title })}
            className={tool}
          >
            <Pencil className="size-4" aria-hidden="true" />
            {t("studies.sections.renameTooltip")}
          </button>
          <button type="button" className={tool} disabled={isFirst} onClick={() => onMove(-1)} aria-label={t("studies.sections.moveUp", { title })}>
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
          <button type="button" className={tool} disabled={isLast} onClick={() => onMove(1)} aria-label={t("studies.sections.moveDown", { title })}>
            <ArrowDown className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${tool} hover:text-danger`}
            onClick={() => void remove(false)}
            aria-label={t("studies.sections.delete", { title })}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {t("common.delete")}
          </button>
        </div>
      )}
      {confirmingDelete && (
        <div role="alertdialog" aria-label={t("studies.sections.confirmLabel", { title })} className="mt-2 flex flex-col gap-2 border-l-[3px] border-danger bg-bg-secondary px-4 py-3">
          <p className="m-0">
            {t(hasFindings ? "studies.sections.confirmWithFindings" : "studies.sections.confirm", { title })}
          </p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => remove(true)}>{t("studies.sections.deleteSection")}</Button>
            <Button autoFocus onClick={() => setConfirmingDelete(false)}>{t("studies.keepIt")}</Button>
          </div>
        </div>
      )}
      {guidance && <p className="mt-1 mb-3 text-[0.9375rem] text-text-muted">{guidance}</p>}

      <div className="mt-2 flex flex-col gap-1">
        {section.blocks.map((block, index) => (
          <BlockEditor
            key={block.id}
            block={block}
            sectionTitle={title}
            placeholder={index === 0 ? t("studies.blocks.placeholder") : ""}
            onDeleted={removeBlock}
            onRevealScripture={onRevealScripture}
            isFirst={index === 0}
            isLast={index === section.blocks.length - 1}
            onMove={(delta) => moveBlock(block.id, delta)}
          />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <button
          ref={addToggle}
          type="button"
          aria-expanded={adding}
          aria-controls={`${manageId}-add`}
          aria-label={t("studies.sections.addToggleLabel", { title })}
          onClick={() => setAdding(!adding)}
          className={tool}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t("studies.sections.addToggle")}
        </button>
        {adding && (
          <div id={`${manageId}-add`} role="group" aria-label={t("studies.sections.addTo", { title })} className="flex flex-wrap items-center gap-1">
            {BLOCK_TYPES.map((type) => (
              <Button key={type} variant="quiet" className="min-h-9 text-[0.875rem] text-text-muted" onClick={() => addBlock(type)}>
                {t("studies.blocks.add", { type: blockLabel(t, type) })}
              </Button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="m-0 mt-2 text-[0.9375rem] text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function RenameForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(title);
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        aria-label={t("studies.sections.titleLabel")}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        className="h-11 min-w-0 flex-1 rounded-aw border border-border bg-bg px-3 font-display text-[1.375rem] font-heading text-text-strong"
      />
      <Button type="submit" variant="primary">
        {t("common.save")}
      </Button>
      <Button onClick={onCancel}>{t("common.cancel")}</Button>
    </form>
  );
}
