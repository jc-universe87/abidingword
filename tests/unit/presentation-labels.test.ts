import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import themes from "../../resources/presentation/themes.json";
import { exportLocale, fileName, palette } from "@/features/presentation/labels";

// Helpers of the presentation interface (v0.18).

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("presentation helpers", () => {
  it("make safe file names from the title", () => {
    expect(fileName("Remain in the vine", "", "pptx")).toBe("Remain in the vine.pptx");
    expect(fileName('John 15: "abide"/remain?', "speaker sheet", "pdf")).toBe("John 15 abide remain – speaker sheet.pdf");
    expect(fileName("  \u0007  ", "", "md")).toBe("Presentation.md");
  });

  it("give the exports the words of the interface language", async () => {
    await i18n.changeLanguage("de");
    const locale = exportLocale(i18n.t);
    expect(locale.language).toBe("de-DE");
    expect(locale.bookNames.JHN).toBe("Johannes");
    expect(Object.keys(locale.bookNames)).toHaveLength(66);
    expect(locale.verseSeparator).toBe(",");
    expect(locale.labels.speakerNotes).toBe("Notizen");
    expect(locale.labels.standings.hypothetical).toBe("Erfundene Veranschaulichung");
    await i18n.changeLanguage("ko");
    expect(exportLocale(i18n.t).labels.slide).toBe("슬라이드");
  });

  it("use the same three backgrounds as the exports", () => {
    expect(Object.keys(themes)).toEqual(["light", "dark", "warm"]);
    expect(palette("warm")).toEqual(themes.warm);
  });
});
