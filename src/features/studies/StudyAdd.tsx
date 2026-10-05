import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/design-system/Button";
import { BLOCK_TYPES, type BlockType } from "@/types/domain";
import { blockLabel } from "./labels";

interface StudyAddProps {
  /** Nothing written yet: the choices are shown openly, once, instead of behind the button. */
  empty: boolean;
  /** Where a text block goes (the section last worked in, else the last one); null: there is no section. */
  targetSection: string | null;
  onAddNote: () => void;
  onAddSection: () => void;
  onAddBlock: (type: BlockType) => void;
}

/**
 * The study's one Add action. It opens a short list: a note (a finding), a
 * section, and a text block, which opens its own few kinds. A new study shows
 * the list open, with a line to begin; afterwards it is one "Add" button.
 * Escape closes the inner list first, then the whole, returning focus to Add.
 */
export function StudyAdd({ empty, targetSection, onAddNote, onAddSection, onAddBlock }: StudyAddProps) {
  const { t } = useTranslation();
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const blocksToggle = useRef<HTMLButtonElement>(null);
  const [opened, setOpen] = useState(false);
  const [blocks, setBlocks] = useState(false);
  // A new study shows its beginnings; once there is writing the list is put away until asked for.
  const open = opened || empty;

  const choose = (action: () => void) => {
    setOpen(false);
    setBlocks(false);
    action();
  };
  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        if (blocks) {
          e.stopPropagation();
          setBlocks(false);
          blocksToggle.current?.focus();
        } else if (opened) {
          e.stopPropagation();
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      {empty && <p className="m-0 text-[1.0625rem] text-text-strong">{t("studies.editor.start")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button ref={toggle} className="min-h-11" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!opened)}>
          <Plus className="size-4" aria-hidden="true" />
          {t("studies.add.toggle")}
        </Button>
        {open && (
          <div id={id} role="group" aria-label={t("studies.add.group")} className="flex flex-wrap items-center gap-2">
            <Button variant="quiet" className="min-h-11" autoFocus={opened && !empty} onClick={() => choose(onAddNote)}>
              {t("studies.add.note")}
            </Button>
            <Button variant="quiet" className="min-h-11" onClick={() => choose(onAddSection)}>
              {t("studies.add.section")}
            </Button>
            {targetSection !== null && (
              <Button ref={blocksToggle} variant="quiet" className="min-h-11" aria-expanded={blocks} onClick={() => setBlocks(!blocks)}>
                {blocks ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                {t("studies.add.textBlock")}
              </Button>
            )}
          </div>
        )}
      </div>
      {open && blocks && targetSection !== null && (
        <div role="group" aria-label={t("studies.add.blockGroup", { section: targetSection })} className="flex flex-wrap items-center gap-2 pl-2">
          <span className="text-[0.9375rem] text-text-muted">{t("studies.add.blockIn", { section: targetSection })}</span>
          {BLOCK_TYPES.map((type) => (
            <Button key={type} variant="quiet" className="min-h-11" onClick={() => choose(() => onAddBlock(type))}>
              {blockLabel(t, type)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
