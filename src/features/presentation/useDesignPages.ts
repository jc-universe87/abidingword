import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import type { AudienceSlide, ItemKind } from "@/types/presentation";
import type { DocTemplate, Page } from "@/types/presentationTemplate";
import { exportLocale } from "./labels";

export interface PageRequest {
  kind: ItemKind;
  audience: AudienceSlide;
}

const keyOf = (r: PageRequest) => JSON.stringify([r.kind, r.audience]);

/**
 * The audience pages of slides in the presentation's church template, laid
 * out by the core exactly as PowerPoint and PDF are (fetched once per
 * distinct slide and kept). Without a template: no pages (the built-in
 * arrangement is drawn here as before).
 */
export interface DesignPages {
  pageFor: (kind: ItemKind, audience: AudienceSlide) => Page | null;
  /** Why the pages could not be laid out (after retrying); null when they could. */
  error: string | null;
}

/** Slides laid out per call (a long presentation is asked for in parts). */
const CHUNK = 200;
const RETRIES = 2;

export function useDesignPages(presentationId: string, template: DocTemplate | null | undefined, requests: PageRequest[]): DesignPages {
  const api = useApi();
  const { t, i18n } = useTranslation();
  const signature = template ? `${template.id}:${JSON.stringify(template.definition)}:${i18n.language}` : "";
  const [kept, setKept] = useState<{ signature: string; pages: Map<string, Page> }>({ signature: "", pages: new Map() });
  const [failure, setFailure] = useState<{ key: string; attempts: number; message: string } | null>(null);
  const pages = kept.signature === signature ? kept.pages : null;
  const missingKey = signature ? [...new Set(requests.map(keyOf))].filter((k) => !pages?.has(k)).join("\n") : "";

  useEffect(() => {
    if (!signature || !missingKey) return;
    let active = true;
    const list = missingKey.split("\n");
    // Each key is the request itself.
    const slides = list.map((k) => {
      const [kind, audience] = JSON.parse(k) as [ItemKind, AudienceSlide];
      return { kind, audience };
    });
    const attempts = failure?.key === missingKey ? failure.attempts : 0;
    if (attempts > RETRIES) return;
    const parts: (typeof slides)[] = [];
    for (let i = 0; i < slides.length; i += CHUNK) parts.push(slides.slice(i, i + CHUNK));
    const timer = window.setTimeout(
      () =>
        void Promise.all(parts.map((part) => api.presentationLayout({ id: presentationId, slides: part, locale: exportLocale(t) }))).then(
          (results) => {
            if (!active) return;
            const result = results.flat();
            setFailure(null);
            setKept((current) => {
              const next = new Map(current.signature === signature ? current.pages : []);
              list.forEach((k, i) => result[i] && next.set(k, result[i]!));
              return { signature, pages: next };
            });
          },
          (e: unknown) => active && setFailure({ key: missingKey, attempts: attempts + 1, message: toApiError(e).message }),
        ),
      // A retry waits a little; the first request goes at once.
      attempts === 0 ? 0 : 1500 * attempts,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, presentationId, signature, missingKey, t, failure]);

  const pageFor = useCallback((kind: ItemKind, audience: AudienceSlide) => pages?.get(keyOf({ kind, audience })) ?? null, [pages]);
  return { pageFor, error: failure && failure.key === missingKey && failure.attempts > RETRIES ? failure.message : null };
}

/** A passage shown for a moment, as a Scripture slide of the template. */
export function overlaySlide(overlay: { label: string; bible: string | null; verses: AudienceSlide["verses"] }): PageRequest {
  return {
    kind: "scripture",
    audience: { heading: null, body: null, reference: null, referenceLabel: overlay.label, verses: overlay.verses, bible: overlay.bible, image: null, blank: false },
  };
}
