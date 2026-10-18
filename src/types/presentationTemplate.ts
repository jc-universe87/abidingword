// Church presentation templates (v0.18.1). Mirrors the core's
// presentation/template.rs, presentation/pptx_import.rs and the laid-out
// pages of presentation/layout.rs. Positions and sizes are in points on the
// template's page (960 × 540 for 16:9, 720 × 540 for 4:3).

export const TEMPLATE_ROLES = ["title", "section", "heading", "scripture", "quote", "question", "image", "text", "pause", "custom"] as const;
export type TemplateRole = (typeof TEMPLATE_ROLES)[number];

export const WIDE: [number, number] = [960, 540];
export const STANDARD: [number, number] = [720, 540];

export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TemplateAsset {
  /** The image's SHA-256. */
  id: string;
  mediaType: string;
  width: number;
  height: number;
  name: string;
}

export interface FontChoice {
  family: string;
  /** An installed font the person chose instead; never set by itself. */
  replacement: string | null;
}

export interface ImageFill {
  assetId: string;
  crop: Crop;
}

export interface Background {
  color: string | null;
  image: ImageFill | null;
}

export interface Placed {
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  crop: Crop;
  opacity: number | null;
}

export type Align = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";
/** "shrink": smaller (down to minSize) when it does not fit; "none": reported instead. */
export type Fit = "shrink" | "none";

export interface TextFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** "heading", "body" or an installed family. */
  font: string;
  size: number;
  minSize: number;
  bold: boolean;
  italic: boolean;
  /** "text", "muted", "accent" or "#RRGGBB". */
  color: string;
  align: Align;
  valign: VAlign;
  /** Inner margins: left, top, right, bottom. */
  inset: [number, number, number, number];
  lineSpacing: number;
  fit: Fit;
}

export interface Footer {
  text: string;
  frame: TextFrame;
}

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FilledRect extends Frame {
  fill: string | null;
  fillOpacity: number | null;
  line: string | null;
  lineWidth: number;
}

export interface RoleLayout {
  /** The source layout's name ("Bible Verse"), when imported. */
  source: string | null;
  background: Background | null;
  decorations: Placed[];
  rects: FilledRect[];
  labels: Footer[];
  title: TextFrame | null;
  reference: TextFrame | null;
  body: TextFrame | null;
  image: Frame | null;
  hideLogo: boolean;
  hideFooter: boolean;
}

export interface TemplateDefinition {
  format: string;
  version: number;
  width: number;
  height: number;
  colors: { background: string; text: string; muted: string; accent: string };
  fonts: { heading: FontChoice; body: FontChoice; others: FontChoice[] };
  background: Background;
  logo: Placed | null;
  footer: Footer | null;
  roles: Partial<Record<TemplateRole, RoleLayout>>;
  assets: TemplateAsset[];
}

export type TemplateSource = "pptx" | "package" | "designer";

export interface PresentationTemplateSummary {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  sourceFormat: TemplateSource;
  updatedAt: string;
}

export interface PresentationTemplate {
  id: string;
  name: string;
  description: string;
  definition: TemplateDefinition;
  sourceFormat: TemplateSource;
  sourceName: string | null;
  report: ImportReport | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

/** The template a presentation uses, inside its document. */
export interface DocTemplate {
  id: string;
  name: string;
  definition: TemplateDefinition;
}

export type FontStatus = "installed" | "styleMissing" | "missing";

export interface FontReport {
  family: string;
  bold: boolean;
  italic: boolean;
  status: FontStatus;
  /** A PDF can carry it. */
  embeddable: boolean;
  /** An installed family that might do instead; only offered. */
  suggestion: string | null;
  /** The layouts (or "heading" / "body") that use it. */
  usedIn: string[];
}

export type ReportLevel = "supported" | "attention" | "unsupported";

export interface ReportItem {
  level: ReportLevel;
  /** What it is: backgroundImage, smartArt, fontMissing… (translated here). */
  code: string;
  layout: string | null;
  detail: string | null;
  count: number;
}

export interface ImportReport {
  fileName: string;
  width: number;
  height: number;
  ratio: string;
  masters: number;
  layouts: number;
  slides: number;
  fonts: FontReport[];
  items: ReportItem[];
}

export interface SourceLayout {
  id: string;
  name: string;
  /** The source's own layout type (title, obj, secHead, cust…). */
  kind: string;
  layout: RoleLayout;
}

export interface ImportedTemplate {
  name: string;
  definition: TemplateDefinition;
  layouts: SourceLayout[];
  /** Role → layout id, only where the match is obvious. */
  suggestions: Partial<Record<TemplateRole, string>>;
  report: ImportReport;
}

export interface InstalledFont {
  family: string;
  bold: boolean;
  italic: boolean;
  embeddable: boolean;
}

export interface ImportProgress {
  done: number;
  total: number;
}

// --- Laid-out pages (presentation/layout.rs), the same for screen, PowerPoint and PDF ---

export interface PageText {
  type: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
  family: string | null;
  align: Align;
  line: number;
  paragraphs: string[];
  /** The text wrapped to its box, as the PDF sets it. */
  lines: string[];
  frame: { x: number; y: number; w: number; h: number; inset: number[]; valign: string; shrink: boolean } | null;
  /** The text does not fit its box at the template's size. */
  overflow: boolean;
}

export interface PageImage {
  type: "image";
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PagePicture {
  type: "picture";
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  crop: Crop;
  opacity: number;
}

export interface PageRect {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
  fillOpacity: number;
  line: string | null;
  lineWidth: number;
}

export interface PageMissing {
  type: "missing";
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PageBlock = PageText | PageImage | PagePicture | PageRect | PageMissing;

export interface Page {
  width: number;
  height: number;
  background: string;
  blocks: PageBlock[];
}

const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };

export function textFrame(partial: Partial<TextFrame> = {}): TextFrame {
  return {
    x: 64,
    y: 64,
    w: 832,
    h: 100,
    font: "body",
    size: 32,
    minSize: 22,
    bold: false,
    italic: false,
    color: "text",
    align: "left",
    valign: "top",
    inset: [7.2, 3.6, 7.2, 3.6],
    lineSpacing: 1.25,
    fit: "shrink",
    ...partial,
  };
}

export function roleLayout(partial: Partial<RoleLayout> = {}): RoleLayout {
  return {
    source: null,
    background: null,
    decorations: [],
    rects: [],
    labels: [],
    title: null,
    reference: null,
    body: null,
    image: null,
    hideLogo: false,
    hideFooter: false,
    ...partial,
  };
}

export function placed(assetId: string, frame: Frame): Placed {
  return { assetId, ...frame, crop: { ...NO_CROP }, opacity: null };
}

/** A new design in the given colours: no layouts yet (the built-in arrangement). */
export function newDefinition(colors: TemplateDefinition["colors"], size: [number, number] = WIDE): TemplateDefinition {
  return {
    format: "abiding-word/presentation-template",
    version: 1,
    width: size[0],
    height: size[1],
    colors: { ...colors },
    fonts: { heading: { family: "", replacement: null }, body: { family: "", replacement: null }, others: [] },
    background: { color: null, image: null },
    logo: null,
    footer: null,
    roles: {},
    assets: [],
  };
}

/** The ids of the images a design uses (background, logo, layouts). */
export function usedAssets(def: TemplateDefinition): string[] {
  const ids = new Set<string>();
  const add = (id: string | undefined | null) => id && ids.add(id);
  add(def.background.image?.assetId);
  add(def.logo?.assetId);
  for (const layout of Object.values(def.roles)) {
    if (!layout) continue;
    add(layout.background?.image?.assetId);
    layout.decorations.forEach((d) => add(d.assetId));
  }
  return [...ids];
}

/** The imported design as accepted: the chosen layouts by role, only the images still used. */
export function acceptImport(imported: ImportedTemplate, mapping: Partial<Record<TemplateRole, string>>, fonts: TemplateDefinition["fonts"]): TemplateDefinition {
  const roles: TemplateDefinition["roles"] = {};
  for (const role of TEMPLATE_ROLES) {
    const id = mapping[role];
    const source = id ? imported.layouts.find((l) => l.id === id) : undefined;
    if (source) roles[role] = source.layout;
  }
  const def: TemplateDefinition = { ...imported.definition, fonts, roles };
  const used = new Set(usedAssets(def));
  return { ...def, assets: def.assets.filter((a) => used.has(a.id)) };
}
