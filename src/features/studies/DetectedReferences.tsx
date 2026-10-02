import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useScripture } from "@/features/scripture/ScriptureContext";
import { referenceLabel } from "@/i18n/scripture";
import { useApi } from "@/lib/ApiContext";
import type { DetectedReference } from "@/types/scripture";

const DETECT_DELAY_MS = 600;

/**
 * Scripture references found in a piece of study text, shown as links that
 * open the passage. Detection is deterministic (native parser), runs a
 * moment after typing stops, and never changes the text.
 */
export function DetectedReferences({ text, onOpen }: { text: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const { goTo } = useScripture();
  const [found, setFound] = useState<DetectedReference[]>([]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (!/\d/.test(text)) {
        if (active) setFound([]);
        return;
      }
      api
        .referenceDetect(text)
        .then((refs) => active && setFound(refs))
        .catch(() => active && setFound([]));
    }, DETECT_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, text]);

  const unique = found.filter(
    (d, i) => found.findIndex((o) => o.reference.canonical === d.reference.canonical) === i,
  );
  if (unique.length === 0) return null;
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 text-[0.875rem] text-text-muted">
      <span>{t("studies.blocks.passagesMentioned")}</span>
      {unique.map((d) => (
        <button
          key={d.reference.canonical}
          type="button"
          onClick={() => {
            goTo(d.reference);
            onOpen();
          }}
          className="rounded text-link underline underline-offset-2 hover:no-underline"
        >
          {referenceLabel(d.reference)}
        </button>
      ))}
    </p>
  );
}
