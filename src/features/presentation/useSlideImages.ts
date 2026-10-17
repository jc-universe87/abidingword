import { useEffect, useState } from "react";
import { useApi } from "@/lib/ApiContext";
import type { ImageAsset } from "@/types/presentation";

/** The presentation's images that are on this computer, as data: addresses, by asset id. */
export function useSlideImages(presentationId: string, images: ImageAsset[]): Map<string, string> {
  const api = useApi();
  const [loaded, setLoaded] = useState<Map<string, string>>(new Map());
  const wanted = images
    .filter((i) => i.available)
    .map((i) => `${i.id}:${i.sha256 ?? ""}`)
    .join(",");
  useEffect(() => {
    let active = true;
    const ids = wanted ? wanted.split(",").map((w) => w.split(":")[0]!) : [];
    void Promise.all(
      ids.map((id) =>
        api.presentationImage(presentationId, id).then(
          (data) => [id, data] as const,
          () => null,
        ),
      ),
    ).then((pairs) => {
      if (active) setLoaded(new Map(pairs.filter((p): p is readonly [string, string] => p !== null)));
    });
    return () => {
      active = false;
    };
  }, [api, presentationId, wanted]);
  return loaded;
}

/** The width of the window, kept current. */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

export type Layout = "phone" | "tablet" | "desktop";

/** One Presenter View that adapts: a speaker sheet on a phone, more beside it on larger screens. */
export function layoutFor(width: number): Layout {
  return width < 640 ? "phone" : width < 1024 ? "tablet" : "desktop";
}
