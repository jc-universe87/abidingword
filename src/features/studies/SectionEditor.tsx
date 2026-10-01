import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useSaveTracker } from "@/hooks/SaveTracker";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { BLOCK_TYPES, type BlockType, type StudySection } from "@/types/domain";
import { BLOCK_LABELS, BlockEditor } from "./BlockEditor";

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
}

const tool = "inline-flex size-9 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary disabled:opacity-40";

export function SectionEditor(props: SectionEditorProps) {
  const { section, isFirst, isLast, hasFindings, onChange, onMove, onDeleted, onRevealScripture } = props;
  const api = useApi();
  const { track, settled } = useSaveTracker();
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingId = `section-${section.id}`;

  const addBlock = async (blockType: BlockType) => {
    setError(null);
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
    <section aria-labelledby={headingId} id={`section-anchor-${section.id}`} className="scroll-mt-4 border-t border-border-subtle pt-6">
      {renaming ? (
        <RenameForm initial={section.title} onSubmit={rename} onCancel={() => setRenaming(false)} />
      ) : (
        <div className="flex items-baseline gap-2">
          <h2 id={headingId} tabIndex={-1} className="m-0 font-display text-[1.5rem] font-heading text-text-strong">
            {section.title}
          </h2>
          <button
            type="button"
            onClick={() => setRenaming(true)}
            aria-label={`Rename section ${section.title}`}
            title="Rename section"
            className="inline-flex size-9 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary"
          >
            <Pencil className="size-4" aria-hidden="true" />
          </button>
          <span className="ml-auto flex items-center">
            <button type="button" className={tool} disabled={isFirst} onClick={() => onMove(-1)} aria-label={`Move section ${section.title} up`}>
              <ArrowUp className="size-4" aria-hidden="true" />
            </button>
            <button type="button" className={tool} disabled={isLast} onClick={() => onMove(1)} aria-label={`Move section ${section.title} down`}>
              <ArrowDown className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`${tool} hover:text-danger`}
              onClick={() => void remove(false)}
              aria-label={`Delete section ${section.title}`}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </span>
        </div>
      )}
      {confirmingDelete && (
        <div role="alertdialog" aria-label={`Delete section ${section.title}?`} className="mt-2 flex flex-col gap-2 border-l-[3px] border-danger bg-bg-secondary px-4 py-3">
          <p className="m-0">
            Delete “{section.title}” and the writing in it?
            {hasFindings && " Its findings stay in the study as findings for the whole study."}
          </p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => remove(true)}>Delete section</Button>
            <Button autoFocus onClick={() => setConfirmingDelete(false)}>Keep it</Button>
          </div>
        </div>
      )}
      {section.guidance && <p className="mt-1 mb-3 text-[0.9375rem] text-text-muted">{section.guidance}</p>}

      <div className="flex flex-col gap-1">
        {section.blocks.map((block, index) => (
          <BlockEditor
            key={block.id}
            block={block}
            sectionTitle={section.title}
            placeholder={index === 0 ? "Write here…" : ""}
            onDeleted={removeBlock}
            onRevealScripture={onRevealScripture}
            isFirst={index === 0}
            isLast={index === section.blocks.length - 1}
            onMove={(delta) => moveBlock(block.id, delta)}
          />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label={`Add to ${section.title}`}>
        {BLOCK_TYPES.map((type) => (
          <Button key={type} variant="quiet" className="min-h-9 text-[0.875rem] text-text-muted" onClick={() => addBlock(type)}>
            + {BLOCK_LABELS[type]}
          </Button>
        ))}
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
  const [title, setTitle] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(title);
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        aria-label="Section title"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        className="h-11 min-w-0 flex-1 rounded-aw border border-border bg-bg px-3 font-display text-[1.375rem] font-heading text-text-strong"
      />
      <Button type="submit" variant="primary">
        Save
      </Button>
      <Button onClick={onCancel}>Cancel</Button>
    </form>
  );
}
