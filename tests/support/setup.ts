import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";
import i18n from "@/i18n";

// jsdom has no PointerEvent: a MouseEvent with a pointer id stands in, so
// pointer events carry coordinates and buttons as in a browser.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  (window as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent = PointerEventPolyfill;
}

// The default 1 s wait for elements is too tight on a loaded machine; waits
// still end as soon as the element appears.
configure({ asyncUtilTimeout: 5000 });

afterEach(async () => {
  cleanup();
  window.localStorage.clear();
  // Each test starts in English, the language the tests are written in.
  if (i18n.language !== "en") await i18n.changeLanguage("en");
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.paper;
});
