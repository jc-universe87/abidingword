import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain Node script without type declarations
import * as corpus from "../../scripts/i18n-corpus.mjs";

// The six-language review corpus (v0.18.10) is generated from the locale files
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
const root = join(fileURLToPath(import.meta.url), "..", "..", "..");
const reviewDoc = readFileSync(join(root, corpus.REVIEW), "utf8");
const priorityDoc = readFileSync(join(root, corpus.PRIORITY), "utf8");

describe("i18n review corpus", () => {
  it("is current: the committed review document is what the locale files make now", () => {
    expect(reviewDoc).toBe(`${built.review}\n`);
  });

  it("is current: the priority document too, apart from its git-history section", () => {
    expect(corpus.withoutRecent(priorityDoc)).toBe(corpus.withoutRecent(`${built.priority}\n`));
    expect(corpus.withoutRecent(priorityDoc)).toContain("## 4. ");
  });

  it("orders keys by code point, whatever the machine's locale", () => {
    const keys = built.list.map((e) => e.key);
    expect(keys).toEqual([...keys].sort());
  });

  it("shows every open question on its row, in the review and in the priority list", () => {
    for (const key of Object.keys(corpus.FLAGS)) {
      expect(built.list.some((e) => e.key === key), key).toBe(true);
      const rows = reviewDoc.split("\n").filter((l) => l.includes(`| \`${key}\` |`));
      expect(rows.some((row) => row.includes("⚑")), key).toBe(true);
      expect(priorityDoc, key).toContain(`\`${key}\``);
    }
  });

  it("exports every English key, plural forms included, from every namespace", () => {
    const keys: string[] = [...locales.en.keys()];
    expect(built.total).toBe(keys.length);
    const forms = built.list.reduce((n, e) => n + e.forms.en.length, 0);
    expect(forms).toBe(keys.length);
    for (const e of built.list) expect(reviewDoc, e.key).toContain(`| \`${e.key}\` |`);
    const namespaces = readdirSync(join(root, "src/i18n/locales/en")).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
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
    fake.de = new Map(locales.de);
    fake.de.set("studies.view.study", "Sie können hier beginnen.");
    const findings = corpus.build(fake, { withRecent: false }).findings as Finding[];
    expect(findings).toContainEqual(expect.objectContaining({ cls: "A", kind: "Straight apostrophe", key: "presentation.templates.title", lang: "fr" }));
    expect(findings).toContainEqual(expect.objectContaining({ kind: "Same spelling as English", key: "studies.view.teaching", lang: "fr" }));
    expect(findings).toContainEqual(expect.objectContaining({ key: "studies.view.study", lang: "de", cls: "B" }));
  });
});

describe("typography decided in v0.18.10", () => {
  it("German puts no space before the ellipsis", () => {
    for (const [key, text] of locales.de) expect(text, key).not.toMatch(/\S \u2026/);
  });

  it("never names Study or Teaching templates with the slide-design word, or the reverse (Korean)", () => {
    for (const [key, text] of locales.ko) {
      if (key.startsWith("presentation.templates.") || key === "presentation.editor.churchTemplates") expect(text, key).not.toMatch(/공부 틀|가르침 틀/);
      if (key.startsWith("studies.templates.") || key.startsWith("studies.teaching.templates.")) expect(text, key).not.toMatch(/서식/);
    }
  });
});

describe("established terms", () => {
  // Approved in the v0.18.10 native polish.
  const terms: Record<string, Record<string, string>> = {
    "studies.view.study": { de: "Bibelstudium", ko: "성경공부", fr: "Étude biblique", es: "Estudio bíblico", pt: "Estudo bíblico" },
    "studies.view.teaching": { de: "Bibellehre", ko: "성경 가르침", fr: "Enseignement biblique", es: "Enseñanza bíblica", pt: "Ensino bíblico" },
    "studies.teaching.materials.open": { de: "Unterlagen", ko: "가르침 자료", fr: "Supports", es: "Materiales", pt: "Materiais" },
    "presentation.templates.title": { de: "Gemeindevorlagen", ko: "교회 서식", fr: "Modèles pour l’église", es: "Plantillas para la iglesia", pt: "Modelos para a igreja" },
    "settings.sections.templates": { de: "Vorlagen", ko: "공부·가르침 틀", fr: "Modèles", es: "Plantillas", pt: "Modelos" },
    "studies.templates.saveAsMine": { de: "Als eigene Vorlage speichern", ko: "내 공부 틀로 저장" },
    "studies.teaching.templates.saveAsMine": { de: "Als eigene Vorlage speichern", ko: "내 가르침 틀로 저장" },
    "studies.phase.label": { de: "Gliederung", ko: "흐름", fr: "Plan", es: "Esquema", pt: "Estrutura" },
    "studies.phase.none": { de: "Nicht in der Gliederung", ko: "흐름에 넣지 않음", fr: "Hors du plan", es: "Fuera del esquema", pt: "Fora da estrutura" },
    "studies.builtin.templates.word-study.sections.semantic-range.title": { de: "Bedeutungen", ko: "의미의 범위", fr: "Sens possibles", es: "Significados", pt: "Sentidos possíveis" },
    "studies.teaching.shape.points.title": { de: "Hauptpunkte", ko: "대지", fr: "Points principaux", es: "Puntos principales", pt: "Pontos principais" },
    "presentation.templates.wide": { pt: "Panorâmico (16:9)" },
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
