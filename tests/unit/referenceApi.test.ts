import { afterEach, describe, expect, it, vi } from "vitest";

// Typed passages go to the one shared reader in the native core
// (`scripture_reference_parse`, src-tauri/src/scripture/resolve.rs) with the
// interface language as a preference — never a reader of the interface's own.
const invoke = vi.fn(async (..._args: unknown[]) => ({ canonical: "JHN.15.5" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

describe("the shared reference API", () => {
  afterEach(async () => {
    invoke.mockClear();
    const { default: i18n } = await import("@/i18n");
    await i18n.changeLanguage("en");
  });

  it("sends the typed text and the interface language to scripture_reference_parse", async () => {
    const { default: i18n } = await import("@/i18n");
    const { tauriApi } = await import("@/lib/api");
    await i18n.changeLanguage("ko");
    await tauriApi.referenceParse("Johannes 15,5");
    expect(invoke).toHaveBeenCalledWith("scripture_reference_parse", { text: "Johannes 15,5", language: "ko", translationId: null });
    // The Bible being read goes along by id; the core reads its stored language tag.
    await tauriApi.referenceParse("Jn 3:5", "bible-1");
    expect(invoke).toHaveBeenCalledWith("scripture_reference_parse", { text: "Jn 3:5", language: "ko", translationId: "bible-1" });
    // Detection is not told the interface language: it is not the language of the text.
    await i18n.changeLanguage("de");
    await tauriApi.referenceDetect("Jn 3:5");
    expect(invoke).toHaveBeenCalledWith("scripture_reference_detect", { text: "Jn 3:5" });
  });
});

describe("an ambiguous typed passage", () => {
  it("lists the passages in the interface language, never a guess", async () => {
    const { default: i18n } = await import("@/i18n");
    const { localizeMessage } = await import("@/i18n/messages");
    const params = { text: "Jn 3:5", options: "Jonah 3:5 / John 3:5", books: "JON,JHN", canonicals: "JON.3.5;JHN.3.5" };
    await i18n.changeLanguage("en");
    expect(localizeMessage("reference.ambiguous", params, "")).toBe("“Jn 3:5” could mean Jonah 3:5 / John 3:5. Type more of the book’s name to choose.");
    await i18n.changeLanguage("de");
    expect(localizeMessage("reference.ambiguous", params, "")).toBe("„Jn 3:5“ kann Jona 3,5 / Johannes 3,5 bedeuten. Tippe mehr vom Buchnamen, um zu wählen.");
    await i18n.changeLanguage("ko");
    expect(localizeMessage("reference.ambiguous", params, "")).toContain("요나");
  });
});
