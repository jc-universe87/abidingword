import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
export function useDesignPages(presentationId: string, template: DocTemplate | null | undefined, requests: PageRequest[]): (kind: ItemKind, audience: AudienceSlide) => Page | null {
  const api = useApi();
  const { t, i18n } = useTranslation();
  const signature = template ? `${template.id}:${JSON.stringify(template.definition)}:${i18n.language}` : "";
  const [kept, setKept] = useState<{ signature: string; pages: Map<string, Page> }>({ signature: "", pages: new Map() });
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
    void api.presentationLayout({ id: presentationId, slides, locale: exportLocale(t) }).then(
      (result) => {
        if (!active) return;
        setKept((current) => {
          const next = new Map(current.signature === signature ? current.pages : []);
          list.forEach((k, i) => result[i] && next.set(k, result[i]!));
          return { signature, pages: next };
        });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api, presentationId, signature, missingKey, t]);

  return useCallback((kind: ItemKind, audience: AudienceSlide) => pages?.get(keyOf({ kind, audience })) ?? null, [pages]);
}

/** A passage shown for a moment, as a Scripture slide of the template. */
export function overlaySlide(overlay: { label: string; bible: string | null; verses: AudienceSlide["verses"] }): PageRequest {
  return {
    kind: "scripture",
    audience: { heading: null, body: null, reference: null, referenceLabel: overlay.label, verses: overlay.verses, bible: overlay.bible, image: null, blank: false },
  };
}
