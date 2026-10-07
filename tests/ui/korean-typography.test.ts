import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (name: string) => readFileSync(join(process.cwd(), "src/design-system", name), "utf8");
const index = read("index.css");
const tokens = read("tokens.css");

// The Korean interface typography (acceptance fix for v0.9). jsdom does not lay out
// text, so these tests only pin the stylesheet's rules; whether Korean now looks
// right on Windows is for the real-display acceptance.

const rule = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return null;
  return css.slice(start, css.indexOf("}", start));
};

describe("Korean interface typography", () => {
  it("has a Korean-first interface font stack from installed fonts, outside any layer", () => {
    const korean = rule(index, ":root:lang(ko)")!;
    expect(korean).toContain("--aw-font-ui");
    // Latin from Inter, then the Korean system fonts before the generic system font
    const stack = korean.slice(korean.indexOf("--aw-font-ui"));
    const order = ['"Inter"', '"Noto Sans KR"', '"Malgun Gothic"', '"Apple SD Gothic Neo"', '"Noto Sans CJK KR"', "system-ui"].map((f) => stack.indexOf(f));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // an unlayered rule, so it beats the token in tokens.css
    const before = index.slice(0, index.indexOf(":root:lang(ko) {\n  --aw-font-ui"));
    expect((before.match(/\{/g) ?? []).length).toBe((before.match(/\}/g) ?? []).length);
  });

  it("makes Korean interface text a slightly stronger normal weight, not bold, and leaves reading text alone", () => {
    expect(index).toMatch(/:root:lang\(ko\) body \{\s*font-weight: 500;/);
    expect(index).toMatch(/:root:lang\(ko\) \.reading \{\s*font-weight: 400;/);
    expect(index).not.toMatch(/:root:lang\(ko\)[^{]*\{\s*font-weight: (6|7|8|9)00/);
  });

  it("does not change what the other languages use", () => {
    // the token is untouched: the same Latin stack, with the system Korean fonts only as a fallback
    expect(tokens).toContain('--aw-font-ui: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Malgun Gothic", "Apple SD Gothic Neo",\n    "Noto Sans KR", "Noto Sans CJK KR", sans-serif;');
    expect(tokens).toContain('--aw-font-reading: "Noto Serif", "Literata", Georgia, "Noto Serif KR"');
    // no rule for another language, and nothing that sets a weight outside Korean
    expect(index).not.toMatch(/:root:lang\((en|de|fr|es|pt)\)/);
    expect(index).not.toMatch(/(?<!:lang\(ko\) )body \{[^}]*font-weight/);
  });

  it("adds no font file and downloads nothing", () => {
    expect(index + tokens).not.toMatch(/@font-face|fonts\.googleapis|url\(.*\.(woff2?|ttf|otf)/);
  });

  it("is applied by the document language the interface already sets", async () => {
    const { setLanguage } = await import("@/i18n");
    await setLanguage("ko");
    expect(document.documentElement.lang).toBe("ko");
    expect(document.documentElement.matches(":lang(ko)")).toBe(true);
    await setLanguage("de");
    expect(document.documentElement.matches(":lang(ko)")).toBe(false);
    await setLanguage("en");
  });
});
