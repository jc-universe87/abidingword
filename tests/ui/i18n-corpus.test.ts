import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain Node script without type declarations
import * as corpus from "../../scripts/i18n-corpus.mjs";

// The six-language review corpus (v0.18.9) is generated from the locale files
// by scripts/i18n-corpus.mjs. These tests make sure it drops nothing, stays
// current, and that the audit's clear bugs (class A) stay fixed.
type Forms = Record<"en" | "de" | "ko" | "fr" | "es" | "pt", [string | null, string][]>;
type Entry = { key: string; plural: boolean; forms: Forms };
type Finding = { cls: string; kind: string; key: string; lang: string; text: string };

const locales = corpus.readLocales();
const built = corpus.build(locales, { withRecent: false }) as {
  review: string;
  priority: string;
  list: Entry[];
  total: number;
  findings: Finding[];
  groups: Map<string, Entry[]>;
};
const reviewDoc = readFileSync(corpus.REVIEW, "utf8");

describe("i18n review corpus", () => {
  it("is current: the committed review document is what the locale files make now", () => {
    expect(reviewDoc).toBe(`${built.review}\n`);
  });

  it("exports every English key, plural forms included, from every namespace", () => {
    const keys: string[] = [...locales.en.keys()];
    expect(built.total).toBe(keys.length);
    const forms = built.list.reduce((n, e) => n + e.forms.en.length, 0);
    expect(forms).toBe(keys.length);
    for (const e of built.list) expect(reviewDoc, e.key).toContain(`| \`${e.key}\` |`);
    const namespaces = readdirSync("src/i18n/locales/en").filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
    for (const ns of namespaces) expect(built.list.some((e) => e.key.startsWith(`${ns}.`)), ns).toBe(true);
  });

  it("places every string in exactly one of the 23 product contexts", () => {
    expect(corpus.CONTEXTS).toHaveLength(23);
    const placed = [...built.groups.values()].reduce((n, rows) => n + rows.length, 0);
    expect(placed).toBe(built.list.length);
    for (const c of corpus.CONTEXTS) expect(built.groups.get(c.id)?.length, c.id).toBeGreaterThan(0);
    expect(() => corpus.build({ ...locales, en: new Map([...locales.en, ["zzz.unplaced", "x"]]) }, { withRecent: false })).toThrow(/zzz\.unplaced/);
  });

  it("shows plural forms and placeholders exactly as the locale files have them", () => {
    const plural = built.list.find((e) => e.key === "studies.materials.scripture.missing")!;
    expect(plural.plural).toBe(true);
    const row = reviewDoc.split("\n").find((l) => l.includes("`studies.materials.scripture.missing`"))!;
    expect(row).toContain("plural");
    expect(row).toContain("{{bible}}");
    expect(row).toContain("*one:*");
    expect(row).toContain("*other:*");
    // Korean has only "other"; French, Spanish and Portuguese also "many".
    expect(plural.forms.ko.map(([f]) => f)).toEqual(["other"]);
    expect(plural.forms.fr.map(([f]) => f)).toEqual(["one", "many", "other"]);
  });

  it("escapes table characters so a string cannot break its row", () => {
    expect(corpus.cell("a | b <strong>c</strong> & d\ne")).toBe("a \\| b &lt;strong&gt;c&lt;/strong&gt; &amp; d<br>e");
  });

  it("has no clear bugs (class A) left in the audit", () => {
    expect(built.findings.filter((f) => f.cls === "A")).toEqual([]);
  });

  it("flags a straight apostrophe in French or Korean and English left in place", () => {
    const fake = { ...locales, fr: new Map(locales.fr) };
    fake.fr.set("presentation.templates.title", "Modèles de l'église");
    fake.fr.set("studies.view.teaching", "Bible Teaching");
    const findings = corpus.build(fake, { withRecent: false }).findings as Finding[];
    expect(findings).toContainEqual(expect.objectContaining({ cls: "A", kind: "Straight apostrophe", key: "presentation.templates.title", lang: "fr" }));
    expect(findings).toContainEqual(expect.objectContaining({ kind: "Same spelling as English", key: "studies.view.teaching", lang: "fr" }));
  });
});

describe("established terms", () => {
  // Locked in v0.18.9 until the native review decides otherwise.
  const terms: Record<string, Record<string, string>> = {
    "studies.view.study": { de: "Bibelstudium", ko: "성경공부", fr: "Étude biblique", es: "Estudio bíblico", pt: "Estudo bíblico" },
    "studies.view.teaching": { de: "Bibellehre", ko: "성경 가르침", fr: "Enseignement biblique", es: "Enseñanza bíblica", pt: "Ensino bíblico" },
    "studies.teaching.materials.open": { de: "Unterlagen", ko: "가르침 자료", fr: "Supports", es: "Materiales", pt: "Materiais" },
    "presentation.templates.title": { de: "Gemeindevorlagen", ko: "교회 서식", fr: "Modèles de l’église", es: "Plantillas de la iglesia", pt: "Modelos da igreja" },
    "studies.add.note": { de: "Notiz", ko: "기록", fr: "Note", es: "Apunte", pt: "Anotação" },
  };
  it.each(Object.entries(terms))("%s keeps its established rendering", (key, byLang) => {
    for (const [lang, text] of Object.entries(byLang)) expect(locales[lang].get(key), `${lang} ${key}`).toBe(text);
  });

  it("lists every established term in the review and priority documents", () => {
    for (const [, key] of corpus.GLOSSARY) {
      expect(locales.en.has(key), key).toBe(true);
      expect(built.priority).toContain(`\`${key}\``);
    }
  });
});
