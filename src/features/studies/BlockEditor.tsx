import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useAutosave } from "@/hooks/useAutosave";
import { useApi } from "@/lib/ApiContext";
import type { BlockType, StudyBlock } from "@/types/domain";
import { DetectedReferences } from "./DetectedReferences";

export const BLOCK_LABELS: Record<BlockType, string> = {
  paragraph: "Paragraph",
  note: "Note",
  heading: "Heading",
  quotation: "Quotation",
  question: "Question",
};

const STYLES: Record<BlockType, string> = {
  paragraph: "reading",
  note: "reading border-l-[3px] border-accent bg-note text-[1rem]",
  heading: "font-display text-[1.375rem] font-semibold leading-snug text-text-strong",
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
}

/**
 * One editable block: a plain text area that grows with its content and
 * saves itself. Deliberately not a rich-text editor in v0.1.
 */
export function BlockEditor(props: BlockEditorProps) {
  const { block, sectionTitle, placeholder, onDeleted, onRevealScripture, isFirst, isLast, onMove } = props;
  const api = useApi();
  const [text, setText] = useState(block.content);
  const [confirming, setConfirming] = useState(false);
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

  const label = BLOCK_LABELS[block.blockType];

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
      setDeleteError("This block could not be deleted. Please try again.");
    }
  };

  return (
    <div className="group relative">
      <textarea
        ref={area}
        rows={block.blockType === "heading" ? 1 : 2}
        value={text}
        placeholder={placeholder}
        aria-label={`${sectionTitle}: ${label.toLowerCase()}`}
        onChange={(e) => {
          setText(e.target.value);
          schedule(e.target.value);
        }}
        onBlur={flush}
        className={`block w-full resize-none overflow-hidden rounded-aw border border-transparent bg-transparent px-3 py-2 pr-12 text-text placeholder:text-text-muted hover:border-border-subtle focus:border-border ${STYLES[block.blockType]}`}
      />
      <div
        className={`absolute right-1 top-1 flex items-center gap-1 transition-opacity ${
          confirming ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
      >
        {confirming ? (
          <span className="flex items-center gap-1 rounded-aw border border-border bg-bg px-2 py-1 text-[0.875rem]">
            <span>Delete this {label.toLowerCase()}?</span>
            <button type="button" onClick={remove} className="rounded px-2 py-1 font-medium text-danger hover:bg-bg-secondary">
              Delete
            </button>
            {/* Focus lands on the safe choice when the question appears. */}
            <button
              type="button"
              autoFocus
              onClick={() => setConfirming(false)}
              className="rounded px-2 py-1 hover:bg-bg-secondary"
            >
              Keep
            </button>
          </span>
        ) : (
          <>
          {!(isFirst && isLast) && (
            <>
              <button type="button" disabled={isFirst} onClick={() => onMove(-1)} aria-label={`Move ${label.toLowerCase()} up in ${sectionTitle}`} className="inline-flex size-9 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary disabled:opacity-40">
                <ArrowUp className="size-4" aria-hidden="true" />
              </button>
              <button type="button" disabled={isLast} onClick={() => onMove(1)} aria-label={`Move ${label.toLowerCase()} down in ${sectionTitle}`} className="inline-flex size-9 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary disabled:opacity-40">
                <ArrowDown className="size-4" aria-hidden="true" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={remove}
            aria-label={`Delete ${label.toLowerCase()} in ${sectionTitle}`}
            title={`Delete ${label.toLowerCase()}`}
            className="inline-flex size-9 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary hover:text-danger"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
          </>
        )}
      </div>
      <DetectedReferences text={text} onOpen={onRevealScripture} />
      {deleteError && (
        <p role="alert" className="m-0 px-3 text-[0.9375rem] text-danger">
          {deleteError}
        </p>
      )}
    </div>
  );
}
