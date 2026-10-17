import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLoad } from "@/hooks/useLoad";
import { useApi } from "@/lib/ApiContext";
import type { AudienceState } from "@/types/presentation";
import { palette } from "./labels";
import { SlideView } from "./SlideView";
import { useSlideImages } from "./useSlideImages";

/**
 * The audience screen (v0.18), in its own window on the second display. It
 * is given audience content only (the core's audience document has no
 * speaker text, notes or sources) and shows what the Presenter View says.
 * Nothing here can be edited or clicked.
 */
export function AudienceWindow({ presentationId }: { presentationId: string }) {
  const { t } = useTranslation();
  const api = useApi();
  const doc = useLoad(useCallback(() => api.presentationAudience(presentationId), [api, presentationId]));
  const [state, setState] = useState<AudienceState | null>(null);
  const images = useSlideImages(presentationId, doc.data?.images ?? []);

  useEffect(() => {
    let active = true;
    let stop: (() => void) | null = null;
    // Listen first, then ask where the presentation is: no move is missed in between.
    void api
      .onAudienceState((s) => {
        if (s.presentationId === presentationId) setState(s);
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
      e.preventDefault();
      void api.presentationAudienceKey(e.key).catch(() => undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);

  const theme = doc.data?.theme ?? "dark";
  const slide = doc.data?.slides[state?.index ?? 0];
  return (
    <main
      aria-label={t("presentation.audience.title")}
      className="flex h-screen w-screen cursor-none items-center justify-center overflow-hidden"
      style={{ backgroundColor: palette(theme).background }}
    >
      {doc.error && <p className="m-0 text-white">{doc.error.message}</p>}
      {slide && (
        <div className="w-full max-w-[177.78vh]">
          <SlideView
            slide={slide.audience}
            kind={slide.kind}
            theme={theme}
            image={slide.audience.image ? (images.get(slide.audience.image.assetId) ?? null) : null}
            overlay={state?.scripture ?? null}
            blank={state?.blank ?? false}
            label={t("presentation.presenter.position", { current: slide.index + 1, total: doc.data?.slides.length ?? 0 })}
          />
        </div>
      )}
    </main>
  );
}
