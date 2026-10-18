// In-memory church templates (v0.18.1) for interface tests and screenshots.
// Mirrors db/presentation_templates.rs and the commands; the PowerPoint
// import returns the real core's result for the corpus file
// (importedTemplate.json, written by `cargo test --test template_import
// write_interface_fixture -- --ignored`). Pages are laid out by a simple
// stand-in for presentation/layout.rs: positions follow the template, line
// breaks are estimated.
import { ApiError, type Api } from "@/lib/api";
import type { AudienceSlide, ItemKind } from "@/types/presentation";
import type {
  ImportedTemplate,
  InstalledFont,
  Page,
  PageBlock,
  PresentationTemplate,
  RoleLayout,
  TemplateDefinition,
  TextFrame,
} from "@/types/presentationTemplate";
import imported from "./importedTemplate.json";

export interface TemplateState {
  templates: (PresentationTemplate & { deleted: boolean })[];
  /** What the next open dialog returns (null = cancelled). */
  nextTemplateFile: string | null;
  nextTemplateSave: string | null;
  exportedTemplates: { id: string; path: string }[];
  fonts: InstalledFont[];
  layoutCalls: number;
}

export function newTemplateState(): TemplateState {
  return {
    templates: [],
    nextTemplateFile: "/home/test/Documents/Grace Church.pptx",
    nextTemplateSave: "/home/test/Documents/Grace Church.awtemplate",
    exportedTemplates: [],
    fonts: [
      { family: "Calibri", bold: false, italic: false, embeddable: true },
      { family: "Calibri", bold: false, italic: true, embeddable: true },
      { family: "Calibri Light", bold: false, italic: false, embeddable: true },
      { family: "Georgia", bold: false, italic: false, embeddable: true },
      { family: "Montserrat", bold: false, italic: false, embeddable: true },
      { family: "Montserrat", bold: true, italic: false, embeddable: true },
    ],
    layoutCalls: 0,
  };
}

export const IMPORTED = imported as unknown as ImportedTemplate;

type TemplateApi = Pick<
  Api,
  | "presentationTemplateList"
  | "presentationTemplateGet"
  | "presentationTemplateCreate"
  | "presentationTemplateUpdate"
  | "presentationTemplateDelete"
  | "presentationTemplateAssetAdd"
  | "presentationTemplateAsset"
  | "presentationTemplateExport"
  | "presentationTemplateImportPackage"
  | "presentationTemplateImportPptx"
  | "onTemplateImportProgress"
  | "presentationFonts"
  | "presentationTemplatePreview"
  | "chooseTemplateFile"
  | "chooseTemplateSaveFile"
>;

/** A soft gradient as a picture, for every kept template image. */
export const TEMPLATE_PICTURE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 36"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#28405f"/><stop offset="1" stop-color="#8aa4c8"/></linearGradient></defs><rect width="64" height="36" fill="url(#g)"/><path d="M30 6h4v24h-4zM22 13h20v4H22z" fill="#f4f1ea" opacity="0.85"/></svg>',
  );

export function templateApi(state: TemplateState, h: { id: () => string; now: () => string; onDelete: (id: string) => void }): TemplateApi {
  const find = (id: string) => {
    const t = state.templates.find((x) => x.id === id && !x.deleted);
    if (!t) throw new ApiError("notFound", "This template could not be found.");
    return t;
  };
  const strip = ({ deleted: _d, ...t }: TemplateState["templates"][number]): PresentationTemplate => {
    void _d;
    return structuredClone(t);
  };
  const check = (def: TemplateDefinition) => {
    if (def.width < 100 || def.width > 4000 || def.height < 100 || def.height > 4000) throw new ApiError("invalidInput", "This template's page size cannot be used.");
  };
  return {
    presentationTemplateList: async () =>
      state.templates
        .filter((t) => !t.deleted)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ id: t.id, name: t.name, description: t.description, width: t.definition.width, height: t.definition.height, sourceFormat: t.sourceFormat, updatedAt: t.updatedAt })),
    presentationTemplateGet: async (id) => strip(find(id)),
    presentationTemplateCreate: async (input) => {
      if (!input.name.trim()) throw new ApiError("invalidInput", "Please give the template a name.");
      check(input.definition);
      const t = h.now();
      const created = {
        id: h.id(),
        name: input.name.trim(),
        description: input.description.trim(),
        definition: structuredClone(input.definition),
        sourceFormat: input.sourceFormat,
        sourceName: input.sourceName ?? null,
        report: (input.report as PresentationTemplate["report"]) ?? null,
        createdAt: t,
        updatedAt: t,
        revision: 1,
        deleted: false,
      };
      state.templates.push(created);
      return strip(created);
    },
    presentationTemplateUpdate: async ({ id, name, description, definition }) => {
      const t = find(id);
      if (name !== undefined) {
        if (!name.trim()) throw new ApiError("invalidInput", "Please give the template a name.");
        t.name = name.trim();
      }
      if (description !== undefined) t.description = description.trim();
      if (definition !== undefined) {
        check(definition);
        t.definition = structuredClone(definition);
      }
      t.updatedAt = h.now();
      t.revision += 1;
      return strip(t);
    },
    presentationTemplateDelete: async (id) => {
      find(id).deleted = true;
      h.onDelete(id);
    },
    presentationTemplateAssetAdd: async (path) => ({
      id: (h.id().replace(/-/g, "") + "0".repeat(64)).slice(0, 64),
      mediaType: "image/png",
      width: 640,
      height: 360,
      name: path.split("/").pop() ?? "image.png",
    }),
    presentationTemplateAsset: async () => TEMPLATE_PICTURE,
    presentationTemplateExport: async (input) => {
      find(input.id);
      state.exportedTemplates.push(input);
    },
    presentationTemplateImportPackage: async (path) => {
      const t = h.now();
      const created = {
        id: h.id(),
        name: "Grace Church Sunday",
        description: "",
        definition: structuredClone(IMPORTED.definition),
        sourceFormat: "package" as const,
        sourceName: path.split("/").pop() ?? null,
        report: null,
        createdAt: t,
        updatedAt: t,
        revision: 1,
        deleted: false,
      };
      state.templates.push(created);
      return strip(created);
    },
    presentationTemplateImportPptx: async (path) => {
      if (!path.toLowerCase().endsWith(".pptx")) throw new ApiError("invalidInput", "This file is not a PowerPoint presentation (.pptx) that can be read.");
      return structuredClone(IMPORTED);
    },
    onTemplateImportProgress: async () => () => undefined,
    presentationFonts: async () => state.fonts,
    presentationTemplatePreview: async ({ definition, slides }) => {
      check(definition);
      return slides.map((s) => memoryPage(definition, s.kind, s.audience));
    },
    chooseTemplateFile: async () => state.nextTemplateFile,
    chooseTemplateSaveFile: async () => state.nextTemplateSave,
  };
}

// --- A simple stand-in for the core's page layout ---

const roleFor = (kind: ItemKind): string => (["title", "section", "heading", "scripture", "quote", "question", "image", "text", "pause"].includes(kind) ? kind : "custom");

function colour(def: TemplateDefinition, name: string): string {
  if (name === "text" || name === "muted" || name === "accent") return def.colors[name];
  return /^#[0-9a-fA-F]{6}$/.test(name) ? name : def.colors.text;
}

function family(def: TemplateDefinition, font: string): string | null {
  const pick = font === "heading" ? def.fonts.heading : font === "body" || !font ? def.fonts.body : (def.fonts.others.find((o) => o.family === font) ?? { family: font, replacement: null });
  const f = pick.replacement?.trim() || pick.family;
  return f.trim() ? f : null;
}

function wrap(text: string, size: number, width: number): string[] {
  const per = Math.max(1, Math.floor(width / (size * 0.5)));
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + " " + word).length > per) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}

function framed(def: TemplateDefinition, text: string, f: TextFrame): PageBlock {
  const [l, t, r, b] = f.inset;
  const iw = Math.max(1, f.w - l - r);
  const ih = Math.max(1, f.h - t - b);
  let size = f.size;
  let lines = wrap(text, size, iw);
  while (f.fit === "shrink" && lines.length * size * f.lineSpacing > ih && size > f.minSize) {
    size = Math.max(f.minSize, size - 1);
    lines = wrap(text, size, iw);
  }
  const used = lines.length * size * f.lineSpacing;
  const overflow = used > ih + 0.5;
  const y = !overflow && f.valign === "middle" ? f.y + t + (ih - used) / 2 : !overflow && f.valign === "bottom" ? f.y + t + ih - used : f.y + t;
  return {
    type: "text",
    x: f.x + l,
    y,
    w: iw,
    h: ih,
    size,
    bold: f.bold,
    italic: f.italic,
    color: colour(def, f.color),
    family: family(def, f.font),
    align: f.align,
    line: f.lineSpacing,
    paragraphs: text.split("\n"),
    lines,
    frame: { x: f.x, y: f.y, w: f.w, h: f.h, inset: f.inset, valign: f.valign, shrink: f.fit === "shrink" },
    overflow,
  };
}

function slots(kind: ItemKind, a: AudienceSlide) {
  const verses = a.verses.map((v) => `${v.verse} ${v.text}`).join(" ");
  const refText = a.referenceLabel ?? (a.reference ? a.reference.canonical : null);
  switch (kind) {
    case "scripture":
      return { title: a.heading, reference: refText ? (a.bible ? `${refText} (${a.bible})` : refText) : null, body: verses || a.body };
    case "quote":
      return { title: null, reference: a.heading ? `— ${a.heading}` : null, body: a.body ? `“${a.body}”` : null };
    case "title":
    case "section":
      return { title: a.heading, reference: refText, body: a.body };
    default:
      return { title: a.heading, reference: null, body: a.body };
  }
}

export function memoryPage(def: TemplateDefinition, kind: ItemKind, audience: AudienceSlide): Page {
  const role = roleFor(kind) as keyof TemplateDefinition["roles"];
  const layout: RoleLayout | undefined = def.roles[role] ?? (role !== "pause" ? def.roles.custom : undefined);
  const bg = layout?.background ?? def.background;
  const blocks: PageBlock[] = [];
  if (bg.image) blocks.push({ type: "picture", assetId: bg.image.assetId, x: 0, y: 0, w: def.width, h: def.height, crop: bg.image.crop, opacity: 1 });
  for (const r of layout?.rects ?? []) blocks.push({ type: "rect", x: r.x, y: r.y, w: r.w, h: r.h, fill: r.fill, fillOpacity: r.fillOpacity ?? 1, line: r.line, lineWidth: r.lineWidth });
  for (const d of layout?.decorations ?? []) blocks.push({ type: "picture", assetId: d.assetId, x: d.x, y: d.y, w: d.w, h: d.h, crop: d.crop, opacity: d.opacity ?? 1 });
  for (const label of layout?.labels ?? []) if (label.text.trim()) blocks.push(framed(def, label.text.trim(), label.frame));
  if (!(audience.blank || kind === "pause")) {
    const s = slots(kind, audience);
    if (layout && (layout.title || layout.body)) {
      const refBox = layout.reference ?? (!s.title ? layout.title : null) ?? (!s.body ? layout.body : null);
      if (s.title && layout.title) blocks.push(framed(def, s.title, layout.title));
      if (s.reference && refBox) blocks.push(framed(def, s.reference, refBox));
      if (s.body && layout.body) blocks.push(framed(def, s.body, layout.body));
    } else {
      const pad = def.width / 15;
      let y = pad;
      const add = (text: string | null, size: number, bold: boolean, color: string) => {
        if (!text) return;
        const lines = wrap(text, size, def.width - 2 * pad);
        blocks.push({ type: "text", x: pad, y, w: def.width - 2 * pad, h: lines.length * size * 1.25, size, bold, italic: false, color, family: family(def, bold ? "heading" : "body"), align: "left", line: 1.25, paragraphs: [text], lines, frame: null, overflow: false });
        y += lines.length * size * 1.25 + size / 2;
      };
      add(s.title, 40, true, def.colors.text);
      add(s.reference, 28, true, def.colors.accent);
      add(s.body, 30, false, def.colors.text);
    }
  }
  if (def.logo && !layout?.hideLogo) blocks.push({ type: "picture", assetId: def.logo.assetId, x: def.logo.x, y: def.logo.y, w: def.logo.w, h: def.logo.h, crop: def.logo.crop, opacity: def.logo.opacity ?? 1 });
  if (def.footer && !layout?.hideFooter && def.footer.text.trim()) blocks.push(framed(def, def.footer.text.trim(), def.footer.frame));
  return { width: def.width, height: def.height, background: bg.color ?? def.colors.background, blocks };
}
