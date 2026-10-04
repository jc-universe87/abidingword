import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { PassageLocation, PassageSourceGroup } from "@/types/library";
import type { ScriptureRef } from "@/types/scripture";
import { locatorLabel, passageReason } from "./labels";

interface PassageSourceListProps {
  groups: PassageSourceGroup[];
  /** Accessible name of the list. */
  label: string;
  /** The passage a link points at, written in the interface language. */
  passageLabel: (reference: ScriptureRef) => string;
  onOpen: (sourceId: string, segmentId: string) => void;
}

/**
 * Sources that fit the passage being read: one entry per source (not one per
 * paragraph), its best place first and why it was chosen, a few more places
 * beneath, and a count of the rest.
 */
export function PassageSourceList({ groups, label, passageLabel, onOpen }: PassageSourceListProps) {
  const { t } = useTranslation();
  const prefix = useId();
  const reason = (place: PassageLocation) => passageReason(t, place.origin, passageLabel(place.reference));
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col p-0">
      {groups.map((group, index) => {
        const [best, ...others] = group.locations;
        if (!best) return null;
        const titleId = `${prefix}-${index}`;
        return (
          <li key={group.sourceId} className="border-t border-border-subtle">
            <div role="group" aria-labelledby={titleId}>
              <button
                type="button"
                onClick={() => onOpen(group.sourceId, best.segmentId)}
                className="flex w-full flex-col items-start gap-0.5 py-2 text-left hover:bg-bg-secondary"
              >
                <span id={titleId} className="font-semibold text-text-strong">
                  <cite className="not-italic">{group.sourceTitle}</cite>
                </span>
                <span className="text-[0.875rem] text-text-muted">
                  {[group.author, locatorLabel(t, best.locator)].filter(Boolean).join(t("common.listSeparator"))}
                </span>
                <span className="text-[0.875rem] text-text-muted">{reason(best)}</span>
              </button>
              {others.length > 0 && (
                <ul className="m-0 mb-1 ml-3 flex list-none flex-col border-l border-border-subtle p-0">
                  {others.map((place) => (
                    <li key={place.segmentId}>
                      <button
                        type="button"
                        onClick={() => onOpen(group.sourceId, place.segmentId)}
                        className="flex w-full flex-col items-start gap-0 py-1 pl-3 text-left text-[0.875rem] hover:bg-bg-secondary"
                      >
                        <span className="text-text-strong">{locatorLabel(t, place.locator)}</span>
                        <span className="text-text-muted">{reason(place)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {group.moreLocations > 0 && (
                <p className="m-0 pb-2 pl-3 text-[0.875rem] text-text-muted">
                  {t("library.pane.moreLocations", { count: group.moreLocations })}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
