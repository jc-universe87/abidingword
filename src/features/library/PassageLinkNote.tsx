import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useLoad } from "@/hooks/useLoad";
import { referenceLabel } from "@/i18n/scripture";
import { useApi } from "@/lib/ApiContext";
import { passageReason } from "./labels";

/** A segment is rarely linked to more than a few passages; this is a quiet note, not a list. */
const MAX_SHOWN = 3;

/**
 * Under the place a person was taken to: what it is linked to in Scripture,
 * and why. "Mentions John 15:5", "Section on John 15:1–11" (a heading names
 * it) or "Within section on John 15:1–11". Nothing is shown for a place that
 * is not linked to any passage, and nothing here can fail the reader.
 */
export function PassageLinkNote({ segmentId }: { segmentId: string }) {
  const { t } = useTranslation();
  const api = useApi();
  const links = useLoad(useCallback(() => api.sourceSegmentPassageLinks(segmentId), [api, segmentId]));
  // The same reason twice (a paragraph that cites John 15:5 three times) reads once.
  const seen = new Set<string>();
  const shown = (links.data ?? [])
    .filter((link) => {
      const key = `${link.origin}-${link.reference.canonical}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SHOWN);
  if (shown.length === 0) return null;
  return (
    <ul data-passage-note className="m-0 flex list-none flex-col gap-0 pl-4 pr-3 font-ui text-[0.875rem] text-text-muted">
      {shown.map((link) => (
        <li key={`${link.origin}-${link.reference.canonical}`}>
          {passageReason(t, link.origin, referenceLabel(link.reference))}
        </li>
      ))}
    </ul>
  );
}
