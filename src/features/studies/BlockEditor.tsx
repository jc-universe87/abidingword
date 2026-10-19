import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, MoreHorizontal, Trash2 } from "lucide-react";
import { useAutosave } from "@/hooks/useAutosave";
import { useApi } from "@/lib/ApiContext";
import type { BlockType, StudyBlock } from "@/types/domain";
import { DetectedReferences } from "./DetectedReferences";
import { blockInline } from "./labels";

const STYLES: Record<BlockType, string> = {
  paragraph: "reading",
  note: "reading border-l-[3px] border-accent bg-note text-[1rem]",
  heading: "font-display text-[1.25rem] font-heading leading-snug text-text-strong",
  quotation: "reading italic border-l-[3px] border-border pl-4",
  question: "reading border-l-[3px] border-link",
};

interface BlockEditorProps {
  block: StudyBlock;
  sectionTitle: string;
  placeholder: string;
  onDeleted: (blockId: string) => void;
  onRevealScripture: () => void;
  isFirst: boolean;
  isLast: boolean;
  onMove: (delta: -1 | 1) => void;
  /** Just added: put the cursor in it. */
  autoFocus?: boolean;
  /** Tells the page whether this block has writing in it right now (before it is saved). */
  onContent?: (blockId: string, hasContent: boolean) => void;
}

/**
 * One editable block: a plain text area that grows with its content and
 * saves itself. Deliberately not a rich-text editor in v0.1.
 */
export function BlockEditor(props: BlockEditorProps) {
  const { block, sectionTitle, placeholder, onDeleted, onRevealScripture, isFirst, isLast, onMove, autoFocus = false, onContent } = props;
  const { t } = useTranslation();
  const api = useApi();
  const [text, setText] = useState(block.content);
  const [confirming, setConfirming] = useState(false);
  const [managing, setManaging] = useState(false);
  const manageId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const save = useCallback(
    (content: string) => api.studyBlockUpdate({ id: block.id, content }),
    [api, block.id],
  );
  const { schedule, flush } = useAutosave(save);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useLayoutEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  const type = blockInline(t, block.blockType);

  const remove = async () => {
    if (text.trim() && !confirming) {
      setConfirming(true);
      return;
    }
    try {
      await api.studyBlockDelete(block.id);
      onDeleted(block.id);
    } catch {
      setConfirming(false);
      setDeleteError(t("studies.blocks.deleteFailed"));
    }
  };

  const tool = "inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-bg-secondary hover:text-text-strong disabled:opacity-40";
  const single = isFirst && isLast;

  return (
    <div
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && managing) {
          e.stopPropagation();
          setManaging(false);
          toggle.current?.focus();
        }
      }}
    >
      <textarea
        ref={area}
        rows={block.blockType === "heading" ? 1 : 2}
        value={text}
        placeholder={placeholder}
        aria-label={t("studies.blocks.fieldLabel", { section: sectionTitle, type })}
        onChange={(e) => {
          setText(e.target.value);
          onContent?.(block.id, e.target.value.trim().length > 0);
          schedule(e.target.value);
        }}
        onBlur={flush}
        className={`block w-full resize-none overflow-hidden rounded-aw border border-transparent border-b-border-subtle bg-transparent px-3 py-2 pr-14 text-text placeholder:text-text-muted hover:border-border-subtle focus:border-border ${STYLES[block.blockType]}`}
      />
      <button
        ref={toggle}
        type="button"
        aria-expanded={managing}
        aria-controls={manageId}
        aria-label={t("studies.blocks.options", { type, section: sectionTitle })}
        title={t("studies.blocks.optionsTooltip")}
        onClick={() => setManaging(!managing)}
        className="absolute right-1 top-0 inline-flex size-11 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary hover:text-text-strong"
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </button>
      {managing && (
        <div id={manageId} role="group" aria-label={t("studies.blocks.optionsGroup", { type, section: sectionTitle })} className="mt-1 flex flex-wrap items-center gap-1">
          {!single && (
            <>
              <button type="button" disabled={isFirst} onClick={() => onMove(-1)} aria-label={t("studies.blocks.moveUp", { type, section: sectionTitle })} className={tool}>
                <ArrowUp className="size-4" aria-hidden="true" />
              </button>
              <button type="button" disabled={isLast} onClick={() => onMove(1)} aria-label={t("studies.blocks.moveDown", { type, section: sectionTitle })} className={tool}>
                <ArrowDown className="size-4" aria-hidden="true" />
              </button>
            </>
          )}
          {confirming ? (
            <span className="flex flex-wrap items-center gap-1 rounded-aw border border-border bg-bg px-2 py-1 text-[0.9375rem]">
              <span>{t("studies.blocks.confirmDelete", { type })}</span>
              <button type="button" onClick={remove} className="min-h-11 rounded px-2 font-medium text-danger hover:bg-bg-secondary">
                {t("common.delete")}
              </button>
              {/* Focus lands on the safe choice when the question appears. */}
              <button type="button" autoFocus onClick={() => setConfirming(false)} className="min-h-11 rounded px-2 hover:bg-bg-secondary">
                {t("common.keep")}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={remove}
              aria-label={t("studies.blocks.delete", { type, section: sectionTitle })}
              title={t("studies.blocks.deleteTooltip", { type })}
              className={`${tool} hover:text-danger`}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t("common.delete")}
            </button>
          )}
        </div>
      )}
      <DetectedReferences text={text} onOpen={onRevealScripture} />
      {deleteError && (
        <p role="alert" className="m-0 px-3 text-[0.9375rem] text-danger">
          {deleteError}
        </p>
      )}
    </div>
  );
}
