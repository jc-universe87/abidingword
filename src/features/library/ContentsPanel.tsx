import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Button } from "@/design-system/Button";
import type { ContentsItem } from "@/types/library";

/** "drawer": a compact panel at the left of a wide reader. "sheet": the whole (narrow) reader. */
export type ContentsLayout = "drawer" | "sheet";

interface ContentsPanelProps {
  /** For the opening button's `aria-controls`. */
  id?: string;
  /** The source's title, for the panel's name. */
  title: string;
  items: ContentsItem[];
  /** The entries were generated from the source's headings, not carried by the source. */
  generated?: boolean;
  /** The entry the reader is currently in, if known. */
  currentId: string | null;
  layout: ContentsLayout;
  onSelect: (item: ContentsItem) => void;
  onClose: () => void;
}

/** The ids of the entries on the way to `id` (not `id` itself), outermost first; empty if it is not found. */
export function ancestorsOf(items: ContentsItem[], id: string | null): string[] {
  if (id === null) return [];
  const walk = (list: ContentsItem[], path: string[]): string[] | null => {
    for (const item of list) {
      if (item.id === id) return path;
      const found = walk(item.children, [...path, item.id]);
      if (found) return found;
    }
    return null;
  };
  return walk(items, []) ?? [];
}

/** Every entry that has entries under it. */
function branches(items: ContentsItem[], out: string[] = []): string[] {
  for (const item of items) {
    if (item.children.length > 0) {
      out.push(item.id);
      branches(item.children, out);
    }
  }
  return out;
}

/**
 * The source's table of contents (its own or generated), nested as the source
 * nests it, with deeper levels folded: the top level is always shown, and an
 * entry's subsections open with its arrow. When the panel opens, the way to
 * the current entry is unfolded so it is in view; nothing else is. It lives
 * inside the reader (so it works in the Sources pane and the full reader
 * alike) and scrolls on its own. Keyboard: Tab through the arrows and
 * entries, Enter or Space opens an entry or folds / unfolds, Escape closes
 * (and, like Close, hands focus back to whatever opened the panel, which the
 * reader does).
 */
export function ContentsPanel({ id, title, items, generated = false, currentId, layout, onSelect, onClose }: ContentsPanelProps) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLElement>(null);
  // Unfolded entries: at first only the way to the current one.
  const [open, setOpen] = useState<Set<string>>(() => new Set(ancestorsOf(items, currentId)));
  const all = branches(items);
  const everything = all.length > 0 && all.every((b) => open.has(b));
  const toggle = (branch: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (next.has(branch)) next.delete(branch);
      else next.add(branch);
      return next;
    });
  const holdsCurrent = new Set(ancestorsOf(items, currentId));

  // Open on the current entry (so a long list is already scrolled to it), else on the heading.
  useEffect(() => {
    const current = root.current?.querySelector<HTMLElement>("[aria-current='location']");
    const target = current ?? heading.current;
    target?.focus({ preventScroll: !current });
    current?.scrollIntoView?.({ block: "center" });
  }, []);

  const place = layout === "sheet" ? "absolute inset-0" : "absolute inset-y-0 left-0 w-80 max-w-[85%] border-r border-border shadow-lg";
  return (
    <nav
      id={id}
      ref={root}
      aria-label={t("library.contents.for", { title })}
      data-testid="contents-panel"
      data-layout={layout}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className={`${place} z-20 flex min-h-0 flex-col bg-bg font-ui`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3 py-1.5">
        <h3 ref={heading} tabIndex={-1} className="m-0 font-display text-[1.0625rem] font-heading text-text-strong">
          {generated ? t("library.contents.generated") : t("library.contents.title")}
        </h3>
        <div className="flex shrink-0 items-center">
          {all.length > 0 && (
            <Button variant="quiet" onClick={() => setOpen(everything ? new Set() : new Set(all))}>
              {everything ? t("library.contents.collapseAll") : t("library.contents.expandAll")}
            </Button>
          )}
          <Button variant="quiet" aria-label={t("library.contents.close")} title={t("library.contents.close")} onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {generated && items.length > 0 && <p className="m-0 px-2 pb-2 text-[0.875rem] text-text-muted">{t("library.contents.generatedNote")}</p>}
        {items.length === 0 ? (
          <p className="m-0 px-2 py-3 text-text-muted">{t("library.contents.none")}</p>
        ) : (
          <ItemList items={items} depth={0} currentId={currentId} open={open} holdsCurrent={holdsCurrent} onToggle={toggle} onSelect={onSelect} />
        )}
      </div>
    </nav>
  );
}

interface ItemListProps {
  items: ContentsItem[];
  depth: number;
  currentId: string | null;
  open: Set<string>;
  /** Entries with the current one somewhere under them. */
  holdsCurrent: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (item: ContentsItem) => void;
  id?: string;
}

function ItemList({ items, depth, currentId, open, holdsCurrent, onToggle, onSelect, id }: ItemListProps) {
  const { t } = useTranslation();
  const base = useId();
  // Deep outlines indent modestly and stop indenting after a few levels.
  const indent = `${0.25 + Math.min(depth, 5) * 0.75}rem`;
  return (
    <ul id={id} className="m-0 list-none p-0">
      {items.map((item, index) => {
        const current = item.id === currentId;
        const hasChildren = item.children.length > 0;
        const expanded = hasChildren && open.has(item.id);
        // Folded away with the current entry inside: the entry says so, so the place stays findable.
        const hidesCurrent = hasChildren && !expanded && holdsCurrent.has(item.id);
        const marked = current || hidesCurrent;
        const groupId = `${base}-${index}`;
        const label = (
          <span className="min-w-0">
            {item.title}
            {current && <span className="sr-only"> ({t("library.contents.current")})</span>}
            {hidesCurrent && <span className="sr-only"> ({t("library.contents.containsCurrent")})</span>}
          </span>
        );
        const row = `flex min-h-9 w-full items-start gap-1 rounded-aw py-1.5 pr-2 text-left text-[0.9375rem] leading-snug`;
        return (
          <li key={item.id}>
            <div className="flex items-start" style={{ paddingLeft: indent }}>
              {hasChildren ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={expanded ? groupId : undefined}
                  aria-label={t(expanded ? "library.contents.collapse" : "library.contents.expand", { title: item.title })}
                  title={t(expanded ? "library.contents.collapse" : "library.contents.expand", { title: item.title })}
                  onClick={() => onToggle(item.id)}
                  className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                >
                  {expanded ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                </button>
              ) : (
                <span aria-hidden="true" className="size-7 shrink-0" />
              )}
              {item.target ? (
                <button
                  type="button"
                  aria-current={current ? "location" : undefined}
                  onClick={() => onSelect(item)}
                  className={`${row} hover:bg-bg-secondary ${marked ? "bg-bg-secondary font-semibold text-text-strong" : "text-text"}`}
                >
                  <span aria-hidden="true" className="w-3 shrink-0">{marked ? "▸" : ""}</span>
                  {label}
                </button>
              ) : (
                <p className={`m-0 ${row} font-medium ${marked ? "text-text-strong" : "text-text-muted"}`}>
                  <span aria-hidden="true" className="w-3 shrink-0">{hidesCurrent ? "▸" : ""}</span>
                  {label}
                </p>
              )}
            </div>
            {expanded && (
              <ItemList
                id={groupId}
                items={item.children}
                depth={depth + 1}
                currentId={currentId}
                open={open}
                holdsCurrent={holdsCurrent}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Below this width of the reader itself (not the window) the contents take the whole reader as a sheet. */
export const SHEET_BELOW_PX = 560;

/**
 * Drawer or sheet, from the width the reader actually has, following the
 * pane as it is resized. Where width cannot be measured (it is 0) the
 * drawer stays.
 */
export function useContentsLayout(ref: RefObject<HTMLElement | null>, ready: boolean): ContentsLayout {
  const [layout, setLayout] = useState<ContentsLayout>("drawer");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (width > 0) setLayout(width < SHEET_BELOW_PX ? "sheet" : "drawer");
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, ready]);
  return layout;
}
