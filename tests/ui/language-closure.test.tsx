import { act, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { manuscript } from "@/features/materials/derive";
import { shapeText, shapeWords } from "@/features/teaching/labels";
import { startSummary } from "@/features/teaching/teachingTemplates";
import { TEACHING_KINDS, type TeachingKind, type TeachingPreparation } from "@/types/teaching";
// @ts-expect-error -- a plain Node script without type declarations
import * as corpus from "../../scripts/i18n-corpus.mjs";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// The last language questions of v0.18.10, closed: kind-aware point words in
// Korean, note labels that do not depend on a note type's gender, the real
// exact-phrase search syntax in the search hints, and French reference
// examples with the comma. All text is invented for the tests.

const locales = corpus.readLocales() as Record<string, Map<string, string>>;
const LANGS = ["en", "de", "ko", "fr", "es", "pt"] as const;
const t = i18n.t.bind(i18n);

async function inLanguage<T>(lang: string, run: () => T | Promise<T>): Promise<T> {
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
  try {
    return await run();
  } finally {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  }
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Korean main points: 대지 for a sermon, 주요 내용 for other teaching", () => {
  const prep = (kind: TeachingKind | null): TeachingPreparation => ({
    id: "prep",
    studyId: "study",
    title: "Remain in the vine",
    kind,
    audience: "",
    purpose: "",
    centralMessage: null,
    introduction: "",
    conclusion: "",
    notes: "",
    points: [
      { id: "p1", position: 1, kind: null, title: "", explanation: "Stay close.", application: "", illustration: "" },
      { id: "p2", position: 2, kind: null, title: "Fruit", explanation: "It grows.", application: "", illustration: "" },
    ],
    findings: [],
    passages: [],
    materials: [],
    createdAt: "",
    updatedAt: "",
    revision: 1,
  });

  it("names a sermon's points 대지 and a talk's, youth teaching's, other teaching's or an older teaching's 주요 내용", async () => {
    await inLanguage("ko", () => {
      expect(shapeText(t, "sermon", "add")).toBe("대지 추가");
      expect(shapeText(t, "sermon", "untitled", { number: 2 })).toBe("2대지");
      for (const kind of ["talk", "youth", "other", null] as const) {
        expect(shapeText(t, kind, "title"), String(kind)).toBe("주요 내용");
        expect(shapeText(t, kind, "add"), String(kind)).toBe("주요 내용 추가");
        expect(shapeText(t, kind, "untitled", { number: 2 }), String(kind)).toBe("주요 내용 2");
        expect(shapeText(t, kind, "label", { number: 1, title: "열매" }), String(kind)).toBe("주요 내용 1: 열매");
        // The words around the points are a sermon's too.
        expect(shapeText(t, kind, "introduction")).toBe(shapeText(t, "sermon", "introduction"));
        expect(shapeText(t, kind, "explanation")).toBe(shapeText(t, "sermon", "explanation"));
      }
      // Questions and steps are untouched.
      expect(shapeText(t, "bible_study", "add")).toBe(t("studies.teaching.shape.questions.add"));
      expect(shapeText(t, "lesson", "add")).toBe(t("studies.teaching.shape.steps.add"));
    });
  });

  it("follows the kind into the format line, the template preview and the manuscript", async () => {
    await inLanguage("ko", () => {
      expect(t(`studies.teaching.format.${shapeWords("sermon")}`)).toContain("대지");
      expect(t(`studies.teaching.format.${shapeWords("talk")}`)).toContain("주요 내용");
      expect(startSummary(t, { builtin: { key: "talk", kind: "talk", points: [{ key: "", kind: null }] } } as never)).not.toContain("대지");
      const talk = manuscript(t, prep("talk")).blocks.filter((b) => b.type === "heading").map((b) => ("text" in b ? b.text : ""));
      const sermon = manuscript(t, prep("sermon")).blocks.filter((b) => b.type === "heading").map((b) => ("text" in b ? b.text : ""));
      expect(talk).toContain("주요 내용 1");
      expect(talk).toContain("주요 내용 2: Fruit");
      expect(sermon).toContain("1대지");
      expect(sermon).toContain("2대지: Fruit");
    });
  });

  it("shows a talk's canvas in Korean with 주요 내용, and nothing stored changes", async () => {
    const api = createMemoryApi();
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
    const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
    await api.teachingCreate({ studyId: study.id, title: "Youth evening", kind: "talk" });
    const before = JSON.stringify(api.state.teaching.preparations);
    await inLanguage("ko", async () => {
      const { user } = await renderApp(api);
      await user.click(within(await screen.findByRole("list", { name: "성경공부" })).getByRole("button", { name: /Abiding/ }));
      await user.click(await screen.findByRole("button", { name: "성경 가르침" }));
      expect(await screen.findByRole("heading", { name: "주요 내용" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "주요 내용 추가" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "대지" })).not.toBeInTheDocument();
    });
    expect(JSON.stringify(api.state.teaching.preparations)).toBe(before);
  });

  it("changes nothing in the other five languages", () => {
    for (const lang of LANGS.filter((l) => l !== "ko")) {
      const strings = locales[lang]!;
      for (const [key, text] of strings) {
        const general = key.match(/^studies\.teaching\.(shape|format|saveTemplate\.keeps)\.generalPoints(.*)$/);
        if (!general) continue;
        const sermon = key.replace(".generalPoints", ".points");
        expect(text, `${lang} ${key}`).toBe(strings.get(sermon));
      }
    }
  });

  it("keeps 대지 for the sermon only: text that speaks of every kind uses 주요 내용", () => {
    const ko = locales.ko!;
    for (const [key, text] of ko) {
      if (!text.includes("대지")) continue;
      expect(key, text).toMatch(/^studies\.teaching\.(shape|format|saveTemplate\.keeps)\.points\b/);
    }
    // Every kind still resolves: no kind is left without words.
    for (const kind of TEACHING_KINDS) expect(shapeWords(kind)).toBeTruthy();
  });
});

describe("note labels do not depend on the grammatical gender of a note type", () => {
  // A determiner or adjective right before {{type}} has to agree with it.
  const AGREEING = /(^|[\s¿(])(la|el|las|los|una|un|esta|este|nueva|nuevo|nova|novo|uma|um|a|o|as|os|essa|esse|le|les|une|cette|ce|nouvelle|nouveau|der|die|das|den|dem|ein|eine|einen|neue|neuer|neues|diese|dieser|dieses)\s+\{\{\s*type\s*\}\}/i;

  it("never puts an agreeing word before a note or block type", () => {
    for (const lang of ["de", "fr", "es", "pt"]) {
      for (const [key, text] of locales[lang]!) expect(text, `${lang} ${key}`).not.toMatch(AGREEING);
    }
  });

  it("reads naturally with any note type, masculine or feminine", () => {
    // A masculine word stands in for a future type: the label agrees with the generic noun, not with it.
    const cases: Record<string, [string, string]> = { es: ["comentario", "observación"], pt: ["comentário", "observação"], fr: ["commentaire", "observation"] };
    for (const [lang, words] of Object.entries(cases)) {
      for (const key of ["studies.findings.newLabel", "studies.findings.confirmDelete"]) {
        const template = locales[lang]!.get(key)!;
        for (const word of words) expect(template.replace("{{type}}", word), `${lang} ${key}`).toMatch(new RegExp(`[:(]\\s?${word}`));
      }
    }
  });
});

describe("exact-phrase search hints show the syntax the search reads", () => {
  it("show straight double quotes, in every language", () => {
    for (const lang of LANGS) {
      for (const key of ["scripture.search.queryLabel", "library.search.placeholder"]) {
        const hint = locales[lang]!.get(key)!;
        expect(hint, `${lang} ${key}`).toMatch(/"[^"]+"/);
        expect(hint, `${lang} ${key}`).not.toMatch(/[«»“”„]/);
      }
    }
  });
});

describe("French reference examples use the comma", () => {
  it("has no chapter:verse colon in any French example", () => {
    const examples = ["scripture.nav.goToPlaceholder", "studies.passages.placeholder", "studies.newStudy.passagePlaceholder", "errors.reference.empty", "errors.reference.notRecognised", "presentation.editor.passageHint", "presentation.presenter.passageHint", "presentation.templates.sample.reference", "scripture.language.hint"];
    for (const key of examples) {
      const text = locales.fr!.get(key)!;
      expect(text, key).toMatch(/\d,\d/);
      expect(text, key).not.toMatch(/\d:\d/);
    }
  });
});
