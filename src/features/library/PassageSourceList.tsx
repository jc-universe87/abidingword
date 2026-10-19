import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PassageLocation, PassageSourceGroup } from "@/types/library";
import type { ScriptureRef } from "@/types/scripture";
import { locatorLabel, passageReason } from "./labels";
import type { ExpansionState } from "./usePassageSourceExpansion";

interface PassageSourceListProps {
  groups: PassageSourceGroup[];
  /** Accessible name of the list. */
  label: string;
  /** The passage a link points at, written in the interface language. */
  passageLabel: (reference: ScriptureRef) => string;
  onOpen: (sourceId: string, segmentId: string) => void;
  /** Which sources show their further places. */
  expansion?: Record<string, ExpansionState>;
  onToggleMore?: (sourceId: string) => void;
}

/**
 * Sources that fit the passage being read: one entry per source (not one per
 * paragraph), its best place first and why it was chosen, a few more places
 * beneath, and a count of the rest.
 */
export function PassageSourceList({
  groups,
  label,
  passageLabel,
  onOpen,
  expansion = {},
  onToggleMore,
}: PassageSourceListProps) {
  const { t } = useTranslation();
  const prefix = useId();
  const controls = useRef<Record<string, HTMLButtonElement | null>>({});
  const reason = (place: PassageLocation) => passageReason(t, place.origin, passageLabel(place.reference));
  return (
    <ul aria-label={label} className="m-0 -mx-2 flex list-none flex-col gap-1 p-0">
      {groups.map((group, index) => {
        const [best, ...others] = group.locations;
        if (!best) return null;
        const titleId = `${prefix}-${index}`;
        const moreId = `${prefix}-${index}-more`;
        const more = expansion[group.sourceId];
        const extra = more?.open ? (more.places ?? []).slice(group.locations.length) : [];
        return (
          <li key={group.sourceId}>
            <div role="group" aria-labelledby={titleId}>
              <button
                type="button"
                onClick={() => onOpen(group.sourceId, best.segmentId)}
                className="flex w-full flex-col items-start gap-0.5 rounded-aw px-2 py-2 text-left hover:bg-text-strong/[0.06]"
              >
                {/* A source's name is readable, not loud: many of them stand one under another. */}
                <span id={titleId} className="font-medium text-text">
                  <cite className="not-italic">{group.sourceTitle}</cite>
                </span>
                <span className="type-meta">
                  {[group.author, locatorLabel(t, best.locator)].filter(Boolean).join(t("common.listSeparator"))}
                </span>
                <span className="type-meta">{reason(best)}</span>
              </button>
              {others.length > 0 && (
                <ul className="m-0 mb-1 ml-3 flex list-none flex-col border-l border-border-subtle p-0">
                  {others.map((place) => (
                    <li key={place.segmentId}>
                      <button
                        type="button"
                        onClick={() => onOpen(group.sourceId, place.segmentId)}
                        className="flex w-full flex-col items-start gap-0 rounded-aw py-1 pl-3 text-left text-[0.875rem] hover:bg-text-strong/[0.06]"
                      >
                        <span className="text-text">{locatorLabel(t, place.locator)}</span>
                        <span className="text-text-muted">{reason(place)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {group.moreLocations > 0 && onToggleMore && (
                <div
                  className="pb-2 pl-3"
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && more?.open) {
                      event.stopPropagation();
                      onToggleMore(group.sourceId);
                      controls.current[group.sourceId]?.focus();
                    }
                  }}
                >
                  {extra.length > 0 && (
                    <ul id={moreId} className="m-0 mb-1 flex list-none flex-col border-l border-border-subtle p-0">
                      {extra.map((place) => (
                        <li key={place.segmentId}>
                          <button
                            type="button"
                            onClick={() => onOpen(group.sourceId, place.segmentId)}
                            className="flex w-full flex-col items-start gap-0 rounded-aw py-1 pl-3 text-left text-[0.875rem] hover:bg-text-strong/[0.06]"
                          >
                            <span className="text-text">{locatorLabel(t, place.locator)}</span>
                            <span className="text-text-muted">{reason(place)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    ref={(node) => {
                      controls.current[group.sourceId] = node;
                    }}
                    aria-expanded={Boolean(more?.open)}
                    aria-controls={extra.length > 0 ? moreId : undefined}
                    onClick={() => onToggleMore(group.sourceId)}
                    className="rounded-sm text-left text-[0.875rem] text-text-muted underline-offset-2 hover:text-text-strong hover:underline"
                  >
                    {more?.open
                      ? t("library.pane.showFewerLocations")
                      : t("library.pane.moreLocations", { count: group.moreLocations })}
                  </button>
                  {more?.status === "loading" && (
                    <p role="status" className="m-0 pt-1 text-[0.875rem] text-text-muted">
                      {t("library.pane.loadingLocations")}
                    </p>
                  )}
                  {more?.status === "error" && (
                    <p role="alert" className="m-0 pt-1 text-[0.875rem] text-danger">
                      {t("library.pane.locationsFailed")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
