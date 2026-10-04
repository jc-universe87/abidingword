import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import i18n, { setLanguage } from "@/i18n";
import { LANGUAGES, detectLanguage, initialLanguage, normaliseLanguage } from "@/i18n/languages";
import { localizeError, localizeMessage } from "@/i18n/messages";
import { referenceLabel } from "@/i18n/scripture";
import { resetLayoutPrefs } from "@/layouts/layoutPrefs";
import { toApiError } from "@/lib/api";
import { refFromCanonical } from "@/lib/scripture";
import { BOOKS } from "../support/scriptureFixture";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";
import studiesDe from "@/i18n/locales/de/studies.json";
import appDe from "@/i18n/locales/de/app.json";
import settingsDe from "@/i18n/locales/de/settings.json";

const STORED = "abiding-word.ui.language";
const bookMap = new Map(BOOKS.map((b) => [b.code, b]));
const ref = (canonical: string) => refFromCanonical(canonical, bookMap)!;

/** The value at "a.b.c" of a locale file. */
function message(language: string, area: string, path: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let value: any = i18n.getResourceBundle(language, "translation")[area];
  for (const part of path.split(".")) value = value?.[part];
  return value as string;
}

describe("choosing the interface language", () => {
  it("reduces system languages to the supported ones", () => {
    expect(detectLanguage([])).toBe("en");
    expect(detectLanguage(["zh-CN", "ja"])).toBe("en");
    expect(detectLanguage(["en-GB"])).toBe("en");
    expect(detectLanguage(["de-DE"])).toBe("de");
    expect(detectLanguage(["ko-KR"])).toBe("ko");
    expect(detectLanguage(["fr-FR"])).toBe("fr");
    expect(detectLanguage(["es-ES"])).toBe("es");
    expect(detectLanguage(["es-419"])).toBe("es");
    expect(detectLanguage(["pt-BR"])).toBe("pt");
    expect(detectLanguage(["pt-PT"])).toBe("pt");
    expect(detectLanguage(["zh", "de-AT", "fr"])).toBe("de");
    expect(normaliseLanguage("PT_br")).toBe("pt");
    expect(normaliseLanguage("xx")).toBeNull();
  });

  it("uses a saved choice first, ignores an invalid one, then the system language", () => {
    const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-CA", "en"]);
    expect(initialLanguage()).toBe("fr");
    window.localStorage.setItem(STORED, JSON.stringify("ko"));
    expect(initialLanguage()).toBe("ko");
    window.localStorage.setItem(STORED, JSON.stringify("klingon"));
    expect(initialLanguage()).toBe("fr");
    languages.mockReturnValue(["it-IT"]);
    expect(initialLanguage()).toBe("en");
    languages.mockRestore();
  });

  it("lists every language by its own name", () => {
    expect(LANGUAGES.map((l) => l.name)).toEqual(["English", "Deutsch", "한국어", "Français", "Español", "Português"]);
  });

  it("remembers an explicit choice and sets the document language", async () => {
    await act(() => setLanguage("pt"));
    expect(window.localStorage.getItem(STORED)).toBe(JSON.stringify("pt"));
    expect(document.documentElement.lang).toBe("pt");
    expect(i18n.language).toBe("pt");
  });

  it("is not touched by resetting the layout", async () => {
    await act(() => setLanguage("de"));
    resetLayoutPrefs();
    expect(window.localStorage.getItem(STORED)).toBe(JSON.stringify("de"));
  });
});

describe("translation behaviour", () => {
  it("falls back to English for text a language does not have yet", async () => {
    i18n.addResourceBundle("en", "translation", { zzTest: { onlyEnglish: "Only in English" } }, true, true);
    await i18n.changeLanguage("ko");
    expect((i18n.t as (key: string) => string)("zzTest.onlyEnglish")).toBe("Only in English");
  });

  it("interpolates values and chooses plural forms", async () => {
    expect(i18n.t("errors.library.duplicate", { title: "Institutes" })).toBe(
      "This file is already in your library as “Institutes”.",
    );
    const verses = (count: number) =>
      i18n.t("errors.bibleImport.missingVerses", { book: "John", chapter: 3, list: "4", count });
    expect(verses(1)).toBe("John 3: verse 4 not found. The expected verse structure differs from this text.");
    expect(verses(2)).toMatch(/^John 3: verses 4 not found/);
    await i18n.changeLanguage("fr");
    const french = i18n.t("errors.library.duplicate", { title: "Institutes" });
    expect(french).toContain("Institutes");
    expect(french).not.toContain("already in your library");
  });

  it("shows passages with book names in the interface language", async () => {
    expect(referenceLabel(ref("JHN.15.1-JHN.15.11"))).toBe("John 15:1–11");
    expect(referenceLabel(ref("PSA.23"))).toBe("Psalm 23");
    expect(referenceLabel(ref("JUD.1.3"))).toBe("Jude 3");
    await i18n.changeLanguage("de");
    expect(referenceLabel(ref("JHN.15.1-JHN.15.11"))).toBe("Johannes 15,1–11");
    await i18n.changeLanguage("ko");
    expect(referenceLabel(ref("JHN.15.7"))).toBe("요한복음 15:7");
    await i18n.changeLanguage("pt");
    expect(referenceLabel(ref("JHN.15.7"))).toBe("João 15:7");
  });

  it("translates coded messages from the native core, with English as the fallback", async () => {
    await i18n.changeLanguage("de");
    const error = toApiError({
      kind: "importFailed",
      message: "“a.pdf” is password-protected. Remove the protection and import it again.",
      code: "library.passwordProtected",
      params: { fileName: "a.pdf" },
    });
    expect(error.kind).toBe("importFailed");
    expect(error.message).toContain("a.pdf");
    expect(error.message).not.toContain("password-protected");
    expect(localizeMessage("reference.chapterCount", { bookCode: "ROM", count: "16" }, "Romans has 16 chapters.")).toContain(
      "Römer",
    );
    expect(localizeMessage("no.such.code", {}, "English as sent")).toBe("English as sent");
    expect(localizeError("invalidInput", "Uncoded English")).toBe("Uncoded English");
    expect(localizeError("database", "x")).toBe(message("de", "errors", "kind.database"));
  });
});

describe("switching language in the running app", () => {
  it("changes the interface at once, keeping the place in Scripture and the layout", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("WEB", "Fixture");
    api.state.settings.scripturePassage = "JHN.15";
    const { user } = await renderApp(api);
    const scripture = await screen.findByRole("complementary", { name: "Scripture" });
    expect(await within(scripture).findByRole("heading", { name: "John 15" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.selectOptions(screen.getByLabelText("Interface language"), "Deutsch");

    expect(await screen.findByRole("heading", { level: 1, name: settingsDe.title })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("de");
    expect(screen.getByRole("button", { name: appDe.toolbar.settings })).toBeInTheDocument();
    expect(window.localStorage.getItem(STORED)).toBe(JSON.stringify("de"));

    await user.click(screen.getByRole("button", { name: settingsDe.backToWorkspace }));
    const bible = await screen.findByRole("complementary", { name: appDe.panes.name.scripture });
    expect(await within(bible).findByRole("heading", { name: "Johannes 15" })).toBeInTheDocument();
    // Accessibility text follows too.
    expect(
      within(bible).getByRole("button", { name: appDe.panes.moveRight.replace("{{pane}}", appDe.panes.name.scripture) }),
    ).toBeInTheDocument();
  });

  it("keeps the language whatever data folder the app opens", async () => {
    await act(() => setLanguage("de"));
    await renderApp(createMemoryApi({ dataDirectory: "/somewhere/else/Abiding Word" }));
    expect(screen.getByRole("button", { name: appDe.toolbar.settings })).toBeInTheDocument();
  });

  it("translates labels of stored values without changing what is stored, keeping the open study", async () => {
    const api = createMemoryApi();
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
    const study = await api.studyCreate({ projectId: project.id, title: "The True Vine" });
    await api.findingCreate({ studyId: study.study.id, findingType: "question", content: "What is the fruit?" });
    const { user } = await renderApp(api);
    await user.click(within(await screen.findByRole("list", { name: "Projects" })).getByRole("button", { name: /John/ }));
    await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /The True Vine/ }));
    await screen.findByRole("textbox", { name: "Study title" });

    await act(() => setLanguage("de"));

    // Same study still open, now in German.
    expect(screen.getByRole("textbox", { name: studiesDe.editor.titleLabel })).toHaveValue("The True Vine");
    const list = await screen.findByRole("list", { name: studiesDe.findings.listLabel });
    await user.click(within(list).getByRole("button", { name: new RegExp(`^${studiesDe.findings.details}`) }));
    const select = within(list).getByLabelText(studiesDe.findings.typeLabel) as HTMLSelectElement;
    expect(select.value).toBe("question");
    expect(select.selectedOptions[0]!.textContent).toBe(studiesDe.findingType.question);
    await user.selectOptions(select, "unresolved_issue");
    await waitFor(() => expect(api.state.findings[0]!.findingType).toBe("unresolved_issue"));
    expect(select.selectedOptions[0]!.textContent).toBe(studiesDe.findingType.unresolved_issue);
  });

  it("renders the main screens in every language without showing keys", async () => {
    for (const { code } of LANGUAGES) {
      await act(() => setLanguage(code));
      const api = createMemoryApi();
      api.installFixtureBible("WEB", "Fixture");
      const { user } = await renderApp(api);
      // A raw key such as "settings.sections.language" would be a bug.
      const noKeys = () =>
        expect(document.body.textContent ?? "").not.toMatch(
          /\b(app|common|settings|studies|library|scripture|errors|books)\.[a-z]\w*\.\w+/,
        );
      // Workspace: Scripture, Study (projects) and Sources panes.
      await screen.findByRole("complementary", { name: message(code, "app", "panes.name.scripture") });
      expect(screen.getByRole("complementary", { name: message(code, "app", "panes.name.sources") })).toBeInTheDocument();
      noKeys();
      // Library.
      await user.selectOptions(screen.getByLabelText(message(code, "app", "search.scopeLabel")), "library");
      await user.type(screen.getByRole("searchbox"), "grace{Enter}");
      await screen.findByRole("heading", { level: 1, name: message(code, "library", "view.title") });
      noKeys();
      // Settings.
      const settingsLabel = message(code, "app", "toolbar.settings");
      await user.click(screen.getByRole("button", { name: settingsLabel }));
      await screen.findByRole("heading", { level: 1, name: message(code, "settings", "title") });
      noKeys();
      await waitFor(() => expect(document.documentElement.lang).toBe(code));
      cleanup();
    }
  });
});
