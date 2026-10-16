// In-memory Teaching Preparation and assistant (v0.16) for interface tests.
// Mirrors the core's rules (db/teaching.rs, assistant/): findings are linked
// live and never copied; Scripture is named without touching the study;
// kept material has an honest standing; the assistant never changes text,
// refuses to write without the person's material, and is scripted by the test.
import { ApiError, type Api } from "@/lib/api";
import { isLocalAddress } from "@/lib/localAddress";
import type { ScriptureRef, StudyPassage } from "@/types/scripture";
import type { Finding } from "@/types/studies";
import type {
  AssistantConfig,
  AssistantSettings,
  AssistInput,
  AssistReply,
  FoundImage,
  KeepTeachingMaterial,
  SharedItem,
  TeachingMaterial,
  TeachingPreparation,
} from "@/types/teaching";

interface StoredPrep extends Omit<TeachingPreparation, "findings" | "passages" | "materials"> {
  links: { id: string; pointId: string | null; findingId: string }[];
  passages: { id: string; pointId: string | null; reference: ScriptureRef }[];
  materials: TeachingMaterial[];
}

export interface TeachingState {
  preparations: StoredPrep[];
  assistant: {
    config: AssistantConfig;
    /** provider kind or "search" → key (never returned). */
    keys: Map<string, string>;
    /** What the assistant answers, in order (a test sets these). */
    replies: (AssistReply | ApiError)[];
    /** Every request the interface made, for tests of what was asked. */
    asked: AssistInput[];
    previews: AssistInput[];
    foundImages: FoundImage[];
    findCalls: string[];
    generated: string[];
    tested: number;
    /** When set, asking, finding and making images wait for it: a test can see the waiting state. */
    hold: Promise<void> | null;
  };
}

export function defaultAssistantConfig(): AssistantConfig {
  return {
    enabled: false,
    provider: "openai",
    baseUrl: "",
    model: "",
    search: "none",
    searchUrl: "",
    findImages: true,
    generateImages: false,
    imageModel: "",
    perspective: "",
  };
}

export function newTeachingState(): TeachingState {
  return {
    preparations: [],
    assistant: {
      config: defaultAssistantConfig(),
      keys: new Map(),
      replies: [],
      asked: [],
      previews: [],
      foundImages: [],
      findCalls: [],
      generated: [],
      tested: 0,
      hold: null,
    },
  };
}

interface Helpers {
  id: () => string;
  now: () => string;
  findings: () => Finding[];
  studyExists: (studyId: string) => void;
  studyPassages: () => StudyPassage[];
  ref: (canonical: string) => ScriptureRef | null;
}

type TeachingApi = Pick<
  Api,
  | "teachingList"
  | "teachingGet"
  | "teachingCreate"
  | "teachingUpdate"
  | "teachingDelete"
  | "teachingPointCreate"
  | "teachingPointUpdate"
  | "teachingPointDelete"
  | "teachingPointReorder"
  | "teachingFindingLink"
  | "teachingFindingUnlink"
  | "teachingPassageAdd"
  | "teachingPassageRemove"
  | "teachingMaterialKeep"
  | "teachingMaterialRemove"
  | "teachingImage"
  | "assistantSettingsGet"
  | "assistantSettingsSet"
  | "assistantKeySet"
  | "assistantTest"
  | "assistantPreview"
  | "assistantAsk"
  | "assistantFindImages"
  | "assistantImagePreview"
  | "assistantGenerateImage"
>;

const NEEDS_KEY = new Set(["openai", "anthropic", "google", "xai", "perplexity", "deepseek", "qwen"]);
const LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  xai: "xAI Grok",
  perplexity: "Perplexity",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  openai_compatible: "Other compatible service",
};

export function teachingApi(state: TeachingState, h: Helpers): TeachingApi {
  const prep = (prepId: string): StoredPrep => {
    const p = state.preparations.find((x) => x.id === prepId);
    if (!p) throw new ApiError("notFound", "This teaching preparation could not be found. It may have been deleted.");
    return p;
  };
  const owner = (pointId: string): StoredPrep => {
    const p = state.preparations.find((x) => x.points.some((pt) => pt.id === pointId));
    if (!p) throw new ApiError("notFound", "This teaching point could not be found. It may have been deleted.");
    return p;
  };
  const touch = (p: StoredPrep) => {
    p.updatedAt = h.now();
    p.revision += 1;
  };
  const view = (p: StoredPrep): TeachingPreparation => {
    const live = new Map(h.findings().map((f) => [f.id, f]));
    const points = p.points.map((x, i) => ({ ...x, position: i }));
    return {
      ...p,
      points,
      findings: p.links.filter((l) => live.has(l.findingId)).map((l) => ({ id: l.id, pointId: l.pointId, finding: { ...live.get(l.findingId)! } })),
      passages: p.passages.map((x) => ({ ...x })),
      materials: p.materials.map((x) => ({ ...x })),
    };
  };
  const remote = (c: AssistantConfig) => {
    const base = c.baseUrl || { openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com/v1", google: "https://g", xai: "https://api.x.ai/v1", perplexity: "https://api.perplexity.ai", deepseek: "https://api.deepseek.com/v1", qwen: "https://q", ollama: "http://localhost:11434/v1", lmstudio: "http://localhost:1234/v1", openai_compatible: "" }[c.provider];
    return !base || !isLocalAddress(base);
  };
  const settings = (): AssistantSettings => {
    const c = state.assistant.config;
    return {
      config: { ...c },
      hasKey: state.assistant.keys.has(c.provider),
      hasSearchKey: state.assistant.keys.has("search"),
      remote: remote(c),
      canGenerateImages: c.enabled && c.generateImages && (c.provider === "openai" || c.provider === "openai_compatible"),
    };
  };
  const label = () => {
    const c = state.assistant.config;
    return c.model ? `${LABELS[c.provider]} · ${c.model}` : LABELS[c.provider]!;
  };
  const ready = (input: AssistInput) => {
    const c = state.assistant.config;
    if (!c.enabled) throw new ApiError("assistant", "The assistant is turned off. You can turn it on in Settings.");
    if (NEEDS_KEY.has(c.provider) && !state.assistant.keys.has(c.provider))
      throw new ApiError("assistant", "The assistant needs its key. You can add it in Settings.");
    const p = prep(input.preparationId);
    const text = input.text.trim();
    if (input.action === "structure" || input.action === "restructure") {
      if (p.points.filter((x) => x.title.trim() || x.explanation.trim()).length < 2)
        throw new ApiError("assistant", "Write at least two points first. The assistant comments on the structure you have.");
    } else if (input.action === "question" || input.action === "story" || input.action === "free") {
      if (!input.request?.trim()) throw new ApiError("assistant", "Say in a few words what you are looking for.");
    } else if (input.action === "visual") {
      if (!text && !input.request?.trim()) throw new ApiError("assistant", "Write something here first. The assistant helps with what you have written.");
    } else if (!text) {
      throw new ApiError("assistant", "Write something here first. The assistant helps with what you have written.");
    }
    if (input.action === "story" && c.search === "none")
      throw new ApiError("assistant", "Real stories can only be found and checked with a search service, which is not set up. You can add one in Settings, or ask for an invented illustration instead.");
    return p;
  };

  return {
    teachingList: async (studyId) => {
      h.studyExists(studyId);
      return state.preparations.filter((p) => p.studyId === studyId).map((p) => ({ id: p.id, studyId, title: p.title, kind: p.kind, updatedAt: p.updatedAt }));
    },
    teachingGet: async (prepId) => view(prep(prepId)),
    teachingCreate: async ({ studyId, title, kind }) => {
      h.studyExists(studyId);
      const name = title.trim();
      if (!name) throw new ApiError("invalidInput", "Please give the teaching a title.");
      const t = h.now();
      const p: StoredPrep = {
        id: h.id(), studyId, title: name, kind: kind ?? null, audience: null, purpose: null, centralMessage: null,
        introduction: "", conclusion: "", notes: "", points: [], links: [], passages: [], materials: [],
        createdAt: t, updatedAt: t, revision: 1,
      };
      state.preparations.push(p);
      return view(p);
    },
    teachingUpdate: async (input) => {
      const p = prep(input.id);
      if (input.title !== undefined) {
        if (!input.title.trim()) throw new ApiError("invalidInput", "Please give the teaching a title.");
        p.title = input.title.trim();
      }
      if (input.kind !== undefined) p.kind = input.kind || null;
      for (const key of ["audience", "purpose", "centralMessage"] as const) {
        const value = input[key];
        if (value !== undefined) p[key] = value.trim() || null;
      }
      for (const key of ["introduction", "conclusion", "notes"] as const) {
        const value = input[key];
        if (value !== undefined) p[key] = value;
      }
      touch(p);
      return view(p);
    },
    teachingDelete: async (prepId) => {
      prep(prepId);
      state.preparations = state.preparations.filter((p) => p.id !== prepId);
    },
    teachingPointCreate: async ({ preparationId, title, afterPointId }) => {
      const p = prep(preparationId);
      const at = afterPointId ? p.points.findIndex((x) => x.id === afterPointId) + 1 : p.points.length;
      p.points.splice(at <= 0 ? p.points.length : at, 0, { id: h.id(), position: 0, title: (title ?? "").trim(), explanation: "", application: "", illustration: "" });
      touch(p);
      return view(p);
    },
    teachingPointUpdate: async (input) => {
      const p = owner(input.id);
      const point = p.points.find((x) => x.id === input.id)!;
      if (input.title !== undefined) point.title = input.title.trim();
      for (const key of ["explanation", "application", "illustration"] as const) {
        const value = input[key];
        if (value !== undefined) point[key] = value;
      }
      touch(p);
      return view(p);
    },
    teachingPointDelete: async (pointId) => {
      const p = owner(pointId);
      p.points = p.points.filter((x) => x.id !== pointId);
      p.links = p.links.filter((l) => l.pointId !== pointId);
      p.passages = p.passages.filter((l) => l.pointId !== pointId);
      p.materials = p.materials.filter((l) => l.pointId !== pointId);
      touch(p);
      return view(p);
    },
    teachingPointReorder: async ({ parentId, ids }) => {
      const p = prep(parentId);
      const current = p.points.map((x) => x.id).sort();
      if (JSON.stringify([...ids].sort()) !== JSON.stringify(current))
        throw new ApiError("invalidInput", "The points have changed since this page was shown. Please try again.");
      p.points = ids.map((pid) => p.points.find((x) => x.id === pid)!);
      touch(p);
      return view(p);
    },
    teachingFindingLink: async ({ preparationId, pointId, findingId }) => {
      const p = prep(preparationId);
      const finding = h.findings().find((f) => f.id === findingId);
      if (!finding) throw new ApiError("notFound", "This finding could not be found. It may have been deleted.");
      if (finding.studyId !== p.studyId) throw new ApiError("invalidInput", "That finding belongs to another study.");
      const where = pointId ?? null;
      if (!p.links.some((l) => l.findingId === findingId && l.pointId === where)) p.links.push({ id: h.id(), pointId: where, findingId });
      touch(p);
      return view(p);
    },
    teachingFindingUnlink: async (linkId) => {
      const p = state.preparations.find((x) => x.links.some((l) => l.id === linkId));
      if (!p) throw new ApiError("notFound", "This link could not be found.");
      p.links = p.links.filter((l) => l.id !== linkId);
      touch(p);
      return view(p);
    },
    teachingPassageAdd: async ({ preparationId, pointId, reference }) => {
      const p = prep(preparationId);
      const ref = h.ref(reference);
      if (!ref) throw new ApiError("invalidReference", "Invalid reference.");
      const where = pointId ?? null;
      if (!p.passages.some((x) => x.pointId === where && x.reference.canonical === ref.canonical)) p.passages.push({ id: h.id(), pointId: where, reference: ref });
      touch(p);
      return view(p);
    },
    teachingPassageRemove: async (passageId) => {
      const p = state.preparations.find((x) => x.passages.some((l) => l.id === passageId));
      if (!p) throw new ApiError("notFound", "This passage could not be found.");
      p.passages = p.passages.filter((l) => l.id !== passageId);
      touch(p);
      return view(p);
    },
    teachingMaterialKeep: async (input: KeepTeachingMaterial) => {
      const p = prep(input.preparationId);
      const allowed: Record<string, string[]> = { story: ["verified", "unverified"], illustration: ["hypothetical"], image: ["found", "generated"], visual: ["suggestion"] };
      if (!allowed[input.kind]?.includes(input.standing)) throw new ApiError("invalidInput", "This item cannot be kept.");
      if (input.standing === "verified" && new Set((input.sources ?? []).map((s) => s.site)).size < 2)
        throw new ApiError("invalidInput", "A story is only kept as checked with two independent sources.");
      p.materials.push({
        id: h.id(), pointId: input.pointId ?? null, kind: input.kind, standing: input.standing, title: input.title.trim(), content: input.content.trim(),
        sources: input.sources ?? [], image: input.image ?? null, assistant: input.assistant ?? null, createdAt: h.now(),
      });
      touch(p);
      return view(p);
    },
    teachingMaterialRemove: async (materialId) => {
      const p = state.preparations.find((x) => x.materials.some((m) => m.id === materialId));
      if (!p) throw new ApiError("notFound", "This item could not be found.");
      p.materials = p.materials.filter((m) => m.id !== materialId);
      touch(p);
      return view(p);
    },
    teachingImage: async (file) => `data:image/png;base64,${btoa(file)}`,

    assistantSettingsGet: async () => settings(),
    assistantSettingsSet: async (config) => {
      if (config.baseUrl && !/^https?:\/\//i.test(config.baseUrl.trim()))
        throw new ApiError("invalidInput", "Please enter a web address beginning with http:// or https://.");
      state.assistant.config = { ...config, baseUrl: config.baseUrl.trim(), model: config.model.trim(), perspective: config.perspective.trim() };
      return settings();
    },
    assistantKeySet: async (which, key) => {
      const name = which === "search" ? "search" : state.assistant.config.provider;
      if (key.trim()) state.assistant.keys.set(name, key.trim());
      else state.assistant.keys.delete(name);
      return settings();
    },
    assistantTest: async () => {
      state.assistant.tested += 1;
      const c = state.assistant.config;
      if (NEEDS_KEY.has(c.provider) && !state.assistant.keys.has(c.provider))
        throw new ApiError("assistant", "The assistant needs its key. You can add it in Settings.");
    },
    assistantPreview: async (input) => {
      const p = ready(input);
      state.assistant.previews.push(input);
      const shared: SharedItem[] = [];
      if (input.text.trim()) shared.push({ kind: "text", label: input.part, reference: null });
      if (input.request?.trim()) shared.push({ kind: "request", label: input.request.trim(), reference: null });
      if (p.centralMessage || p.audience || p.purpose) shared.push({ kind: "teaching", label: p.title, reference: null });
      const primary = h.studyPassages().find((x) => x.studyId === p.studyId && x.role === "primary");
      if (primary) shared.push({ kind: "passage", label: primary.reference.display, reference: primary.reference });
      const linked = p.links.filter((l) => l.pointId === null || l.pointId === input.pointId).length;
      if (linked) shared.push({ kind: "finding", label: String(linked), reference: null });
      return { remote: remote(state.assistant.config), assistant: label(), shared, searches: input.action === "story" };
    },
    assistantAsk: async (input) => {
      ready(input);
      state.assistant.asked.push(input);
      if (state.assistant.hold) await state.assistant.hold;
      const next = state.assistant.replies.shift();
      if (!next) throw new ApiError("assistant", "The assistant service could not answer this time. Please try again.");
      if (next instanceof ApiError) throw next;
      return next;
    },
    assistantFindImages: async (terms) => {
      const c = state.assistant.config;
      if (!c.enabled || !c.findImages) throw new ApiError("assistant", "Finding images is turned off. You can turn it on in Settings.");
      state.assistant.findCalls.push(terms);
      if (state.assistant.hold) await state.assistant.hold;
      return state.assistant.foundImages;
    },
    assistantImagePreview: async (url) => (url.startsWith("https://upload.wikimedia.org/") ? "data:image/jpeg;base64,/9j/" : null),
    assistantGenerateImage: async (description) => {
      if (!settings().canGenerateImages)
        throw new ApiError("assistant", "Making images is not set up. You can turn it on in Settings (OpenAI image models only).");
      state.assistant.generated.push(description);
      if (state.assistant.hold) await state.assistant.hold;
      const file = `${h.id().replace(/[^0-9a-f-]/g, "")}.png`;
      return { file, dataUrl: "data:image/png;base64,iVBORw0KGgo=", assistant: `${LABELS[state.assistant.config.provider]} · gpt-image-1` };
    },
  };
}
