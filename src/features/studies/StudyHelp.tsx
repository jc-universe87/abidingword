import { useMemo, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { InquiryPanel } from "@/features/ai/InquiryPanel";
import type { StudySection } from "@/types/domain";
import { STUDY_INQUIRIES, type Inquiry, type InquiryScope } from "@/types/inquiry";
import type { Finding } from "@/types/studies";
import type { BlockHandle } from "./BlockEditor";
import { sectionTitle } from "./builtinText";
import { findingLabel } from "./labels";

interface StudyHelpProps {
  studyId: string;
  studyTitle: string;
  section: StudySection;
  /** The part's notes. */
  notes: Finding[];
  /** The part's blocks as they are on screen. */
  handles: MutableRefObject<Map<string, BlockHandle>>;
  /** The block last worked in, if any. */
  lastBlock: string | null;
  onKept: (finding: Finding) => void;
  onClose: () => void;
}

const start = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 48 ? `${flat.slice(0, 47)}…` : flat;
};

/**
 * Help with one part of a Bible Study (v0.20): the person chooses what it
 * looks at (all the part's writing, one piece of it, the words they selected,
 * or one of the part's notes) and what kind of help they want.
 */
export function StudyHelp({ studyId, studyTitle, section, notes, handles, lastBlock, onKept, onClose }: StudyHelpProps) {
  const { t } = useTranslation();
  const title = sectionTitle(section);
  // What was on screen when Help was opened: the help is about that.
  const [snapshot] = useState(() => {
    const texts = new Map<string, string>();
    for (const [id, h] of handles.current) texts.set(id, h.text());
    const last = lastBlock ? handles.current.get(lastBlock) : undefined;
    return { texts, selected: last?.selected().trim() ?? "", last: last ? lastBlock : null };
  });
  const blocks = section.blocks.filter((b) => (snapshot.texts.get(b.id) ?? b.content).trim());
  const [focus, setFocus] = useState<string>(() => {
    if (snapshot.last && snapshot.selected) return `selection:${snapshot.last}`;
    if (snapshot.last && (snapshot.texts.get(snapshot.last) ?? "").trim()) return `block:${snapshot.last}`;
    return "part";
  });
  const [kind, id] = focus.includes(":") ? (focus.split(":") as [string, string]) : [focus, ""];
  const scope = useMemo<InquiryScope>(() => {
    const base = { kind: "study" as const, studyId, sectionId: section.id };
    if (kind === "block") return { ...base, blockId: id, text: snapshot.texts.get(id) ?? "" };
    if (kind === "selection") return { ...base, blockId: id, text: snapshot.texts.get(id) ?? "", selected: snapshot.selected };
    if (kind === "note") return { ...base, findingId: id };
    return base;
  }, [kind, id, studyId, section.id, snapshot]);
  const note = kind === "note" ? notes.find((n) => n.id === id) : undefined;
  const initial: Inquiry =
    kind === "selection" ? "expression" : note && (note.findingType === "question" || note.findingType === "unresolved_issue") ? "unresolved" : "understand";
  const wording = kind === "block" || kind === "selection";
  const actions = STUDY_INQUIRIES.filter((a) => (a === "clarify" || a === "grammar" ? wording : a === "expression" ? kind === "selection" : a === "unresolved" ? kind === "note" : true));

  return (
    <InquiryPanel
      // A new focus is a new question: the panel starts again.
      key={focus}
      title={t("studies.inquiry.study.title", { part: title })}
      scope={scope}
      actions={actions}
      initialAction={initial}
      focus={
        <label className="flex flex-col gap-1">
          <span className="text-text-strong">{t("studies.inquiry.study.focus")}</span>
          <select value={focus} onChange={(e) => setFocus(e.target.value)} className="aw-input h-11 w-full min-w-0 px-2">
            <option value="part">{t("studies.inquiry.study.part")}</option>
            {snapshot.last && snapshot.selected && (
              <option value={`selection:${snapshot.last}`}>{t("studies.inquiry.study.selection", { words: start(snapshot.selected) })}</option>
            )}
            {blocks.map((b) => (
              <option key={b.id} value={`block:${b.id}`}>
                {t("studies.inquiry.study.block", { start: start(snapshot.texts.get(b.id) ?? b.content) })}
              </option>
            ))}
            {notes
              .filter((n) => n.content.trim())
              .map((n) => (
                <option key={n.id} value={`note:${n.id}`}>
                  {t("studies.inquiry.study.note", { kind: findingLabel(t, n.findingType), start: start(n.content) })}
                </option>
              ))}
          </select>
        </label>
      }
      onApplyWording={wording ? (original, suggestion) => handles.current.get(id)?.replace(original, suggestion) ?? false : undefined}
      keep={{ studyId, studyTitle, sectionId: section.id }}
      onKept={onKept}
      onClose={onClose}
    />
  );
}
