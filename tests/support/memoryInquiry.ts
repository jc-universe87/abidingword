// In-memory study and research help (v0.20) for interface tests. Mirrors the
// core's rules (src-tauri/src/assistant/inquiry/): what would be sent is
// listed block by block with a fingerprint; asking is refused when it has
// changed; source words are checked against the stored text; nothing changes
// until the person keeps a note. Answers are scripted by the test.
import { ApiError, type Api } from "@/lib/api";
import type { InquiryInput, InquiryReply, SharedBlock } from "@/types/inquiry";
import type { Source, SourceSegment } from "@/types/library";
import type { StudyBlock, StudySection } from "@/types/domain";
import type { StudyPassage } from "@/types/scripture";
import type { Finding } from "@/types/studies";
import type { AssistantConfig } from "@/types/teaching";

export interface InquiryState {
  /** What the assistant answers, in order. */
  replies: (InquiryReply | ApiError)[];
  asked: { input: InquiryInput; fingerprint: string }[];
  previews: InquiryInput[];
  /** When set, asking waits for it. */
  hold: Promise<void> | null;
}

export function newInquiryState(): InquiryState {
  return { replies: [], asked: [], previews: [], hold: null };
}

interface Helpers {
  config: () => AssistantConfig;
  label: () => string;
  remote: () => boolean;
  hasKey: () => boolean;
  study: (id: string) => { id: string; title: string };
  sections: () => StudySection[];
  blocks: () => StudyBlock[];
  findings: () => Finding[];
  passages: () => StudyPassage[];
  source: (id: string) => Source;
  segments: (sourceId: string) => SourceSegment[];
  api: () => Api;
}

type InquiryApi = Pick<Api, "inquiryPreview" | "inquiryAsk" | "inquiryKeep">;

/** A refusal, as the core words it (the code is the core's message key). */
const fail = (code: string, message: string) => new ApiError("assistant", message, code);

/** A plain stand-in for SHA-256: equal input, equal fingerprint. */
function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function inquiryApi(state: InquiryState, h: Helpers): InquiryApi {
  const blocks = (input: InquiryInput): SharedBlock[] => {
    const c = h.config();
    if (!c.enabled) throw fail("assistant.off", "The assistant is turned off. You can turn it on in Settings.");
    const out: SharedBlock[] = [];
    const counts: Record<string, number> = {};
    const push = (kind: SharedBlock["kind"], label: string, text: string, extra: Partial<SharedBlock> = {}) => {
      const letter = { scripture: "P", writing: "W", note: "N", quote: "Q", source: "S", request: "R" }[kind];
      counts[letter] = (counts[letter] ?? 0) + 1;
      out.push({ id: `${letter}${counts[letter]}`, kind, label, text, reference: null, translation: null, sourceId: null, location: null, ...extra });
    };
    const excerpt = (e: { sourceId: string; start: { segmentId: string; offset: number }; end: { segmentId: string; offset: number }; quote: string }) => {
      const source = h.source(e.sourceId);
      const all = h.segments(source.id);
      const first = all.find((s) => s.id === e.start.segmentId);
      const last = all.find((s) => s.id === e.end.segmentId);
      const changed = new ApiError("invalidInput", "The selected words do not match the text of this source.");
      if (!first || !last || last.position < first.position) throw changed;
      const line = all.filter((s) => s.position >= first.position && s.position <= last.position);
      const joined = line.map((s) => s.text).join("\n");
      if (joined.slice(e.start.offset, joined.length - (last.text.length - e.end.offset)) !== e.quote) throw changed;
      const paragraphs = first.position === last.position ? `paragraph ${first.position + 1}` : `paragraphs ${first.position + 1}–${last.position + 1}`;
      const location = [first.sectionPath, first.pageNumber !== null ? `p. ${first.pageNumber}` : null, paragraphs].filter(Boolean).join(" · ");
      const name = source.author ? `“${source.title}” by ${source.author}` : `“${source.title}”`;
      push("source", `${name} — ${location}`, e.quote, { sourceId: source.id, location });
    };
    const scripture = (studyId: string) => {
      const primary = h.passages().find((p) => p.studyId === studyId && p.role === "primary");
      if (primary) push("scripture", primary.reference.display, `${primary.reference.display} (text)`, { reference: primary.reference, translation: "TEST" });
    };
    const scope = input.scope;
    const request = (input.request ?? "").trim();
    if (scope.kind === "study") {
      const study = h.study(scope.studyId);
      scripture(study.id);
      const section = h.sections().find((s) => s.id === scope.sectionId);
      const part = section ? ` — part “${section.title}”` : "";
      const text = (scope.text ?? "").trim();
      const selected = (scope.selected ?? "").trim();
      if (scope.blockId) {
        if (selected) {
          if (!text.includes(selected)) throw fail("inquiry.selectionChanged", "The selected words are no longer in the text. Select them again.");
          push("writing", `Words you selected in your writing${part}`, selected);
          if (selected !== text) push("writing", `Your writing they are in${part}`, text);
        } else if (text) push("writing", `Your writing${part}`, text);
      }
      const notes = h.findings().filter((f) => f.studyId === study.id);
      const focus = scope.findingId ? notes.find((f) => f.id === scope.findingId) : undefined;
      if (scope.findingId && !focus) throw new ApiError("notFound", "This note could not be found.");
      if (focus) push("note", `Your note (${focus.findingType.replace("_", " ")})${part}`, focus.content);
      if (selected && !scope.blockId) throw fail("inquiry.selectionChanged", "The selected words are no longer in the text. Select them again.");
      if (!scope.blockId && !focus && section)
        for (const b of h.blocks().filter((b) => b.sectionId === section.id)) {
          const shown = scope.writing?.find((w) => w.blockId === b.id)?.text ?? b.content;
          if (shown.trim()) push("writing", `Your writing${part}`, shown.trim());
        }
      if (section)
        for (const f of notes.filter((f) => f.sectionId === section.id && f.id !== focus?.id && f.content.trim()).slice(0, 8 - (focus ? 1 : 0)))
          push("note", `Another of your notes in this part (${f.findingType.replace("_", " ")})`, f.content);
      const wording = input.action === "clarify" || input.action === "grammar";
      if (wording && !out.some((b) => b.kind === "writing")) throw fail("assistant.writeFirst", "Write something here first. The assistant helps with what you have written.");
      if (input.action === "expression" && !selected) throw fail("inquiry.selectWords", "Select the words you would like to understand first.");
      if (input.action === "unresolved" && !focus) throw fail("inquiry.chooseNote", "Choose the question you recorded.");
      if (["understand", "context", "readings", "related", "follows", "overlooked", "assumptions"].includes(input.action) && !out.some((b) => b.kind === "scripture"))
        throw fail("inquiry.noPassage", "Choose the passage of this Bible Study first: the help starts from the text.");
    } else if (scope.kind === "source") {
      excerpt(scope.excerpt);
      if (scope.studyId) {
        scripture(scope.studyId);
        for (const f of h.findings().filter((f) => f.studyId === scope.studyId && f.content.trim()).slice(0, 6))
          push("note", `Your note (${f.findingType.replace("_", " ")}) in your Bible Study “${h.study(scope.studyId).title}”`, f.content);
      } else if (input.action === "relate_study") throw fail("inquiry.chooseStudy", "Include a Bible Study to relate this passage to.");
    } else {
      if (scope.excerpts.length < 2 || scope.excerpts.length > 3) throw fail("inquiry.compareCount", "Choose two or three passages to compare.");
      scope.excerpts.forEach(excerpt);
    }
    if (request) push("request", "Your question", request);
    if (input.action === "free" && !request) throw fail("assistant.sayWhat", "Say in a few words what you are looking for.");
    return out;
  };
  const fingerprint = (input: InquiryInput, shared: SharedBlock[]) => hash(`${h.label()}|${input.action}|${JSON.stringify(shared)}`);

  return {
    inquiryPreview: async (input) => {
      const shared = blocks(input);
      state.previews.push(input);
      return {
        remote: h.remote(),
        assistant: h.label(),
        blocks: shared,
        sourceText: shared.some((b) => b.kind === "source" || b.kind === "quote"),
        searches: false,
        fingerprint: fingerprint(input, shared),
      };
    },
    inquiryAsk: async (input, seen) => {
      const shared = blocks(input);
      if (fingerprint(input, shared) !== seen)
        throw fail("inquiry.changed", "What would be sent has changed since you looked. Please look at it again before asking.");
      if (!h.hasKey()) throw fail("assistant.noKey", "The assistant needs its key. You can add it in Settings.");
      state.asked.push({ input, fingerprint: seen });
      if (state.hold) await state.hold;
      const next = state.replies.shift();
      if (!next) throw new ApiError("assistant", "The assistant service could not answer this time. Please try again.");
      if (next instanceof ApiError) throw next;
      return next;
    },
    inquiryKeep: async (input) => {
      const content = input.content.trim();
      if (!content) throw new ApiError("invalidInput", "Write something to add first.");
      if ((input.citations ?? []).length > 3) throw new ApiError("invalidInput", "A note can cite at most three passages.");
      const api = h.api();
      const [first, ...rest] = input.citations ?? [];
      const note = first
        ? await api.findingCreateFromSource({ studyId: input.studyId, sectionId: input.sectionId ?? undefined, findingType: input.findingType, content, ...first })
        : await api.findingCreate({ studyId: input.studyId, sectionId: input.sectionId ?? undefined, findingType: input.findingType, content });
      const stored = h.findings().find((f) => f.id === note.id)!;
      for (const c of rest) {
        const extra = await api.findingCreateFromSource({ studyId: input.studyId, findingType: input.findingType, content, ...c });
        const temp = h.findings().find((f) => f.id === extra.id)!;
        stored.sources.push(...temp.sources.map((s) => ({ ...s, findingId: stored.id })));
        h.findings().splice(h.findings().indexOf(temp), 1);
      }
      stored.assistedBy = input.assistant;
      return { ...stored, sources: [...stored.sources] };
    },
  };
}
