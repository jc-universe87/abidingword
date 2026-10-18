import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useApi } from "@/lib/ApiContext";
import type { AudienceSlide, ItemKind } from "@/types/presentation";
import type { Page, TemplateDefinition, TemplateRole } from "@/types/presentationTemplate";
import { exportLocale } from "./labels";
import type { PageRequest } from "./useDesignPages";

const KIND: Record<TemplateRole, ItemKind> = {
  title: "title",
  section: "section",
  heading: "heading",
  scripture: "scripture",
  quote: "quote",
  question: "question",
  image: "image",
  text: "text",
  pause: "pause",
  custom: "activity",
};

const empty: AudienceSlide = { heading: null, body: null, reference: null, referenceLabel: null, verses: [], bible: null, image: null, blank: false };

/** A sample slide for each kind, in the interface's language, to preview a design with. */
export function sampleSlide(t: TFunction, role: TemplateRole): PageRequest {
  const s = (key: string) => t(`presentation.templates.sample.${key}` as never);
  const a: AudienceSlide = { ...empty };
  switch (role) {
    case "title":
      a.heading = s("title");
      a.referenceLabel = s("reference");
      break;
    case "section":
      a.heading = s("section");
      break;
    case "scripture":
      a.referenceLabel = s("reference");
      a.verses = [{ chapter: 15, verse: 5, text: s("verse") }];
      break;
    case "quote":
      a.body = s("quote");
      a.heading = s("quoteBy");
      break;
    case "question":
      a.body = s("question");
      break;
    case "image":
      a.heading = s("section");
      break;
    case "text":
      a.body = s("text");
      break;
    case "pause":
      break;
    default:
      a.heading = s("heading");
      a.body = s("text");
  }
  if (role === "heading") {
    a.heading = s("heading");
    a.body = s("text");
  }
  return { kind: KIND[role], audience: a };
}

/** The design's images as data: addresses, by id. */
export function useTemplateImages(def: TemplateDefinition | null): Map<string, string> {
  const api = useApi();
  const [loaded, setLoaded] = useState<Map<string, string>>(new Map());
  const key = JSON.stringify(def?.assets ?? []);
  useEffect(() => {
    let active = true;
    const assets = JSON.parse(key) as TemplateDefinition["assets"];
    void Promise.all(assets.map((a) => api.presentationTemplateAsset(a).then((d) => [a.id, d] as const, () => null))).then((pairs) => {
      if (active) setLoaded(new Map(pairs.filter((p): p is readonly [string, string] => p !== null)));
    });
    return () => {
      active = false;
    };
  }, [api, key]);
  return loaded;
}

/**
 * Sample slides laid out by the core in a design not saved yet, after a
 * short pause in changes (dragging a box asks once it rests).
 */
export function useTemplatePreview(def: TemplateDefinition | null, roles: TemplateRole[]): { pages: Map<TemplateRole, Page>; error: string | null } {
  const api = useApi();
  const { t } = useTranslation();
  const [state, setState] = useState<{ pages: Map<TemplateRole, Page>; error: string | null }>({ pages: new Map(), error: null });
  const key = def ? JSON.stringify([def, roles]) : "";
  useEffect(() => {
    if (!key) return;
    let active = true;
    const [definition, wanted] = JSON.parse(key) as [TemplateDefinition, TemplateRole[]];
    const timer = window.setTimeout(() => {
      void api.presentationTemplatePreview({ definition, slides: wanted.map((r) => sampleSlide(t, r)), locale: exportLocale(t) }).then(
        (pages) => active && setState({ pages: new Map(wanted.map((r, i) => [r, pages[i]!] as const).filter(([, p]) => p)), error: null }),
        (e: unknown) => active && setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) })),
      );
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, key, t]);
  return state;
}

export function roleLabel(t: TFunction, role: TemplateRole): string {
  return t(`presentation.templates.roles.${role}` as never);
}
