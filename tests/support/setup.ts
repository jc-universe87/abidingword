import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";
import i18n from "@/i18n";

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
