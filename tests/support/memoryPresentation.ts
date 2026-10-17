// In-memory Presentation & Delivery (v0.18) for interface tests. Mirrors the
// core's rules (db/presentations.rs, presentation/document.rs): items follow
// the teaching live; the proposal is made by fixed rules; the audience
// document has no speaker text; exports are recorded, never written.
import { ApiError, type Api } from "@/lib/api";
import type {
  AudienceDocument,
  AudienceSlide,
  AudienceState,
  ExportFormat,
  ExportOptions,
  ItemKind,
  ItemSource,
  Presentation,
  PresentationDocument,
  PresentationItem,
  RefInfo,
  Screen,
  Slide,
} from "@/types/presentation";
import { ITEM_KINDS, PRESENTATION_THEMES } from "@/types/presentation";
import type { TeachingPreparation } from "@/types/teaching";

export interface PresentationState {
  presentations: (Omit<Presentation, "items"> & { items: PresentationItem[]; deleted: boolean })[];
  exports: { id: string; format: ExportFormat; path: string; options: ExportOptions }[];
  /** What the next save dialog returns (null = cancelled). */
  nextSavePath: string | null;
  saveDialogs: { defaultName: string; format: ExportFormat }[];
  /** Displays a test pretends are connected; empty = no second window here. */
  screens: Screen[];
  audienceOpen: { presentationId: string; screen: number | null } | null;
  audienceShown: AudienceState[];
  audienceHandlers: ((state: AudienceState) => void)[];
  closedHandlers: (() => void)[];
  savedImages: string[];
  /** Data addresses of images available on "this computer", by asset id. */
  imageData: Map<string, string>;
}

export function newPresentationState(): PresentationState {
  return {
    presentations: [],
    exports: [],
    nextSavePath: "/home/test/Documents/Teaching.pptx",
    saveDialogs: [],
    screens: [],
    audienceOpen: null,
    audienceShown: [],
    audienceHandlers: [],
    closedHandlers: [],
    savedImages: [],
    imageData: new Map(),
  };
}

type PresentationApi = Pick<
  Api,
  | "presentationList"
  | "presentationGet"
  | "presentationCreate"
  | "presentationUpdate"
  | "presentationDelete"
  | "presentationItemCreate"
  | "presentationItemUpdate"
  | "presentationItemDelete"
  | "presentationItemReorder"
  | "presentationDocument"
  | "presentationAudience"
  | "presentationImage"
  | "presentationImageSave"
  | "choosePresentationFile"
  | "presentationExport"
  | "presentationScreens"
  | "presentationAudienceOpen"
  | "presentationAudienceShow"
  | "presentationAudienceState"
  | "presentationAudienceClose"
  | "onAudienceState"
  | "onAudienceClosed"
>;

interface Helpers {
  id: () => string;
  now: () => string;
  api: () => Api;
}

function refInfo(canonical: string): RefInfo | null {
  const [start, end = start] = canonical.split("-");
  const a = start!.split(".");
  const b = end!.split(".");
  if (!a[0] || !a[1]) return null;
  return {
    canonical,
    book: a[0],
    startChapter: Number(a[1]),
    startVerse: a[2] ? Number(a[2]) : null,
    endChapter: Number(b[1] ?? a[1]),
    endVerse: b[2] ? Number(b[2]) : a[2] && !b[1] ? Number(a[2]) : null,
  };
}

const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export function presentationApi(state: PresentationState, h: Helpers): PresentationApi {
  const find = (id: string) => {
    const p = state.presentations.find((x) => x.id === id && !x.deleted);
    if (!p) throw new ApiError("notFound", "This presentation could not be found. It may have been deleted.");
    return p;
  };
  const owner = (itemId: string) => {
    const p = state.presentations.find((x) => !x.deleted && x.items.some((i) => i.id === itemId));
    if (!p) throw new ApiError("notFound", "This slide could not be found.");
    return p;
  };
  const view = (p: PresentationState["presentations"][number]): Presentation => {
    const { deleted: _deleted, ...rest } = p;
    void _deleted;
    return { ...rest, items: p.items.map((i, position) => ({ ...i, position })) };
  };
  const touch = (p: PresentationState["presentations"][number]) => {
    p.updatedAt = h.now();
    p.revision += 1;
  };
  const item = (kind: ItemKind, source: ItemSource | null, heading: string | null = null): PresentationItem => ({
    id: h.id(),
    position: 0,
    kind,
    source,
    heading,
    body: null,
    reference: null,
    notes: "",
    skipped: false,
  });

  /** The same fixed rules as the core (db/presentations.rs `propose`). */
  const propose = (prep: TeachingPreparation, labels: { introduction: string; conclusion: string }): PresentationItem[] => {
    const items = [item("title", { kind: "preparation", id: prep.id, field: "title" })];
    if (prep.introduction.trim()) items.push(item("heading", { kind: "preparation", id: prep.id, field: "introduction" }, text(labels.introduction)));
    for (const p of prep.passages.filter((x) => x.pointId === null)) items.push(item("scripture", { kind: "passage", id: p.id, field: null }));
    if (text(prep.centralMessage)) items.push(item("text", { kind: "preparation", id: prep.id, field: "central_message" }));
    const questions = prep.kind === "bible_study";
    for (const point of prep.points) {
      const images = prep.materials.filter((m) => m.pointId === point.id && m.kind === "image");
      const passages = prep.passages.filter((x) => x.pointId === point.id);
      const kind: ItemKind = point.kind === "question" ? "question" : point.kind === "activity" ? "activity" : questions && !point.kind ? "question" : "heading";
      const shownByContent = (point.kind === "scripture" && passages.length > 0) || (point.kind === "image" && images.length > 0);
      if (!shownByContent) items.push(item(kind, { kind: "point", id: point.id, field: null }));
      for (const p of passages) items.push(item("scripture", { kind: "passage", id: p.id, field: null }));
      for (const m of images) items.push(item("image", { kind: "material", id: m.id, field: null }));
    }
    if (prep.conclusion.trim()) items.push(item("heading", { kind: "preparation", id: prep.id, field: "conclusion" }, text(labels.conclusion)));
    return items;
  };

  const build = async (id: string): Promise<PresentationDocument> => {
    const p = find(id);
    const api = h.api();
    const prep = await api.teachingGet(p.preparationId);
    const bibles = (await api.bibleList()).filter((b) => b.verseCount > 0);
    const settings = await api.settingsGet();
    const bible =
      bibles.find((b) => b.id === p.translationId) ?? bibles.find((b) => b.id === settings.scriptureTranslationId) ?? bibles[0] ?? null;
    const slides: Slide[] = [];
    const warnings: PresentationDocument["warnings"] = [];
    const images = new Map<string, PresentationDocument["images"][number]>();
    if (!bible) warnings.push({ slideId: null, code: "noBible" });
    const primary = prep.passages.find((x) => x.pointId === null)?.reference.canonical ?? null;
    for (const it of p.items.filter((i) => !i.skipped)) {
      let heading: string | null = null;
      let body: string | null = null;
      let reference: string | null = null;
      let missing = false;
      const manuscript: Slide["speaker"]["manuscript"] = [];
      let image: AudienceSlide["image"] = null;
      const s = it.source;
      if (s?.kind === "preparation") {
        if (s.field === "title") {
          heading = text(prep.title);
          reference = primary;
        } else if (s.field === "central_message") body = text(prep.centralMessage);
        else if (s.field === "introduction" && text(prep.introduction)) manuscript.push({ field: "introduction", text: prep.introduction.trim() });
        else if (s.field === "conclusion" && text(prep.conclusion)) manuscript.push({ field: "conclusion", text: prep.conclusion.trim() });
      } else if (s?.kind === "point") {
        const point = prep.points.find((x) => x.id === s.id);
        if (!point) missing = true;
        else {
          for (const field of ["explanation", "application", "illustration"] as const)
            if (text(point[field])) manuscript.push({ field, text: point[field].trim() });
          if (it.kind === "question") body = text(point.title);
          else heading = text(point.title);
        }
      } else if (s?.kind === "passage") {
        const passage = prep.passages.find((x) => x.id === s.id);
        if (!passage) missing = true;
        else reference = passage.reference.canonical;
      } else if (s?.kind === "material") {
        const m = prep.materials.find((x) => x.id === s.id);
        if (!m) missing = true;
        else if (m.kind === "image") {
          const generated = m.standing === "generated";
          image = { assetId: m.id, caption: text(m.title), credit: generated ? null : text(m.image?.attribution) ?? null, generated };
          images.set(m.id, { id: m.id, mediaType: "image/png", width: 4, height: 3, available: state.imageData.has(m.id), sha256: null });
          if (!state.imageData.has(m.id)) warnings.push({ slideId: it.id, code: "imageUnavailable" });
        } else body = text(m.content);
      }
      if (missing) warnings.push({ slideId: it.id, code: "sourceMissing" });
      if (it.heading !== null) heading = text(it.heading);
      if (it.body !== null) body = text(it.body);
      if (it.reference) reference = it.reference;
      const audience: AudienceSlide = { heading, body, reference: null, verses: [], bible: null, image: null, blank: false };
      if (it.kind === "pause") {
        audience.heading = null;
        audience.body = null;
        audience.blank = true;
      } else if (it.kind === "scripture" && reference) {
        audience.reference = refInfo(reference);
        audience.bible = bible?.shortName ?? null;
        audience.verses = bible
          ? (await api.scriptureGetPassage({ translationId: bible.id, reference })).verses.map((v) => ({ chapter: v.chapter, verse: v.verse, text: v.text }))
          : [];
        if (audience.verses.length === 0) warnings.push({ slideId: it.id, code: "scriptureUnavailable" });
      } else if (it.kind === "title" && reference) audience.reference = refInfo(reference);
      if (it.kind === "image") audience.image = image;
      slides.push({
        id: it.id,
        itemId: it.id,
        index: slides.length,
        part: 1,
        parts: 1,
        kind: it.kind,
        audience,
        speaker: { manuscript, notes: it.notes.trim() },
        citations: [],
        source: it.source,
        sourceMissing: missing,
      });
    }
    return {
      format: "abiding-word/presentation",
      schemaVersion: 1,
      presentationId: p.id,
      teachingId: prep.id,
      title: p.title,
      teachingKind: prep.kind,
      theme: p.theme,
      primaryPassage: primary ? refInfo(primary) : null,
      bible: bible ? { id: bible.id, name: bible.name, shortName: bible.shortName, copyright: bible.copyrightNotice } : null,
      presentationUpdatedAt: p.updatedAt,
      teachingUpdatedAt: prep.updatedAt,
      slides,
      images: [...images.values()],
      warnings,
    };
  };

  return {
    presentationList: async (preparationId) => {
      await h.api().teachingGet(preparationId);
      return state.presentations
        .filter((p) => p.preparationId === preparationId && !p.deleted)
        .map((p) => ({ id: p.id, preparationId: p.preparationId, title: p.title, theme: p.theme, updatedAt: p.updatedAt }));
    },
    presentationGet: async (id) => view(find(id)),
    presentationCreate: async ({ preparationId, title, propose: wanted, labels }) => {
      const prep = await h.api().teachingGet(preparationId);
      const t = h.now();
      const p = {
        id: h.id(),
        preparationId,
        title: text(title) ?? prep.title,
        theme: "light" as const,
        translationId: null,
        items: wanted ? propose(prep, labels) : [item("title", { kind: "preparation", id: prep.id, field: "title" })],
        createdAt: t,
        updatedAt: t,
        revision: 1,
        deleted: false,
      };
      state.presentations.push(p);
      return view(p);
    },
    presentationUpdate: async ({ id, title, theme, translationId }) => {
      const p = find(id);
      if (title !== undefined) {
        if (!title.trim()) throw new ApiError("invalidInput", "Please give the presentation a title.");
        p.title = title.trim();
      }
      if (theme !== undefined) {
        if (!PRESENTATION_THEMES.includes(theme)) throw new ApiError("invalidInput", "Not a valid background.");
        p.theme = theme;
      }
      if (translationId !== undefined) p.translationId = translationId || null;
      touch(p);
      return view(p);
    },
    presentationDelete: async (id) => {
      find(id).deleted = true;
    },
    presentationItemCreate: async (input) => {
      const p = find(input.presentationId);
      if (!ITEM_KINDS.includes(input.kind)) throw new ApiError("invalidInput", "Not a valid kind of slide.");
      const it = { ...item(input.kind, input.source ?? null, input.heading ?? null), body: input.body ?? null, reference: input.reference ?? null };
      const at = input.afterItemId ? p.items.findIndex((i) => i.id === input.afterItemId) + 1 : p.items.length;
      p.items.splice(at, 0, it);
      touch(p);
      return view(p);
    },
    presentationItemUpdate: async (input) => {
      const p = owner(input.id);
      const it = p.items.find((i) => i.id === input.id)!;
      if (input.kind !== undefined) it.kind = input.kind;
      if (input.followHeading) it.heading = null;
      else if (input.heading !== undefined) it.heading = input.heading.trim();
      if (input.followBody) it.body = null;
      else if (input.body !== undefined) it.body = input.body;
      if (input.followReference) it.reference = null;
      else if (input.reference !== undefined) it.reference = input.reference.trim() || null;
      if (input.notes !== undefined) it.notes = input.notes;
      if (input.skipped !== undefined) it.skipped = input.skipped;
      touch(p);
      return view(p);
    },
    presentationItemDelete: async (id) => {
      const p = owner(id);
      p.items = p.items.filter((i) => i.id !== id);
      touch(p);
      return view(p);
    },
    presentationItemReorder: async ({ parentId, ids }) => {
      const p = find(parentId);
      if (ids.length !== p.items.length || !ids.every((x) => p.items.some((i) => i.id === x)))
        throw new ApiError("invalidInput", "The slides have changed since this page was shown. Please try again.");
      p.items = ids.map((x) => p.items.find((i) => i.id === x)!);
      touch(p);
      return view(p);
    },
    presentationDocument: build,
    presentationAudience: async (id): Promise<AudienceDocument> => {
      const doc = await build(id);
      return {
        format: doc.format,
        schemaVersion: doc.schemaVersion,
        presentationId: doc.presentationId,
        title: doc.title,
        theme: doc.theme,
        slides: doc.slides.map((s) => ({ id: s.id, index: s.index, kind: s.kind, audience: s.audience })),
        images: doc.images,
      };
    },
    presentationImage: async (_id, assetId) => {
      const data = state.imageData.get(assetId);
      if (!data) throw new ApiError("invalidInput", "This image is not available on this computer.");
      return data;
    },
    presentationImageSave: async ({ assetId }) => {
      state.savedImages.push(assetId);
      state.imageData.set(assetId, "data:image/png;base64,iVBORw0KGgo=");
    },
    choosePresentationFile: async ({ defaultName, format }) => {
      state.saveDialogs.push({ defaultName, format });
      return state.nextSavePath;
    },
    presentationExport: async (input) => {
      const doc = await build(input.id);
      state.exports.push(input);
      return { path: input.path, slides: doc.slides.length, missingImages: doc.images.filter((i) => !i.available).length };
    },
    presentationScreens: async () => state.screens,
    presentationAudienceOpen: async ({ presentationId, screen, state: shown }) => {
      state.audienceOpen = { presentationId, screen };
      state.audienceShown.push(shown);
    },
    presentationAudienceShow: async (shown) => {
      state.audienceShown.push(shown);
      for (const handler of state.audienceHandlers) handler(shown);
    },
    presentationAudienceState: async () => state.audienceShown.at(-1) ?? null,
    presentationAudienceClose: async () => {
      state.audienceOpen = null;
    },
    onAudienceState: async (handler) => {
      state.audienceHandlers.push(handler);
      return () => {
        state.audienceHandlers = state.audienceHandlers.filter((x) => x !== handler);
      };
    },
    onAudienceClosed: async (handler) => {
      state.closedHandlers.push(handler);
      return () => {
        state.closedHandlers = state.closedHandlers.filter((x) => x !== handler);
      };
    },
  };
}
