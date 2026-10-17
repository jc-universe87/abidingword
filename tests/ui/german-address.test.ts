import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The German interface speaks to the person as "du", never formally (v0.16
// refinement). Quotations and source texts are not in these files.
const DIR = "src/i18n/locales/de";

function flatten(value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof value === "string") out[prefix] = value;
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

const german = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => Object.entries(flatten(JSON.parse(readFileSync(join(DIR, f), "utf8")))).map(([k, v]) => [`${f.replace(".json", "")}:${k}`, v])),
);

const load = (lang: string, area: string) => flatten(JSON.parse(readFileSync(`src/i18n/locales/${lang}/${area}.json`, "utf8")));

describe("German: informal address", () => {
  it("never addresses the person as Sie / Ihr / Ihnen", () => {
    // Capitalised in mid-sentence these are only ever the formal address.
    const formal = /(?<![.!?:„“"]\s)(?<!^)\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)\b/;
    const imperative = /\b(Wählen|Klicken|Geben|Prüfen|Fügen|Öffnen|Versuchen|Möchten|Können|Haben|Schreiben|Speichern)\s+Sie\b/;
    for (const [key, value] of Object.entries(german)) {
      expect(value, key).not.toMatch(formal);
      expect(value, key).not.toMatch(imperative);
      // At the start of a sentence "Sie" can only be "they/it", never the person: "Sie können …" etc. is formal.
      expect(value, key).not.toMatch(/(^|[.!?]\s)(Sie|Ihr|Ihre)\s+(können|möchten|haben|müssen|sollten|werden|finden|sehen|Bibelstudien|Bibliothek|Studien|Daten|Notizen|Text)\b/);
    }
  });

  it("speaks with du, with real umlauts", () => {
    const all = Object.values(german).join("\n");
    expect(all).toMatch(/\bdu\b/);
    expect(all).toMatch(/\bdeine?\b/);
    // No ASCII stand-ins for umlauts in common words.
    expect(all).not.toMatch(/\b(fuer|ueber|koennen|moechtest|waehle|pruefe|zurueck)\b/i);
  });
});

describe("terminology: Bible Study and Bible Teaching", () => {
  it("names the two views plainly in every language", () => {
    const expected: Record<string, [string, string]> = {
      en: ["Bible Study", "Bible Teaching"],
      de: ["Bibelstudium", "Bibellehre"],
      ko: ["성경공부", "성경 가르침"],
      fr: ["Étude biblique", "Enseignement biblique"],
      es: ["Estudio bíblico", "Enseñanza bíblica"],
      pt: ["Estudo bíblico", "Ensino bíblico"],
    };
    for (const [lang, [study, teaching]] of Object.entries(expected)) {
      const studies = load(lang, "studies");
      expect(studies["view.study"], lang).toBe(study);
      expect(studies["view.teaching"], lang).toBe(teaching);
    }
    expect(Object.values(german).join("\n")).not.toContain("Lehren & Predigen");
  });

  it("keeps the kinds of teaching", () => {
    const kinds = load("en", "studies");
    for (const kind of ["sermon", "bible_study", "youth", "children", "lesson", "talk", "other"]) expect(kinds[`teaching.kind.${kind}`]).toBeTruthy();
  });

  it("does not use the vague words “Erkenntnis” or “finding” in the Teaching view", () => {
    for (const lang of ["en", "de"]) {
      const studies = load(lang, "studies");
      for (const [key, value] of Object.entries(studies)) {
        if (!key.startsWith("teaching.") || key === "teaching.assist.pending.findImages" || key.startsWith("teaching.assist.visuals.")) continue;
        expect(value, `${lang} ${key}`).not.toMatch(/Erkenntnis|\bfindings?\b/i);
      }
    }
  });
});
