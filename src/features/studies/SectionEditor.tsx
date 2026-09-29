import { useState, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useSaveTracker } from "@/hooks/SaveTracker";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { BLOCK_TYPES, type BlockType, type StudySection } from "@/types/domain";
import { BLOCK_LABELS, BlockEditor } from "./BlockEditor";

interface SectionEditorProps {
  section: StudySection;
  onChange: (section: StudySection) => void;
  onRevealScripture: () => void;
}

export function SectionEditor({ section, onChange, onRevealScripture }: SectionEditorProps) {
  const api = useApi();
  const { track } = useSaveTracker();
  const [renaming, setRenaming] = useState(false);
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
          <h2 id={headingId} className="m-0 font-display text-[1.5rem] font-semibold text-text-strong">
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
        className="h-11 min-w-0 flex-1 rounded-aw border border-border bg-bg px-3 font-display text-[1.375rem] font-semibold text-text-strong"
      />
      <Button type="submit" variant="primary">
        Save
      </Button>
      <Button onClick={onCancel}>Cancel</Button>
    </form>
  );
}
