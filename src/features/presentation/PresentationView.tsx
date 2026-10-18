import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, Download, GripVertical, Play, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { referenceLabel } from "@/i18n/scripture";
import { ITEM_KINDS, PRESENTATION_THEMES, type ItemKind, type ItemSource, type Presentation, type PresentationDocument, type PresentationItem, type UpdatePresentationItem } from "@/types/presentation";
import type { Page } from "@/types/presentationTemplate";
import type { TeachingPreparation } from "@/types/teaching";
import { ExportDialog } from "./ExportDialog";
import { itemKindLabel, slideText, sourceLabel, teachingGives, teachingText, themeLabel } from "./labels";
import { PresenterView } from "./PresenterView";
import { SlideView } from "./SlideView";
import { TemplateManager } from "./TemplateManager";
import { useDesignPages } from "./useDesignPages";
import { useListDrag } from "./useListDrag";
import { useSlideImages } from "./useSlideImages";

interface PresentationViewProps {
  preparation: TeachingPreparation;
  /** The teaching's own words for the slides a proposal starts with. */
  labels: { introduction: string; conclusion: string };
  onBack: () => void;
}

/**
 * How a Bible Teaching is delivered (v0.18). Not a third workspace: the
 * teaching stays the source of truth and its slides follow it live; here the
 * person only chooses what the audience sees, in which order, and what
 * only they see. Every output — the Presenter View, PowerPoint, PDF,
 * Markdown, a delivery package — is made from these slides.
 */
export function PresentationView({ preparation, labels, onBack }: PresentationViewProps) {
  const { t } = useTranslation();
  const api = useApi();
  const list = useLoad(useCallback(() => api.presentationList(preparation.id), [api, preparation.id]));
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const presentations = list.data ?? [];
  const currentId = chosen && presentations.some((p) => p.id === chosen) ? chosen : (presentations[0]?.id ?? null);

  const create = async (propose: boolean) => {
    setError(null);
    setBusy(true);
    try {
      const made = await api.presentationCreate({ preparationId: preparation.id, propose, labels });
      setChosen(made.id);
      list.reload();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-link hover:bg-bg-secondary">
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("presentation.backToTeaching")}
        </button>
      </div>
      <header className="flex flex-col gap-1">
        <h3 ref={heading} tabIndex={-1} id={`${id}-title`} className="m-0 font-display text-[1.375rem] font-heading text-text-strong outline-none">
          {t("presentation.title", { title: preparation.title })}
        </h3>
        <p className="m-0 max-w-prose text-[0.9375rem] text-text-muted">{t("presentation.intro")}</p>
      </header>
      {list.error && <p role="alert" className="m-0 text-danger">{list.error.message}</p>}
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
      {list.data && presentations.length === 0 && (
        <div className="flex flex-col gap-3 rounded-aw border border-border-subtle p-4">
          <p className="m-0 max-w-prose">{t("presentation.start.text")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void create(true)} disabled={busy}>
              {t("presentation.start.propose")}
            </Button>
            <Button onClick={() => void create(false)} disabled={busy}>
              {t("presentation.start.empty")}
            </Button>
          </div>
          <p className="m-0 max-w-prose text-[0.875rem] text-text-muted">{t("presentation.start.noAi")}</p>
        </div>
      )}
      {presentations.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {presentations.length > 1 && (
            <>
              <label htmlFor={`${id}-which`} className="text-[0.9375rem] text-text-muted">{t("presentation.which")}</label>
              <select id={`${id}-which`} value={currentId ?? ""} onChange={(e) => setChosen(e.target.value)} className="h-11 min-w-0 max-w-full rounded-aw border border-border bg-bg px-2 text-[0.9375rem]">
                {presentations.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </>
          )}
          <button type="button" onClick={() => void create(true)} disabled={busy} className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] font-medium text-link hover:bg-bg-secondary">
            <Plus className="size-4" aria-hidden="true" />
            {t("presentation.another")}
          </button>
        </div>
      )}
      {currentId && (
        <PresentationEditor
          key={currentId}
          presentationId={currentId}
          preparation={preparation}
          onRenamed={list.reload}
          onDeleted={() => {
            setChosen(null);
            list.reload();
            heading.current?.focus();
          }}
        />
      )}
    </section>
  );
}

function PresentationEditor({
  presentationId,
  preparation,
  onRenamed,
  onDeleted,
}: {
  presentationId: string;
  preparation: TeachingPreparation;
  onRenamed: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const loaded = useLoad(useCallback(() => api.presentationGet(presentationId), [api, presentationId]));
  const bibles = useLoad(useCallback(() => api.bibleList(), [api]));
  const [doc, setDoc] = useState<PresentationDocument | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const startButton = useRef<HTMLButtonElement>(null);
  const docRequest = useRef(0);
  const images = useSlideImages(presentationId, doc?.images ?? []);
  const pageFor = useDesignPages(presentationId, doc?.template, doc?.slides ?? []);
  const templates = useLoad(useCallback(() => api.presentationTemplateList(), [api]));
  const [managing, setManaging] = useState(false);

  const refresh = useCallback(() => {
    const request = ++docRequest.current;
    api.presentationDocument(presentationId).then(
      (next) => request === docRequest.current && setDoc(next),
      (e: unknown) => request === docRequest.current && setError(toApiError(e).message),
    );
  }, [api, presentationId]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const presentation = loaded.data ?? null;
  const setPresentation = loaded.setData;
  const act = useCallback(
    async (run: () => Promise<Presentation>) => {
      setError(null);
      try {
        const next = await run();
        setPresentation(next);
        refresh();
        return next;
      } catch (e) {
        setError(toApiError(e).message);
        return null;
      }
    },
    [refresh, setPresentation],
  );

  if (loaded.error) return <p role="alert" className="m-0 text-danger">{loaded.error.message}</p>;
  if (!presentation) return <p className="m-0 text-text-muted">{t("presentation.loading")}</p>;

  const update = (patch: UpdatePresentationItem) => act(() => api.presentationItemUpdate(patch));
  /** Moves one slide to another place; only the presentation's order changes. */
  const moveTo = async (from: number, target: number) => {
    const ids = presentation.items.map((i) => i.id);
    if (target < 0 || target >= ids.length || target === from) return null;
    const [moved] = ids.splice(from, 1);
    ids.splice(target, 0, moved!);
    const next = await act(() => api.presentationItemReorder({ parentId: presentation.id, ids }));
    if (next) setNotice(t("presentation.editor.moved", { position: target + 1 }));
    return next ? ids : null;
  };
  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    const ids = await moveTo(index, target);
    if (!ids) return;
    // At the first or last place that button is disabled: the other one (or the slide) takes the keyboard.
    const atEnd = (delta < 0 && target === 0) || (delta > 0 && target === ids.length - 1);
    const focusId = atEnd ? `slide-move-${ids[target]}-${delta < 0 ? "down" : "up"}` : `slide-move-${ids[target]}-${delta < 0 ? "up" : "down"}`;
    requestAnimationFrame(() => {
      const button = document.getElementById(focusId) as HTMLButtonElement | null;
      (button && !button.disabled ? button : document.getElementById(`slide-${ids[target]}`))?.focus();
    });
  };
  // Dragged by its handle: the moved slide keeps the keyboard.
  const dropped = async (from: number, target: number) => {
    const ids = await moveTo(from, target);
    if (ids) requestAnimationFrame(() => document.getElementById(`slide-${ids[target]}`)?.focus());
  };
  const add = async (kind: ItemKind, source: ItemSource | null) => {
    const next = await act(() => api.presentationItemCreate({ presentationId: presentation.id, kind, source }));
    if (next) {
      const known = new Set(presentation.items.map((i) => i.id));
      const fresh = next.items.find((i) => !known.has(i.id));
      if (fresh) {
        setOpen((o) => new Set(o).add(fresh.id));
        setNotice(t("presentation.editor.added", { position: next.items.indexOf(fresh) + 1 }));
        requestAnimationFrame(() => document.getElementById(`slide-${fresh.id}`)?.focus());
      }
    }
  };
  const removeItem = async (item: PresentationItem, index: number) => {
    const next = await act(() => api.presentationItemDelete(item.id));
    if (next) {
      setNotice(t("presentation.editor.removed"));
      const neighbour = next.items[Math.min(index, next.items.length - 1)];
      requestAnimationFrame(() => (neighbour ? document.getElementById(`slide-${neighbour.id}`) : startButton.current)?.focus());
    }
  };

  const shown = presentation.items.filter((i) => !i.skipped).length;
  // Slides whose text does not fit a template box (reported, never shrunk quietly).
  const overflowing = doc?.template ? doc.slides.filter((s) => pageFor(s.kind, s.audience)?.blocks.some((b) => b.type === "text" && b.overflow)).length : 0;
  const noBible = doc?.warnings.some((w) => w.code === "noBible");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={startButton}
          variant="primary"
          className="min-h-11"
          disabled={!doc || doc.slides.length === 0}
          onClick={() => setPresenting(true)}
        >
          <Play className="size-4" aria-hidden="true" />
          {t("presentation.startPresenting")}
        </Button>
        <Button className="min-h-11" disabled={!doc || doc.slides.length === 0} onClick={() => setExporting(true)}>
          <Download className="size-4" aria-hidden="true" />
          {t("presentation.export.open")}
        </Button>
        <span className="text-[0.9375rem] text-text-muted">{t("presentation.editor.count", { count: shown })}</span>
      </div>

      <details className="rounded-aw border border-border-subtle px-4 py-2">
        <summary className="flex min-h-11 cursor-pointer items-center text-[0.9375rem] font-medium text-text-strong">{t("presentation.editor.settings")}</summary>
        <div className="flex flex-col gap-3 pb-2 pt-1">
          <DraftField
            label={t("presentation.editor.name")}
            value={presentation.title}
            onSave={(value) =>
              value.trim()
                ? act(() => api.presentationUpdate({ id: presentation.id, title: value })).then((n) => {
                    if (n) onRenamed();
                    return n;
                  })
                : Promise.resolve(null)
            }
          />
          <div className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
            <label htmlFor={`${presentation.id}-design`} className="text-text-muted">{t("presentation.editor.design")}</label>
            <select
              id={`${presentation.id}-design`}
              value={presentation.templateId ? `template:${presentation.templateId}` : `theme:${presentation.theme}`}
              onChange={(e) => {
                const [what, value] = e.target.value.split(":") as [string, string];
                // A template is laid over the same slides; choosing a built-in background drops it again.
                void act(() =>
                  api.presentationUpdate(what === "template" ? { id: presentation.id, templateId: value } : { id: presentation.id, theme: value as Presentation["theme"], templateId: "" }),
                );
              }}
              className="h-11 min-w-0 max-w-full rounded-aw border border-border bg-bg px-2"
            >
              <optgroup label={t("presentation.editor.builtIn")}>
                {PRESENTATION_THEMES.map((theme) => (
                  <option key={theme} value={`theme:${theme}`}>{themeLabel(t, theme)}</option>
                ))}
              </optgroup>
              {(templates.data ?? []).length > 0 && (
                <optgroup label={t("presentation.editor.churchTemplates")}>
                  {(templates.data ?? []).map((tpl) => (
                    <option key={tpl.id} value={`template:${tpl.id}`}>{tpl.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <button type="button" onClick={() => setManaging(true)} className="inline-flex min-h-11 items-center rounded-aw px-2 font-medium text-link hover:bg-bg-secondary">
              {t("presentation.templates.manage")}
            </button>
          </div>
          <p className="-mt-2 mb-0 text-[0.875rem] text-text-muted">{t("presentation.editor.designHint")}</p>
          <label className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
            <span className="text-text-muted">{t("presentation.editor.bible")}</span>
            <select value={presentation.translationId ?? ""} onChange={(e) => void act(() => api.presentationUpdate({ id: presentation.id, translationId: e.target.value }))} className="h-11 min-w-0 max-w-full rounded-aw border border-border bg-bg px-2">
              <option value="">{t("presentation.editor.bibleDefault")}</option>
              {(bibles.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>{`${b.name} (${b.shortName})`}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
            <span className="text-text-muted">{t("presentation.editor.target")}</span>
            <select value={presentation.targetMinutes ?? 0} onChange={(e) => void act(() => api.presentationUpdate({ id: presentation.id, targetMinutes: Number(e.target.value) }))} className="h-11 rounded-aw border border-border bg-bg px-2">
              <option value={0}>{t("presentation.editor.targetNone")}</option>
              {targetChoices(presentation.targetMinutes).map((m) => (
                <option key={m} value={m}>{t("presentation.editor.minutes", { count: m })}</option>
              ))}
            </select>
          </label>
          <p className="-mt-2 mb-0 text-[0.875rem] text-text-muted">{t("presentation.editor.targetHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {confirmDelete ? (
              <span className="flex flex-wrap items-center gap-2 rounded-aw border border-border px-2 py-1 text-[0.9375rem]">
                <span>{t("presentation.editor.deleteConfirm")}</span>
                <button type="button" onClick={() => void api.presentationDelete(presentation.id).then(onDeleted, (e: unknown) => setError(toApiError(e).message))} className="min-h-11 rounded px-2 font-medium text-danger hover:bg-bg-secondary">
                  {t("common.delete")}
                </button>
                <button type="button" autoFocus onClick={() => setConfirmDelete(false)} className="min-h-11 rounded px-2 hover:bg-bg-secondary">
                  {t("common.keep")}
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex min-h-11 items-center gap-1 rounded-aw px-2 text-[0.9375rem] text-text-muted hover:bg-bg-secondary hover:text-danger">
                <Trash2 className="size-4" aria-hidden="true" />
                {t("presentation.editor.delete")}
              </button>
            )}
          </div>
        </div>
      </details>

      {noBible && <p className="m-0 rounded-aw bg-note px-3 py-2 text-[0.9375rem]">{t("presentation.warnings.noBible")}</p>}
      {overflowing > 0 && (
        <p className="m-0 flex items-start gap-2 rounded-aw bg-note px-3 py-2 text-[0.9375rem]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("presentation.templates.overflowSummary", { count: overflowing })}
        </p>
      )}
      {managing && (
        <TemplateManager
          onClose={() => {
            setManaging(false);
            templates.reload();
            refresh();
          }}
        />
      )}
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
      <p role="status" className="sr-only">{notice}</p>

      <SlideList
        count={presentation.items.length}
        label={t("presentation.editor.slides")}
        onDrop={(from, to) => void dropped(from, to)}
        render={(index, drag) => {
          const item = presentation.items[index]!;
          return (
          <SlideRow
            key={item.id}
            item={item}
            index={index}
            drag={drag}
            last={index === presentation.items.length - 1}
            doc={doc}
            image={(() => {
              const s = doc?.slides.find((x) => x.itemId === item.id);
              return s?.audience.image ? (images.get(s.audience.image.assetId) ?? null) : null;
            })()}
            page={(() => {
              const s = doc?.slides.find((x) => x.itemId === item.id);
              return s ? pageFor(s.kind, s.audience) : null;
            })()}
            images={images}
            preparation={preparation}
            presentationId={presentation.id}
            theme={presentation.theme}
            open={open.has(item.id)}
            onToggle={() =>
              setOpen((o) => {
                const n = new Set(o);
                if (n.has(item.id)) n.delete(item.id);
                else n.add(item.id);
                return n;
              })
            }
            onUpdate={update}
            onMove={(delta) => void move(index, delta)}
            onRemove={() => void removeItem(item, index)}
            onImageSaved={refresh}
          />
          );
        }}
      />

      <AddSlide presentation={presentation} preparation={preparation} onAdd={(kind, source) => void add(kind, source)} />

      {presenting && doc && (
        <PresenterView
          doc={doc}
          onClose={() => {
            setPresenting(false);
            requestAnimationFrame(() => startButton.current?.focus());
          }}
        />
      )}
      {exporting && doc && <ExportDialog doc={doc} onClose={() => setExporting(false)} />}
    </div>
  );
}

/** Text saved when the field is left, and after a short pause in typing. */
function DraftField({
  label,
  value,
  onSave,
  multiline = false,
  rows = 2,
  hint,
  inputId,
}: {
  label: string;
  value: string;
  /** Resolves to null when the core refused the text (it is then saved again on the next change or leave). */
  onSave: (value: string) => Promise<unknown>;
  multiline?: boolean;
  rows?: number;
  hint?: ReactNode;
  inputId?: string;
}) {
  const ownId = useId();
  const id = inputId ?? ownId;
  const [draft, setDraft] = useState(value);
  const saved = useRef(value);
  const timer = useRef<number | null>(null);
  const flush = (text: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (text === saved.current) return;
    const before = saved.current;
    saved.current = text;
    void onSave(text).then(
      (result) => {
        if (result === null && saved.current === text) saved.current = before;
      },
      () => {
        if (saved.current === text) saved.current = before;
      },
    );
  };
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const change = (text: string) => {
    setDraft(text);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(text), 800);
  };
  const fieldClass = "w-full rounded-aw border border-border bg-bg px-3 py-2 text-[0.9375rem]";
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[0.875rem] font-medium text-text-muted">{label}</label>
      {multiline ? (
        <textarea id={id} value={draft} rows={rows} onBlur={() => flush(draft)} onChange={(e) => change(e.target.value)} className={fieldClass} />
      ) : (
        <input id={id} value={draft} onBlur={() => flush(draft)} onChange={(e) => change(e.target.value)} className={`${fieldClass} h-11`} />
      )}
      {hint}
    </div>
  );
}

/** A heading or audience text: the teaching's own words, live, until the person writes their own. */
function Wording({
  item,
  part,
  preparation,
  label,
  onUpdate,
}: {
  item: PresentationItem;
  part: "heading" | "body";
  preparation: TeachingPreparation;
  label: string;
  onUpdate: (patch: UpdatePresentationItem) => Promise<Presentation | null>;
}) {
  const { t } = useTranslation();
  const own = item[part];
  const gives = teachingGives(item, part);
  const teaching = teachingText(item, preparation, part);
  const fieldId = `${part}-${item.id}`;
  if (own === null && gives) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[0.875rem] font-medium text-text-muted">{label}</span>
        <p className="m-0 whitespace-pre-wrap rounded-aw bg-bg-secondary px-3 py-2 text-[0.9375rem]">{teaching ?? t("presentation.editor.teachingEmpty")}</p>
        <div className="flex flex-wrap items-center gap-2 text-[0.875rem] text-text-muted">
          <span>{t("presentation.editor.followsTeaching")}</span>
          <button
            type="button"
            onClick={() =>
              void onUpdate({ id: item.id, [part]: teaching ?? "" }).then(() => requestAnimationFrame(() => document.getElementById(fieldId)?.focus()))
            }
            className="min-h-11 rounded-aw px-2 font-medium text-link hover:bg-bg-secondary"
          >
            {t("presentation.editor.writeOwn")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <DraftField
      key={`${item.id}-${part}-${own === null ? "none" : "own"}`}
      inputId={fieldId}
      label={label}
      value={own ?? ""}
      multiline={part === "body"}
      rows={3}
      onSave={(value) => onUpdate({ id: item.id, [part]: value })}
      hint={
        gives ? (
          <div className="flex flex-wrap items-center gap-2 text-[0.875rem] text-text-muted">
            <span>{t("presentation.editor.ownWording")}</span>
            <button type="button" onClick={() => void onUpdate({ id: item.id, [part === "heading" ? "followHeading" : "followBody"]: true })} className="min-h-11 rounded-aw px-2 font-medium text-link hover:bg-bg-secondary">
              {t("presentation.editor.useTeaching")}
            </button>
          </div>
        ) : undefined
      }
    />
  );
}

/** What a row needs to take part in dragging: its handle, and where a dragged slide would land. */
interface RowDrag {
  handle: ReturnType<ReturnType<typeof useListDrag>["handle"]>;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
}

/** The slides in order, reordered by dragging a slide's handle (the arrows do the same by keyboard). */
function SlideList({ count, label, onDrop, render }: { count: number; label: string; onDrop: (from: number, to: number) => void; render: (index: number, drag: RowDrag) => ReactNode }) {
  const { drag, listRef, handle } = useListDrag(onDrop);
  return (
    <ol ref={listRef} aria-label={label} data-dragging={drag ? "" : undefined} className={`m-0 flex list-none flex-col gap-2 p-0 ${drag ? "select-none" : ""}`}>
      {Array.from({ length: count }, (_, index) =>
        render(index, {
          handle: handle(index),
          dragging: drag?.from === index,
          // The line shows where it would land, not where it already is.
          dropBefore: !!drag && drag.to === index && drag.to !== drag.from && drag.to !== drag.from + 1,
          dropAfter: !!drag && index === count - 1 && drag.to === count && drag.from !== count - 1,
        }),
      )}
    </ol>
  );
}

function SlideRow({
  item,
  index,
  drag,
  last,
  doc,
  image,
  page,
  images,
  preparation,
  presentationId,
  theme,
  open,
  onToggle,
  onUpdate,
  onMove,
  onRemove,
  onImageSaved,
}: {
  item: PresentationItem;
  index: number;
  drag: RowDrag;
  last: boolean;
  doc: PresentationDocument | null;
  image: string | null;
  page: Page | null;
  images: Map<string, string>;
  preparation: TeachingPreparation;
  presentationId: string;
  theme: Presentation["theme"];
  open: boolean;
  onToggle: () => void;
  onUpdate: (patch: UpdatePresentationItem) => Promise<Presentation | null>;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onImageSaved: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const slide = doc?.slides.find((s) => s.itemId === item.id) ?? null;
  const parts = doc?.slides.filter((s) => s.itemId === item.id).length ?? 0;
  const warnings = (doc?.warnings ?? []).filter((w) => w.slideId === item.id);
  const name = slide ? slideText(t, item.kind, slide.audience.heading, slide.audience.body, slide.audience.reference) : itemKindLabel(t, item.kind);
  const number = index + 1;
  const [refText, setRefText] = useState("");
  const [refError, setRefError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const material = item.source?.kind === "material" ? preparation.materials.find((m) => m.id === item.source!.id) : undefined;

  const setReference = async () => {
    setRefError(null);
    try {
      const ref = await api.referenceParse(refText);
      await onUpdate({ id: item.id, reference: ref.canonical });
      setRefText("");
    } catch (e) {
      setRefError(toApiError(e).message);
    }
  };

  return (
    <li
      aria-label={t("presentation.editor.slideLabel", { number, title: name })}
      data-drag-item=""
      data-drop={drag.dropBefore ? "before" : drag.dropAfter ? "after" : undefined}
      className={`relative flex flex-col gap-3 rounded-aw border border-border-subtle p-2 ${item.skipped ? "opacity-70" : ""} ${drag.dragging ? "opacity-50" : ""}`}
    >
      {/* Where the dragged slide would land. */}
      {(drag.dropBefore || drag.dropAfter) && (
        <span aria-hidden="true" data-drop-line="" className={`pointer-events-none absolute inset-x-0 h-1 rounded-full bg-accent ${drag.dropBefore ? "-top-1.5" : "-bottom-1.5"}`} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {/* Drag by this handle only, so text fields in the slide never start a drag. */}
        <span
          {...drag.handle}
          aria-hidden="true"
          title={t("presentation.editor.dragHint")}
          className="inline-flex min-h-11 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary active:cursor-grabbing"
        >
          <GripVertical className="size-5" />
        </span>
        <button
          id={`slide-${item.id}`}
          type="button"
          aria-expanded={open}
          aria-controls={`slide-edit-${item.id}`}
          onClick={onToggle}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-aw px-1 text-left hover:bg-bg-secondary"
        >
          <ChevronRight className={`size-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
          <span className="w-6 shrink-0 text-right font-ui text-[0.875rem] font-semibold text-text-muted">{number}</span>
          <span className="hidden w-32 shrink-0 sm:block" aria-hidden="true">
            {slide ? (
              <SlideView slide={slide.audience} kind={item.kind} theme={theme} image={image} page={page} images={images} showOverflow label="" className="rounded border border-border" />
            ) : (
              <span className="block aspect-video w-full rounded border border-dashed border-border" />
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="break-words text-[0.9375rem] font-medium text-text-strong">{name}</span>
            <span className="text-[0.8125rem] text-text-muted">
              {[
                itemKindLabel(t, item.kind),
                sourceLabel(t, item.source, preparation),
                item.skipped ? t("presentation.editor.leftOut") : "",
                parts > 1 ? t("presentation.editor.parts", { count: parts }) : "",
                item.notes.trim() ? t("presentation.editor.hasNotes") : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {warnings.map((w) => (
              <span key={w.code} className="text-[0.9375rem] font-medium text-danger">{t(`presentation.warnings.${w.code}`)}</span>
            ))}
            {page?.blocks.some((b) => b.type === "text" && b.overflow) && (
              <span className="text-[0.9375rem] font-medium text-danger">{t("presentation.templates.overflowSlide")}</span>
            )}
          </span>
        </button>
        <div className="flex items-center">
          <button id={`slide-move-${item.id}-up`} type="button" disabled={index === 0} onClick={() => onMove(-1)} aria-label={t("presentation.editor.moveUp", { number })} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-aw hover:bg-bg-secondary disabled:opacity-40">
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
          <button id={`slide-move-${item.id}-down`} type="button" disabled={last} onClick={() => onMove(1)} aria-label={t("presentation.editor.moveDown", { number })} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-aw hover:bg-bg-secondary disabled:opacity-40">
            <ArrowDown className="size-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={onRemove} aria-label={t("presentation.editor.remove", { number })} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary hover:text-danger">
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      {open && (
        <div id={`slide-edit-${item.id}`} className="flex flex-col gap-3 border-l-[3px] border-accent pb-1 pl-3 sm:ml-8">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
              <span className="text-text-muted">{t("presentation.editor.kind")}</span>
              <select value={item.kind} onChange={(e) => void onUpdate({ id: item.id, kind: e.target.value as ItemKind })} className="h-11 rounded-aw border border-border bg-bg px-2">
                {ITEM_KINDS.map((k) => (
                  <option key={k} value={k}>{itemKindLabel(t, k)}</option>
                ))}
              </select>
            </label>
            <label className="inline-flex min-h-11 items-center gap-2 text-[0.9375rem]">
              <input type="checkbox" checked={!item.skipped} onChange={(e) => void onUpdate({ id: item.id, skipped: !e.target.checked })} className="size-5" />
              {t("presentation.editor.show")}
            </label>
          </div>
          {item.kind === "pause" ? (
            <p className="m-0 text-[0.9375rem] text-text-muted">{t("presentation.editor.pauseHint")}</p>
          ) : (
            <>
              {item.kind === "scripture" && (
                <div className="flex flex-col gap-1">
                  <span className="text-[0.875rem] font-medium text-text-muted">{t("presentation.editor.passage")}</span>
                  <p className="m-0 text-[0.9375rem]">
                    {slide?.audience.reference ? referenceLabel({ ...slide.audience.reference, display: "" }) : t("presentation.editor.noPassage")}
                    {item.reference && item.source?.kind === "passage" ? ` · ${t("presentation.editor.ownPassage")}` : ""}
                  </p>
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (refText.trim()) void setReference();
                    }}
                  >
                    <label htmlFor={`ref-${item.id}`} className="sr-only">{t("presentation.editor.otherPassage")}</label>
                    <input id={`ref-${item.id}`} value={refText} onChange={(e) => setRefText(e.target.value)} placeholder={t("presentation.editor.passageHint")} className="h-11 min-w-0 flex-1 basis-40 rounded-aw border border-border bg-bg px-3 text-[0.9375rem]" />
                    <Button type="submit" className="min-h-11">{t("presentation.editor.setPassage")}</Button>
                    {item.reference && item.source?.kind === "passage" && (
                      <Button className="min-h-11" onClick={() => void onUpdate({ id: item.id, followReference: true })}>
                        {t("presentation.editor.teachingPassage")}
                      </Button>
                    )}
                  </form>
                  {refError && <p role="alert" className="m-0 text-danger">{refError}</p>}
                </div>
              )}
              <Wording item={item} part="heading" preparation={preparation} label={item.kind === "quote" ? t("presentation.editor.quoteBy") : t("presentation.editor.heading")} onUpdate={onUpdate} />
              {item.kind !== "image" && (
                <Wording
                  item={item}
                  part="body"
                  preparation={preparation}
                  label={item.kind === "question" ? t("presentation.editor.question") : item.kind === "quote" ? t("presentation.editor.quote") : t("presentation.editor.body")}
                  onUpdate={onUpdate}
                />
              )}
              {item.kind === "image" && warnings.some((w) => w.code === "imageUnavailable") && material?.standing === "found" && (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="m-0 max-w-prose text-[0.9375rem]">{t("presentation.editor.imageOffline")}</p>
                  <Button
                    className="min-h-11"
                    disabled={saving}
                    onClick={() => {
                      setSaving(true);
                      setRefError(null);
                      api
                        .presentationImageSave({ presentationId, assetId: material.id })
                        .then(onImageSaved, (e: unknown) => setRefError(toApiError(e).message))
                        .finally(() => setSaving(false));
                    }}
                  >
                    {saving ? t("presentation.editor.savingImage") : t("presentation.editor.saveImage")}
                  </Button>
                  {refError && <p role="alert" className="m-0 text-danger">{refError}</p>}
                </div>
              )}
            </>
          )}
          {slide && slide.speaker.manuscript.length > 0 && (
            <div className="flex flex-col gap-1 text-[0.9375rem]">
              <span className="text-[0.875rem] font-medium text-text-muted">{t("presentation.editor.manuscript")}</span>
              <p className="m-0 line-clamp-3 whitespace-pre-wrap text-text-muted">
                {slide.speaker.manuscript.map((m) => (m.field === "standing" ? t(`presentation.export.standings.${m.text}`, { defaultValue: m.text }) : m.text)).join("\n")}
              </p>
            </div>
          )}
          <DraftField
            key={`notes-${item.id}`}
            label={t("presentation.editor.notes")}
            value={item.notes}
            multiline
            rows={3}
            onSave={(value) => onUpdate({ id: item.id, notes: value })}
            hint={<span className="text-[0.8125rem] text-text-muted">{t("presentation.editor.notesHint")}</span>}
          />
        </div>
      )}
    </li>
  );
}

/** Adds a slide: one of the teaching's parts not yet shown, or a slide of the presentation's own. */
function AddSlide({
  presentation,
  preparation,
  onAdd,
}: {
  presentation: Presentation;
  preparation: TeachingPreparation;
  onAdd: (kind: ItemKind, source: ItemSource | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const used = new Set(presentation.items.map((i) => (i.source ? `${i.source.kind}:${i.source.id}:${i.source.field ?? ""}` : "")));
  const parts: { label: string; kind: ItemKind; source: ItemSource }[] = [];
  const fromPrep = (field: "central_message" | "introduction" | "conclusion", kind: ItemKind, present: boolean) => {
    if (present && !used.has(`preparation:${preparation.id}:${field}`))
      parts.push({ label: t(`presentation.source.field.${field}`), kind, source: { kind: "preparation", id: preparation.id, field } });
  };
  fromPrep("central_message", "text", Boolean(preparation.centralMessage?.trim()));
  fromPrep("introduction", "heading", Boolean(preparation.introduction.trim()));
  for (const p of preparation.points)
    if (!used.has(`point:${p.id}:`))
      parts.push({
        label: sourceLabel(t, { kind: "point", id: p.id, field: null }, preparation),
        kind: p.kind === "question" || (preparation.kind === "bible_study" && !p.kind) ? "question" : p.kind === "activity" ? "activity" : "heading",
        source: { kind: "point", id: p.id, field: null },
      });
  for (const p of preparation.passages)
    if (!used.has(`passage:${p.id}:`)) parts.push({ label: referenceLabel(p.reference), kind: "scripture", source: { kind: "passage", id: p.id, field: null } });
  for (const m of preparation.materials)
    if (m.kind === "image" && !used.has(`material:${m.id}:`))
      parts.push({ label: sourceLabel(t, { kind: "material", id: m.id, field: null }, preparation), kind: "image", source: { kind: "material", id: m.id, field: null } });
  fromPrep("conclusion", "heading", Boolean(preparation.conclusion.trim()));

  const choose = (kind: ItemKind, source: ItemSource | null) => {
    setOpen(false);
    onAdd(kind, source);
  };
  const OWN: ItemKind[] = ["heading", "text", "scripture", "question", "activity", "quote", "section", "pause", "title"];
  const chip = "min-h-11 rounded-full border border-border px-3 text-[0.9375rem] text-text-strong hover:bg-bg-secondary";
  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <Button ref={toggle} variant="quiet" className="min-h-11 self-start" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Plus className="size-4" aria-hidden="true" />
        {t("presentation.editor.add")}
      </Button>
      {open && (
        <div className="flex flex-col gap-3 border-l-[3px] border-border-subtle pl-3">
          {parts.length > 0 && (
            <div role="group" aria-label={t("presentation.editor.fromTeaching")} className="flex flex-col gap-1">
              <span className="text-[0.875rem] font-medium text-text-muted">{t("presentation.editor.fromTeaching")}</span>
              <div className="flex flex-wrap gap-2">
                {parts.map((p, i) => (
                  <button key={`${p.source.kind}-${p.source.id}-${p.source.field ?? ""}`} type="button" autoFocus={i === 0} onClick={() => choose(p.kind, p.source)} className={chip}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div role="group" aria-label={t("presentation.editor.ownSlide")} className="flex flex-col gap-1">
            <span className="text-[0.875rem] font-medium text-text-muted">{t("presentation.editor.ownSlide")}</span>
            <div className="flex flex-wrap gap-2">
              {OWN.map((kind, i) => (
                <button key={kind} type="button" autoFocus={parts.length === 0 && i === 0} onClick={() => choose(kind, null)} className={chip}>
                  {itemKindLabel(t, kind)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Target times to choose from (and the saved one, if it is another). */
const TARGET_MINUTES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 90, 120];
function targetChoices(saved: number | null): number[] {
  return saved && !TARGET_MINUTES.includes(saved) ? [...TARGET_MINUTES, saved].sort((a, b) => a - b) : TARGET_MINUTES;
}
