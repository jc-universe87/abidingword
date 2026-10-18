import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLoad } from "@/hooks/useLoad";
import { useApi } from "@/lib/ApiContext";
import type { AudienceDocument, AudienceState } from "@/types/presentation";
import { palette } from "./labels";
import { SlideView } from "./SlideView";
import { overlaySlide, useDesignPages } from "./useDesignPages";
import { useSlideImages } from "./useSlideImages";

/**
 * The audience screen (v0.18), in its own window on the second display. It
 * is given audience content only (the core's audience document has no
 * speaker text, notes or sources) and shows what the Presenter View says.
 * Nothing here can be edited or clicked.
 */
const NO_SLIDES: { kind: AudienceDocument["slides"][number]["kind"]; audience: AudienceDocument["slides"][number]["audience"] }[] = [];

export function AudienceWindow({ presentationId }: { presentationId: string }) {
  const { t } = useTranslation();
  const api = useApi();
  const doc = useLoad(useCallback(() => api.presentationAudience(presentationId), [api, presentationId]));
  const [state, setState] = useState<AudienceState | null>(null);
  const images = useSlideImages(presentationId, doc.data?.images ?? []);
  const overlayRequest = state?.scripture ? overlaySlide(state.scripture) : null;
  const slides = doc.data?.slides ?? NO_SLIDES;
  const { pageFor } = useDesignPages(presentationId, doc.data?.template, overlayRequest ? [...slides, overlayRequest] : slides);

  useEffect(() => {
    let active = true;
    let stop: (() => void) | null = null;
    // Listen first, then ask where the presentation is: no move is missed in between.
    void api
      .onAudienceState((s) => {
        // Changes can arrive out of order: an older one never replaces a newer one.
        if (s.presentationId === presentationId) setState((current) => (current && (s.seq ?? 0) < (current.seq ?? 0) ? current : s));
      })
      .then(
        (unlisten) => {
          if (!active) {
            unlisten();
            return;
          }
          stop = unlisten;
          void api.presentationAudienceState().then(
            (s) => active && s && s.presentationId === presentationId && setState((current) => current ?? s),
            () => undefined,
          );
        },
        () => undefined,
      );
    return () => {
      active = false;
      stop?.();
    };
  }, [api, presentationId]);

  // A clicker or keyboard used on this screen moves the slides in the Presenter View.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      void api.presentationAudienceKey(e.key).catch(() => undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);

  const theme = doc.data?.theme ?? "dark";
  // Nothing but the background until the presenter says what to show (it may be a blank screen).
  const slide = state ? doc.data?.slides[state.index] : undefined;
  const page = slide ? (overlayRequest ? pageFor(overlayRequest.kind, overlayRequest.audience) : pageFor(slide.kind, slide.audience)) : null;
  return (
    <main
      aria-label={t("presentation.audience.title")}
      className="flex h-screen w-screen cursor-none items-center justify-center overflow-hidden"
      style={{ backgroundColor: page?.background ?? palette(theme).background }}
    >
      {doc.error && <p className="m-0 text-white">{doc.error.message}</p>}
      {slide && (
        <div className="w-full" style={{ maxWidth: page ? `${(page.width / page.height) * 100}vh` : "177.78vh" }}>
          <SlideView
            slide={slide.audience}
            kind={slide.kind}
            theme={theme}
            image={slide.audience.image ? (images.get(slide.audience.image.assetId) ?? null) : null}
            page={page}
            images={images}
            overlay={state?.scripture ?? null}
            blank={state?.blank ?? false}
            marks={state?.marks ?? null}
            label={t("presentation.presenter.position", { current: slide.index + 1, total: doc.data?.slides.length ?? 0 })}
          />
        </div>
      )}
    </main>
  );
}
