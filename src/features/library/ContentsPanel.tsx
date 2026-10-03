import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
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
  /** The entry the reader is currently in, if known. */
  currentId: string | null;
  layout: ContentsLayout;
  onSelect: (item: ContentsItem) => void;
  onClose: () => void;
}

/**
 * The source's own table of contents, nested as the source nests it. It
 * lives inside the reader (so it works in the Sources pane and the full
 * reader alike) and scrolls on its own. Keyboard: Tab through the entries,
 * Enter or Space opens one, Escape closes (and, like Close, hands focus
 * back to whatever opened the panel, which the reader does).
 */
export function ContentsPanel({ id, title, items, currentId, layout, onSelect, onClose }: ContentsPanelProps) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLElement>(null);

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
          {t("library.contents.title")}
        </h3>
        <Button variant="quiet" aria-label={t("library.contents.close")} title={t("library.contents.close")} onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {items.length === 0 ? (
          <p className="m-0 px-2 py-3 text-text-muted">{t("library.contents.none")}</p>
        ) : (
          <ItemList items={items} depth={0} currentId={currentId} onSelect={onSelect} />
        )}
      </div>
    </nav>
  );
}

function ItemList({ items, depth, currentId, onSelect }: { items: ContentsItem[]; depth: number; currentId: string | null; onSelect: (item: ContentsItem) => void }) {
  const { t } = useTranslation();
  // Deep outlines indent modestly and stop indenting after a few levels.
  const indent = `${0.5 + Math.min(depth, 5) * 0.75}rem`;
  return (
    <ul className="m-0 list-none p-0">
      {items.map((item) => {
        const current = item.id === currentId;
        return (
          <li key={item.id}>
            {item.target ? (
              <button
                type="button"
                aria-current={current ? "location" : undefined}
                onClick={() => onSelect(item)}
                style={{ paddingLeft: indent }}
                className={`flex min-h-9 w-full items-start gap-1 rounded-aw py-1.5 pr-2 text-left text-[0.9375rem] leading-snug hover:bg-bg-secondary ${current ? "bg-bg-secondary font-semibold text-text-strong" : "text-text"}`}
              >
                <span aria-hidden="true" className="w-3 shrink-0">{current ? "▸" : ""}</span>
                <span className="min-w-0">
                  {item.title}
                  {current && <span className="sr-only"> ({t("library.contents.current")})</span>}
                </span>
              </button>
            ) : (
              <p style={{ paddingLeft: indent }} className="m-0 flex min-h-9 items-start gap-1 py-1.5 pr-2 text-[0.9375rem] font-medium leading-snug text-text-muted">
                <span aria-hidden="true" className="w-3 shrink-0" />
                <span className="min-w-0">{item.title}</span>
              </p>
            )}
            {item.children.length > 0 && <ItemList items={item.children} depth={depth + 1} currentId={currentId} onSelect={onSelect} />}
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
