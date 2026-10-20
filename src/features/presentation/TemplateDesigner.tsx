import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/design-system/Button";
import { Dialog } from "@/design-system/Dialog";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import {
  newDefinition,
  placed,
  roleLayout,
  STANDARD,
  TEMPLATE_ROLES,
  textFrame,
  usedAssets,
  WIDE,
  type Footer,
  type PresentationTemplate,
  type RoleLayout,
  type TemplateAsset,
  type TemplateDefinition,
  type TemplateRole,
  type TextFrame,
} from "@/types/presentationTemplate";
import { palette } from "./labels";
import { TemplateSlide } from "./TemplateSlide";
import { roleLabel, useTemplateImages, useTemplatePreview } from "./templateSupport";

type BoxName = "title" | "reference" | "body";
const BOXES: BoxName[] = ["title", "reference", "body"];

/** A starting layout for a kind of slide, on a 960-point-wide page. */
function startingLayout(role: TemplateRole): RoleLayout {
  const heading = (p: Partial<TextFrame>) => textFrame({ font: "heading", bold: true, ...p });
  switch (role) {
    case "title":
      return roleLayout({ title: heading({ x: 64, y: 170, w: 832, h: 140, size: 54, align: "center", valign: "bottom" }), reference: textFrame({ x: 64, y: 320, w: 832, h: 60, size: 28, align: "center", color: "accent" }) });
    case "section":
      return roleLayout({ title: heading({ x: 64, y: 180, w: 832, h: 180, size: 46, align: "center", valign: "middle" }) });
    case "scripture":
      return roleLayout({ reference: textFrame({ x: 64, y: 48, w: 832, h: 60, size: 28, bold: true, color: "accent" }), body: textFrame({ x: 64, y: 120, w: 832, h: 360, size: 34 }) });
    case "quote":
      return roleLayout({ body: textFrame({ x: 96, y: 110, w: 768, h: 260, size: 36, italic: true, align: "center", valign: "middle" }), reference: textFrame({ x: 96, y: 390, w: 768, h: 60, size: 26, align: "right", color: "muted" }) });
    case "image":
      return roleLayout({ title: heading({ x: 64, y: 32, w: 832, h: 70, size: 32, align: "center" }), image: { x: 64, y: 110, w: 832, h: 340 }, body: textFrame({ x: 64, y: 460, w: 832, h: 50, size: 24, align: "center" }) });
    case "pause":
      return roleLayout();
    default:
      return roleLayout({ title: heading({ x: 64, y: 48, w: 832, h: 100, size: 40, valign: "bottom" }), body: textFrame({ x: 64, y: 168, w: 832, h: 320, size: 30 }) });
  }
}

/** Scales positions to another page size (both directions). */
function scaleBox<T extends { x: number; y: number; w: number; h: number }>(f: T, kx: number, ky: number): T {
  const r = (v: number) => Math.round(v * 10) / 10;
  return { ...f, x: r(f.x * kx), w: r(f.w * kx), y: r(f.y * ky), h: r(f.h * ky) };
}
function scaleLayout(l: RoleLayout, kx: number, ky: number): RoleLayout {
  return {
    ...l,
    title: l.title && scaleBox(l.title, kx, ky),
    reference: l.reference && scaleBox(l.reference, kx, ky),
    body: l.body && scaleBox(l.body, kx, ky),
    image: l.image && scaleBox(l.image, kx, ky),
    decorations: l.decorations.map((d) => scaleBox(d, kx, ky)),
    rects: l.rects.map((x) => scaleBox(x, kx, ky)),
    labels: l.labels.map((x) => ({ ...x, frame: scaleBox(x.frame, kx, ky) })),
  };
}
function rescale(def: TemplateDefinition, width: number, height: number): TemplateDefinition {
  const kx = width / def.width;
  const ky = height / def.height;
  return {
    ...def,
    width,
    height,
    logo: def.logo && scaleBox(def.logo, kx, ky),
    footer: def.footer && { ...def.footer, frame: scaleBox(def.footer.frame, kx, ky) },
    roles: Object.fromEntries(Object.entries(def.roles).map(([r, l]) => [r, l && scaleLayout(l, kx, ky)])),
  };
}

const clampFrame = <T extends { x: number; y: number; w: number; h: number }>(f: T, def: TemplateDefinition): T => {
  const w = Math.min(Math.max(20, f.w), def.width);
  const h = Math.min(Math.max(12, f.h), def.height);
  return { ...f, w, h, x: Math.min(Math.max(0, f.x), def.width - w), y: Math.min(Math.max(0, f.y), def.height - h) };
};

/**
 * A simple church template made here: colours, fonts, a background, a logo,
 * a footer, and for each kind of slide its own boxes, which can be dragged
 * and resized on the slide or set by number from the keyboard. Not a
 * PowerPoint editor: only what a teaching's slides need.
 */
export function TemplateDesigner({ template, onDone }: { template: PresentationTemplate | null; onDone: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const fonts = useLoad(useCallback(() => api.presentationFonts(), [api]));
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [def, setDef] = useState<TemplateDefinition>(() => template?.definition ?? newDefinition(palette("light")));
  const [role, setRole] = useState<TemplateRole>("heading");
  const [box, setBox] = useState<BoxName>("title");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useTemplatePreview(def, [role]);
  const images = useTemplateImages(def);
  const families = useMemo(() => [...new Set((fonts.data ?? []).map((f) => f.family))].sort((a, b) => a.localeCompare(b)), [fonts.data]);
  const layout = def.roles[role] ?? null;
  const frame = layout?.[box] ?? null;

  const setLayout = (next: RoleLayout | null) =>
    setDef((d) => {
      const roles = { ...d.roles };
      if (next) roles[role] = next;
      else delete roles[role];
      return { ...d, roles };
    });
  const setFrame = (name: BoxName, next: TextFrame | null) => layout && setLayout({ ...layout, [name]: next && clampFrame(next, def) });

  const addImage = async (apply: (asset: TemplateAsset) => void) => {
    setError(null);
    try {
      const path = await api.chooseTemplateFile({ kind: "image", title: t("presentation.templates.chooseImage"), filterName: t("presentation.templates.imageFilter") });
      if (!path) return;
      const asset = await api.presentationTemplateAssetAdd(path);
      setDef((d) => ({ ...d, assets: d.assets.some((a) => a.id === asset.id) ? d.assets : [...d.assets, asset] }));
      apply(asset);
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      setError(t("presentation.templates.nameNeeded"));
      return;
    }
    setBusy(true);
    setError(null);
    const used = new Set(usedAssets(def));
    const definition = { ...def, assets: def.assets.filter((a) => used.has(a.id)) };
    try {
      if (template) await api.presentationTemplateUpdate({ id: template.id, name: name.trim(), description, definition });
      else await api.presentationTemplateCreate({ name: name.trim(), description, definition, sourceFormat: "designer" });
      onDone();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const page = preview.pages.get(role);
  const footer: Footer | null = def.footer;
  const colorInput = (key: keyof TemplateDefinition["colors"]) => (
    <label key={key} className="flex items-center gap-2 text-[0.9375rem]">
      <input type="color" value={def.colors[key]} onChange={(e) => setDef((d) => ({ ...d, colors: { ...d.colors, [key]: e.target.value.toUpperCase() } }))} className="h-11 w-12 rounded-aw border border-border bg-field p-1" />
      {t(`presentation.templates.colors.${key}`)}
    </label>
  );

  return (
    <Dialog
      wide
      title={template ? t("presentation.templates.editTitle", { name: template.name }) : t("presentation.templates.newTitle")}
      onClose={onDone}
      actions={
        <>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? t("presentation.templates.saving") : t("presentation.templates.save")}
          </Button>
          <Button onClick={onDone}>{t("common.cancel")}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[0.9375rem]">
          <span className="type-subhead">{t("presentation.templates.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="h-11 aw-input px-2" />
        </label>
        <label className="flex flex-col gap-1 text-[0.9375rem]">
          <span className="type-subhead">{t("presentation.templates.description")}</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="h-11 aw-input px-2" />
        </label>
      </div>

      <fieldset className="m-0 flex flex-wrap items-center gap-4 border-0 p-0">
        <legend className="type-subhead mb-1 p-0">{t("presentation.templates.size")}</legend>
        {[WIDE, STANDARD].map(([w, h]) => (
          <label key={w} className="flex min-h-11 items-center gap-2 text-[0.9375rem]">
            <input type="radio" name={`${id}-size`} checked={def.width === w && def.height === h} onChange={() => setDef((d) => rescale(d, w, h))} className="size-5" />
            {w === WIDE[0] ? t("presentation.templates.wide") : t("presentation.templates.standard")}
          </label>
        ))}
      </fieldset>

      <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
        <legend className="type-subhead mb-1 p-0">{t("presentation.templates.colorsTitle")}</legend>
        {(["background", "text", "muted", "accent"] as const).map(colorInput)}
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(["heading", "body"] as const).map((which) => (
          <label key={which} className="flex flex-col gap-1 text-[0.9375rem]">
            <span className="type-subhead">{t(`presentation.templates.fontFor.${which}`)}</span>
            <select
              value={def.fonts[which].replacement ?? def.fonts[which].family}
              onChange={(e) => setDef((d) => ({ ...d, fonts: { ...d.fonts, [which]: { family: e.target.value, replacement: null } } }))}
              className="h-11 min-w-0 max-w-full aw-input px-2"
            >
              <option value="">{t("presentation.templates.usualFont")}</option>
              {[...new Set([def.fonts[which].family, ...families])].filter(Boolean).map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
        <span className="type-subhead">{t("presentation.templates.backgroundImage")}</span>
        <Button onClick={() => void addImage((a) => setDef((d) => ({ ...d, background: { ...d.background, image: { assetId: a.id, crop: { left: 0, top: 0, right: 0, bottom: 0 } } } })))}>
          <ImagePlus className="size-4" aria-hidden="true" />
          {def.background.image ? t("presentation.templates.replaceImage") : t("presentation.templates.chooseImageButton")}
        </Button>
        {def.background.image && (
          <Button variant="quiet" onClick={() => setDef((d) => ({ ...d, background: { ...d.background, image: null } }))}>
            <X className="size-4" aria-hidden="true" />
            {t("presentation.templates.removeBackground")}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
        <span className="type-subhead">{t("presentation.templates.logo")}</span>
        <Button onClick={() => void addImage((a) => setDef((d) => ({ ...d, logo: placed(a.id, { x: d.width - 24 - 120, y: 24, w: 120, h: Math.round((120 * a.height) / Math.max(1, a.width)) }) })))}>
          <ImagePlus className="size-4" aria-hidden="true" />
          {def.logo ? t("presentation.templates.replaceImage") : t("presentation.templates.chooseImageButton")}
        </Button>
        {def.logo && (
          <>
            <NumberFields value={def.logo} onChange={(f) => setDef((d) => ({ ...d, logo: d.logo && clampFrame({ ...d.logo, ...f }, d) }))} label={t("presentation.templates.logo")} />
            <Button variant="quiet" onClick={() => setDef((d) => ({ ...d, logo: null }))}>
              <X className="size-4" aria-hidden="true" />
              {t("presentation.templates.removeLogo")}
            </Button>
          </>
        )}
      </div>
      <label className="flex flex-col gap-1 text-[0.9375rem]">
        <span className="type-subhead">{t("presentation.templates.footer")}</span>
        <input
          value={footer?.text ?? ""}
          placeholder={t("presentation.templates.footerPlaceholder")}
          onChange={(e) => {
            const text = e.target.value;
            setDef((d) => ({
              ...d,
              footer: text ? { text, frame: d.footer?.frame ?? textFrame({ x: 64, y: d.height - 40, w: d.width - 128, h: 28, size: 14, minSize: 14, color: "muted", align: "center", fit: "none" }) } : null,
            }));
          }}
          className="h-11 aw-input px-2"
        />
      </label>

      <section aria-labelledby={`${id}-layouts`} className="flex flex-col gap-2">
        <h3 id={`${id}-layouts`} className="type-group m-0 mt-2">{t("presentation.templates.layouts")}</h3>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[0.9375rem]">
            <span>{t("presentation.templates.kind")}</span>
            <select
              value={role}
              onChange={(e) => {
                const next = e.target.value as TemplateRole;
                setRole(next);
                // Keep a box of that kind selected, so its settings show straight away.
                const l = def.roles[next];
                if (l && !l[box]) setBox(BOXES.find((b) => l[b]) ?? "title");
              }} className="h-11 aw-input px-2">
              {TEMPLATE_ROLES.map((r) => (
                <option key={r} value={r}>{roleLabel(t, r)}</option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-[0.9375rem]">
            <input
              type="checkbox"
              checked={layout !== null}
              onChange={(e) => {
                if (!e.target.checked) return setLayout(null);
                // The starting boxes are drawn for 960 × 540: fitted to this page.
                const start = scaleLayout(startingLayout(role), def.width / WIDE[0], def.height / WIDE[1]);
                setLayout(start);
                if (!start[box]) setBox(BOXES.find((b) => start[b]) ?? "title");
              }}
              className="size-5"
            />
            {t("presentation.templates.ownLayout")}
          </label>
          {layout && (
            <>
              <label className="flex min-h-11 items-center gap-2 text-[0.9375rem]">
                <input type="checkbox" checked={layout.hideLogo} onChange={(e) => setLayout({ ...layout, hideLogo: e.target.checked })} className="size-5" />
                {t("presentation.templates.hideLogo")}
              </label>
              <label className="flex min-h-11 items-center gap-2 text-[0.9375rem]">
                <input type="checkbox" checked={layout.hideFooter} onChange={(e) => setLayout({ ...layout, hideFooter: e.target.checked })} className="size-5" />
                {t("presentation.templates.hideFooter")}
              </label>
            </>
          )}
        </div>
        {!layout && <p className="m-0 type-meta">{t("presentation.templates.builtInHint")}</p>}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Canvas def={def} page={page ?? null} images={images} layout={layout} selected={box} onSelect={setBox} onFrame={setFrame} />
          {layout && (
            <div className="flex flex-col gap-2">
              <div role="radiogroup" aria-label={t("presentation.templates.box")} className="flex flex-wrap gap-1">
                {BOXES.map((b) => (
                  <label key={b} className="aw-choice min-h-11 gap-2 px-3">
                    <input type="radio" name={`${id}-box`} checked={box === b} onChange={() => setBox(b)} className="size-4" />
                    {t(`presentation.templates.boxes.${b}`)}
                  </label>
                ))}
              </div>
              {frame ? (
                <FrameFields frame={frame} onChange={(f) => setFrame(box, f)} onRemove={() => setFrame(box, null)} />
              ) : (
                <Button
                  onClick={() => {
                    const start = startingLayout(role === "pause" ? "heading" : role)[box] ?? textFrame({ y: box === "title" ? 48 : box === "reference" ? 150 : 220, h: 80 });
                    setFrame(box, scaleBox(start, def.width / WIDE[0], def.height / WIDE[1]));
                  }}
                >
                  {t("presentation.templates.addBox", { box: t(`presentation.templates.boxes.${box}`) })}
                </Button>
              )}
            </div>
          )}
        </div>
      </section>
      {preview.error && <p role="alert" className="m-0 text-danger">{preview.error}</p>}
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
    </Dialog>
  );
}

/** The preview of the kind of slide, with its boxes to drag (or move with the arrow keys). */
function Canvas({
  def,
  page,
  images,
  layout,
  selected,
  onSelect,
  onFrame,
}: {
  def: TemplateDefinition;
  page: import("@/types/presentationTemplate").Page | null;
  images: Map<string, string>;
  layout: RoleLayout | null;
  selected: BoxName;
  onSelect: (b: BoxName) => void;
  onFrame: (b: BoxName, f: TextFrame) => void;
}) {
  const { t } = useTranslation();
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ box: BoxName; mode: "move" | "size"; x: number; y: number; frame: TextFrame } | null>(null);
  const scale = () => def.width / Math.max(1, area.current?.clientWidth ?? def.width);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  const start = (e: ReactPointerEvent, box: BoxName, mode: "move" | "size") => {
    const frame = layout?.[box];
    if (!frame || e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    onSelect(box);
    drag.current = { box, mode, x: e.clientX, y: e.clientY, frame };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = scale();
    const dx = Math.round((e.clientX - d.x) * k);
    const dy = Math.round((e.clientY - d.y) * k);
    onFrame(d.box, d.mode === "move" ? { ...d.frame, x: d.frame.x + dx, y: d.frame.y + dy } : { ...d.frame, w: d.frame.w + dx, h: d.frame.h + dy });
  };
  const end = () => {
    drag.current = null;
  };
  const keys = (e: KeyboardEvent, box: BoxName) => {
    const frame = layout?.[box];
    if (!frame) return;
    const step = e.shiftKey ? 10 : 2;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    onFrame(box, { ...frame, x: frame.x + d[0], y: frame.y + d[1] });
  };

  return (
    <div ref={area} className="relative w-full overflow-hidden rounded border border-border" style={{ aspectRatio: `${def.width} / ${def.height}`, backgroundColor: def.colors.background }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {page && <TemplateSlide page={page} images={images} showOverflow />}
      {layout &&
        BOXES.map((b) => {
          const f = layout[b];
          if (!f) return null;
          return (
            <div
              key={b}
              role="button"
              tabIndex={0}
              aria-label={t("presentation.templates.boxHandle", { box: t(`presentation.templates.boxes.${b}`) })}
              aria-pressed={selected === b}
              onFocus={() => onSelect(b)}
              onKeyDown={(e) => keys(e, b)}
              onPointerDown={(e) => start(e, b, "move")}
              className={`absolute cursor-move touch-none border-2 ${selected === b ? "border-primary" : "border-dashed border-text-muted/60"}`}
              style={{ left: pct(f.x, def.width), top: pct(f.y, def.height), width: pct(f.w, def.width), height: pct(f.h, def.height) }}
            >
              <span className="pointer-events-none absolute right-0 top-0 bg-primary/80 px-1 text-[0.75rem] text-on-primary">{t(`presentation.templates.boxes.${b}`)}</span>
              <span aria-hidden="true" onPointerDown={(e) => start(e, b, "size")} className="absolute -bottom-1.5 -right-1.5 size-3 cursor-se-resize rounded-sm border border-white bg-primary" />
            </div>
          );
        })}
    </div>
  );
}

function NumberFields({ value, onChange, label }: { value: { x: number; y: number; w: number; h: number }; onChange: (f: { x: number; y: number; w: number; h: number }) => void; label: string }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap items-center gap-1">
      {(["x", "y", "w", "h"] as const).map((k) => (
        <label key={k} className="flex items-center gap-1 text-[0.875rem]">
          <span className="text-text-muted">{t(`presentation.templates.pos.${k}`)}</span>
          <input
            type="number"
            aria-label={`${label}: ${t(`presentation.templates.posLong.${k}`)}`}
            value={Math.round(value[k])}
            onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange({ ...value, [k]: e.target.valueAsNumber })}
            className="h-11 w-20 aw-input px-2"
          />
        </label>
      ))}
    </span>
  );
}

function FrameFields({ frame, onChange, onRemove }: { frame: TextFrame; onChange: (f: TextFrame) => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const label = t("presentation.templates.boxSettings");
  return (
    <div className="flex flex-col gap-2 text-[0.9375rem]">
      <NumberFields value={frame} onChange={(f) => onChange({ ...frame, ...f })} label={label} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          <span>{t("presentation.templates.textSize")}</span>
          <input type="number" min={8} max={200} value={frame.size} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange({ ...frame, size: e.target.valueAsNumber, minSize: Math.min(frame.minSize, e.target.valueAsNumber) })} className="h-11 w-20 aw-input px-2" />
        </label>
        <label className="flex items-center gap-1">
          <span>{t("presentation.templates.align")}</span>
          <select value={frame.align} onChange={(e) => onChange({ ...frame, align: e.target.value as TextFrame["align"] })} className="h-11 aw-input px-2">
            {(["left", "center", "right"] as const).map((a) => (
              <option key={a} value={a}>{t(`presentation.templates.aligns.${a}`)}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span>{t("presentation.templates.valign")}</span>
          <select value={frame.valign} onChange={(e) => onChange({ ...frame, valign: e.target.value as TextFrame["valign"] })} className="h-11 aw-input px-2">
            {(["top", "middle", "bottom"] as const).map((a) => (
              <option key={a} value={a}>{t(`presentation.templates.valigns.${a}`)}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={frame.bold} onChange={(e) => onChange({ ...frame, bold: e.target.checked })} className="size-5" />
          {t("presentation.templates.bold")}
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={frame.italic} onChange={(e) => onChange({ ...frame, italic: e.target.checked })} className="size-5" />
          {t("presentation.templates.italic")}
        </label>
        <label className="flex items-center gap-1">
          <span>{t("presentation.templates.textColor")}</span>
          <select value={["text", "muted", "accent"].includes(frame.color) ? frame.color : "text"} onChange={(e) => onChange({ ...frame, color: e.target.value })} className="h-11 aw-input px-2">
            {(["text", "muted", "accent"] as const).map((c) => (
              <option key={c} value={c}>{t(`presentation.templates.colors.${c}`)}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={frame.fit === "shrink"} onChange={(e) => onChange({ ...frame, fit: e.target.checked ? "shrink" : "none", minSize: Math.min(frame.size, Math.max(12, frame.minSize)) })} className="size-5" />
        {t("presentation.templates.shrink")}
      </label>
      <Button variant="quiet" onClick={onRemove} className="self-start">
        <X className="size-4" aria-hidden="true" />
        {t("presentation.templates.removeBox")}
      </Button>
    </div>
  );
}
