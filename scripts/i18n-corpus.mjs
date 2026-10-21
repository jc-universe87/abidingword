#!/usr/bin/env node
// npm run i18n:corpus — the six-language review corpus (v0.18.10).
//
// Reads the locale files (src/i18n/locales/<lang>/*.json) and writes, for a
// native-speaker review:
//
//   docs/i18n/native-polish-review-v0.18.10.md  every user-facing string,
//       grouped by where it appears in the product, with its key, all six
//       languages, plural forms and placeholders shown, context notes on
//       hard terms, and an automatic terminology audit;
//   docs/i18n/native-polish-priority-v0.18.10.md what is still open:
//       the approved terminology, the questions left, the strings this pass changed,
//       errors, flagged questions and the audit's findings.
//
// Deterministic and offline: the same locale files give the same documents
// (the "changed in v0.18.10" list reads the older locale files from git,
// and says so when git cannot provide them). Every key must fall into a
// product context; one that does not stops the generator, so nothing is
// silently left out. `node scripts/i18n-corpus.mjs --check` fails when the
// review document is not what the locale files make now.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const LOCALES = join(root, "src/i18n/locales");
export const LANGUAGES = ["en", "de", "ko", "fr", "es", "pt"];
const NAMES = { en: "English", de: "German", ko: "Korean", fr: "French", es: "Spanish", pt: "Portuguese" };
export const REVIEW = "docs/i18n/native-polish-review-v0.18.10.md";
export const PRIORITY = "docs/i18n/native-polish-priority-v0.18.10.md";
/** The end of v0.18.9: strings changed after it are the v0.18.10 polish. */
const RECENT_BASE = "fb59441";
const PLURAL = /^(.*)_(zero|one|two|few|many|other)$/;

// --- reading ----------------------------------------------------------------

function flatten(value, prefix, out) {
  for (const [key, child] of Object.entries(value)) {
    const path = `${prefix}.${key}`;
    if (typeof child === "string") out.set(path, child);
    else flatten(child, path, out);
  }
  return out;
}

/** { lang: Map(fullKey → text) }, the namespace (file) first: "studies.teaching.start". */
export function readLocales(read = (lang, file) => readFileSync(join(LOCALES, lang, file), "utf8")) {
  const files = readdirSync(join(LOCALES, "en")).filter((f) => f.endsWith(".json")).sort();
  const all = {};
  for (const lang of LANGUAGES) {
    all[lang] = new Map();
    for (const file of files) {
      let text;
      try {
        text = read(lang, file);
      } catch {
        continue; // A file missing: nothing from it (i18n:check reports it).
      }
      flatten(JSON.parse(text), file.replace(/\.json$/, ""), all[lang]);
    }
  }
  return all;
}

/** One entry per string, its plural forms together: { key, forms: { lang: [[form|null, text]] } }. */
export function entries(locales) {
  const byBase = new Map();
  for (const lang of LANGUAGES) {
    for (const [key, text] of locales[lang]) {
      const m = key.match(PLURAL);
      const base = m ? m[1] : key;
      if (!byBase.has(base)) byBase.set(base, { key: base, plural: false, forms: Object.fromEntries(LANGUAGES.map((l) => [l, []])) });
      const entry = byBase.get(base);
      if (m) entry.plural = true;
      entry.forms[lang].push([m ? m[2] : null, text]);
    }
  }
  const order = ["zero", "one", "two", "few", "many", "other"];
  for (const e of byBase.values()) for (const lang of LANGUAGES) e.forms[lang].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  // Only what English has: a key only another language has is a bug i18n:check reports.
  return [...byBase.values()].filter((e) => e.forms.en.length > 0).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); // by code point: the same on every machine
}

// --- product contexts -------------------------------------------------------

/**
 * Where each string appears, in the order of the product. The first rule a
 * key matches wins: the cross-cutting groups (errors, confirmations, empty
 * states) come first, then the screens. Every key must match one.
 */
export const CONTEXTS = [
  { id: "errors", title: "22. Errors", note: "Messages shown when something cannot be done. Most come from the core with a code; the interface shows this text.", match: [/^errors\./] },
  { id: "dialogs", title: "20. Dialogs and confirmations", note: "Questions asked before something is deleted or replaced, and their buttons.", match: [/confirm/i, /\.keepIt$/, /^common\.keep$/] },
  { id: "empty", title: "21. Empty states", note: "What a screen says while it has nothing in it yet.", match: [/\.empty(\.|$)/, /\.none$/, /\.noneYet$/, /\.aboutEmpty$/] },
  { id: "common", title: "23. Common words and buttons", note: "Words used on many screens: Save, Cancel, Close, Loading…, separators. Each must fit every place it appears.", match: [/^common\./] },
  { id: "workspace", title: "1. Global navigation and workspace", note: "The window, its three panes, the toolbar, searching everything, and the list of studies. \"Study\" here is a Bible Study.", match: [/^app\.(panes|toolbar|skipToStudy|startup|search)/, /^studies\.(projects|home|list|search)\./] },
  { id: "updates", title: "19. Updates and backups", note: "Checking for and installing a new version; backups made before the database changes.", match: [/^app\.updates/, /^settings\.about\./, /^settings\.summary\.(updates|about)/] },
  { id: "bibleImport", title: "3. Bible import and Bible settings", note: "Adding a Bible text from a file and managing installed Bibles. \"Bible\" here is a translation (an edition), not the book.", match: [/^scripture\.(addBible|bibles|language)\./, /^settings\.summary\.bibleTexts/] },
  { id: "marks", title: "16. Annotations and Marks", note: "Notes, highlights and bookmarks on Bible verses and in sources. \"Marks\" is the list of all of them.", match: [/^scripture\.(marks|colors)\./, /^library\.marks\./] },
  { id: "scripture", title: "2. Bible / Scripture pane", note: "Reading the Bible: navigation, search, the concordance, verse tools. Book names are the canonical names of the 66 books.", match: [/^scripture\./, /^books\./] },
  { id: "studyCreate", title: "5. Study creation", note: "\"What would you like to study?\" — the form that begins a Bible Study.", match: [/^studies\.newStudy\./] },
  { id: "studyTemplates", title: "6. Study templates", note: "A Study template is a reusable structure for a Bible Study (its parts, their order and phases). It is not a document layout, and not a church template.", match: [/^studies\.(builtin|templates|templateEditor|phase)\./] },
  { id: "assistant", title: "17. AI Assistant", note: "The optional assistant: setup in Settings and the help it offers on a Bible Teaching. It suggests; it never writes the person's text.", match: [/^settings\.assistant\./, /^settings\.summary\.assistant/, /^studies\.teaching\.(assist|standing|material)\./] },
  { id: "teachingCreate", title: "8. Teaching creation", note: "\"What would you like to prepare?\" — the form that begins a Bible Teaching from a study.", match: [/^studies\.teaching\.(prepareWhat|another|start|kindLabel|kindNone|format|startsWith)$/, /^studies\.teaching\.format\./] },
  { id: "teachingTemplates", title: "9. Teaching templates", note: "A Teaching template is a reusable structure for a Bible Teaching: its format (sermon, group Bible study, lesson…) and the points, questions or steps it starts with. Not a church template.", match: [/^studies\.teaching\.(templates|saveTemplate|starts)\./] },
  { id: "exports", title: "11. Word, PDF and text export actions", note: "Ways to take a material away: print or save as PDF, a Word document, a text (Markdown) file, the clipboard; and the presentation's own files.", match: [/^studies\.materials\.(action|status)\./, /^presentation\.export\./] },
  { id: "materials", title: "10. Materials", note: "Materials are what is prepared from a Bible Teaching: the presentation, a manuscript (leader's guide, teacher's guide), a question sheet, a worksheet or listening notes. A material is not a file: a file is how a material is saved.", match: [/^studies\.materials\./, /^studies\.teaching\.materials\./] },
  { id: "teaching", title: "7. Bible Teaching", note: "Preparing a sermon, group Bible study, lesson… from a study. The canvas has points (sermon), questions (group study) or steps (lesson).", match: [/^studies\.teaching\./] },
  { id: "study", title: "4. Bible Study", note: "A Bible Study and its parts, notes (code: findings), passages, related studies and details. \"Study\" never means generic research.", match: [/^studies\./] },
  { id: "presenter", title: "13. Presenter View", note: "Delivering a presentation: the presenter's screen, the audience screen, the timer and commands.", match: [/^presentation\.(presenter|audience)\./] },
  { id: "churchTemplates", title: "14. Church templates (presentation)", note: "A church template is the look of slides (colours, fonts, layouts, logo), imported from PowerPoint or a package. It is not a Study or Teaching template.", match: [/^presentation\.templates\./, /^presentation\.editor\.churchTemplates/] },
  { id: "presentation", title: "12. Presentation", note: "The presentation is one of the Materials (slides made from a Bible Teaching), not the umbrella word for all of them.", match: [/^presentation\./] },
  { id: "library", title: "15. Library and Sources", note: "A source is a book or document in the Library (shown in the Sources pane), not a citation.", match: [/^library\./] },
  { id: "settings", title: "18. Settings", note: "Settings sections other than Bibles, templates, the assistant and updates.", match: [/^settings\./] },
];

export function contextOf(key) {
  for (const c of CONTEXTS) if (c.match.some((r) => r.test(key))) return c.id;
  return null;
}

/** Notes on hard terms, by key prefix: what the word means here (never a suggested translation). */
const NOTES = [
  [/^studies\.view\.study$/, "\"Bible Study\": the person's study of Scripture (one of the two ways of working). Never generic research."],
  [/^studies\.view\.teaching$/, "\"Bible Teaching\": what a study leads to — a sermon, group Bible study, lesson… prepared by the person."],
  [/^studies\.teaching\.materials\.open$/, "\"Materials\": the umbrella for everything prepared from a Bible Teaching (presentation, manuscript, guides, sheets)."],
  [/^studies\.materials\.kinds\.presentation/, "\"Presentation\" here is one kind of material (the slides), not the umbrella."],
  [/^studies\.journey\./, "The study outline: the six phases a study's parts can belong to. A grouping, never a required sequence."],
  [/^studies\.add\.note$|^studies\.findingType/, "A note in a study (code: finding): an observation, a question, an insight… Not a Bible note (a mark on a verse)."],
  [/^presentation\.editor\.passage|^studies\.passages\./, "A passage is a Bible reference (John 15:1–8); its text is the passage's words."],
  [/^app\.panes\.name\.sources|^library\.view\.title/, "\"Sources\" (pane) and \"Library\": books and documents the person added. A source is not a citation."],
  [/^presentation\.export\.labels\.citations/, "Citations: the sources a slide quotes, listed for the audience."],
  [/^common\.listSeparator|^common\.labelSeparator/, "Punctuation used to join a list (\" · \") or a label to its value (\": \")."],
  [/^books\./, "Canonical book names, used in references (\"John 15:1\")."],
];
const noteFor = (key) => NOTES.find(([r]) => r.test(key))?.[1] ?? "";

/** Linguistic questions still open after the v0.18.10 native polish: for the owner's final spot review, not decided here. */
export const FLAGS = {
  "studies.teaching.shape.points.title": "Architecture: the \"points\" canvas serves sermon, talk, youth and other teaching alike, so Korean 대지 (a sermon term) also names a talk's or youth evening's parts. A kind-specific label would need its own keys.",
};

// --- the audit ----------------------------------------------------------------

const KOREAN_BANNED = ["프로젝트", "템플릿", "섹션", "블록"];
/** Formal German address: capitalised Sie/Ihr/Ihnen/Ihre… not at the start of a sentence. */
const GERMAN_FORMAL = /(?<![.!?:]\s|^|„|")\b(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/;
/** At a sentence start "Sie" is ambiguous; followed by a verb of address it is formal. */
const GERMAN_FORMAL_START = /(^|[.!?]\s)(Sie|Ihnen)\s+(können|möchten|haben|müssen|sollten|werden|finden|sehen|wählen|klicken)\b/;
/** Words that may stay as they are in every language. */
const SAME_EVERYWHERE = /^(?:[\d\s.,:;·–—()/%+×#…-]*|PDF|PPTX|DOCX|USFM|USX|OSIS|EPUB|DOCX?|Markdown|PowerPoint|Keynote|Google Slides|LibreOffice|OpenAI|Anthropic|Ollama|LM Studio|Brave|Tavily|Exa|SearXNG|SerpAPI|Wikimedia Commons|Abiding Word|[A-Z0-9]{2,6}|.*\{\{.*\}\}.*)$/;

/** Languages whose strings use the typographic apostrophe ’ throughout (English mixes both and is the source text). */
const CURLY_APOSTROPHE = ["fr", "ko"];
/** English loanwords accepted in v0.18.10 as normal software vocabulary; any other same spelling is a cognate or a name. */
const LOANWORDS = { de: ["Update", "Updates", "Design"], pt: ["Slide", "Slides", "Design"] };

/** Variants per language for the core terms, counted where the English uses the term. */
const TERM_VARIANTS = {
  "Bible Study": { en: /Bible [Ss]tud(y|ies)/, de: ["Bibelstudium", "Bibelstudien", "Studium", "Studie"], ko: ["성경공부", "공부", "연구"], fr: ["Étude biblique", "étude biblique", "étude", "Étude"], es: ["Estudio bíblico", "estudio bíblico", "estudio", "Estudio"], pt: ["Estudo bíblico", "estudo bíblico", "estudo", "Estudo"] },
  "Bible Teaching": { en: /Bible Teaching/, de: ["Bibellehre", "Lehre", "Lehreinheit"], ko: ["성경 가르침", "가르침", "설교"], fr: ["Enseignement biblique", "enseignement"], es: ["Enseñanza bíblica", "enseñanza"], pt: ["Ensino bíblico", "ensino"] },
  template: { en: /\btemplate/i, de: ["Vorlage", "Gemeindevorlage", "Template"], ko: ["틀", "서식", "템플릿"], fr: ["modèle", "Modèle"], es: ["plantilla", "Plantilla"], pt: ["modelo", "Modelo"] },
  Materials: { en: /\bMaterials?\b/, de: ["Unterlage", "Material"], ko: ["자료"], fr: ["Support", "support", "matériel"], es: ["Material", "material"], pt: ["Material", "material"] },
  presentation: { en: /\bpresentation/i, de: ["Präsentation", "Folien"], ko: ["발표", "프레젠테이션", "슬라이드"], fr: ["présentation", "Présentation"], es: ["presentación", "Presentación"], pt: ["apresentação", "Apresentação"] },
  passage: { en: /\bpassage/i, de: ["Bibelstelle", "Stelle", "Bibeltext", "Abschnitt"], ko: ["본문", "구절"], fr: ["passage", "Passage"], es: ["pasaje", "Pasaje"], pt: ["passagem", "Passagem"] },
  source: { en: /\bsources?\b/i, de: ["Quelle"], ko: ["자료", "출처"], fr: ["source", "Source"], es: ["fuente", "Fuente"], pt: ["fonte", "Fonte"] },
};

export function audit(list) {
  const findings = [];
  const add = (cls, kind, key, lang, text, note) => findings.push({ cls, kind, key, lang, text, note });
  for (const e of list) {
    const en = e.forms.en.map(([, t]) => t).join(" / ");
    for (const lang of LANGUAGES.filter((l) => l !== "en")) {
      for (const [, text] of e.forms[lang]) {
        if (lang === "de" && (GERMAN_FORMAL.test(text) || GERMAN_FORMAL_START.test(text))) add("B", "German capitalised Sie/Ihr (check: formal address, or 'they/it')", e.key, lang, text, "Policy: informal du.");
        if (lang === "ko") for (const w of KOREAN_BANNED) if (text.includes(w)) add(e.key.startsWith("presentation.") ? "C" : "B", `Korean ${w}`, e.key, lang, text, e.key.startsWith("presentation.") ? "Presentation/PowerPoint context: may be the file format's own term." : "Established project term may exist.");
        const enForm = e.forms.en.find(([f]) => f === null || f === "other")?.[1] ?? "";
        if (text === enForm && /[a-z]{4,}/.test(text) && !SAME_EVERYWHERE.test(text.trim())) {
          if (LOANWORDS[lang]?.includes(text)) add("C", "Accepted loanword", e.key, lang, text, "Normal software vocabulary in this language (decided in v0.18.10).");
          else add("C", "Same spelling as English", e.key, lang, text, "Cognate or name: the same word in this language.");
        }
        if (CURLY_APOSTROPHE.includes(lang) && /\p{L}'\p{L}/u.test(text)) add("A", "Straight apostrophe", e.key, lang, text, "This language uses the typographic apostrophe ’.");
        if (/\.\.\./.test(text)) add("A", "Three dots instead of …", e.key, lang, text, "The project uses the ellipsis character.");
      }
    }
    if (/\.\.\./.test(en)) add("A", "Three dots instead of …", e.key, "en", en, "The project uses the ellipsis character.");
  }
  // Ellipsis consistency: an English label with "…" whose translation has none (or the reverse).
  for (const e of list) {
    const en = e.forms.en[0][1];
    for (const lang of LANGUAGES.filter((l) => l !== "en")) {
      const text = e.forms[lang][0]?.[1] ?? "";
      if (en.endsWith("…") !== text.trimEnd().endsWith("…") && en.length < 60) add("B", "Ellipsis differs from English", e.key, lang, text, `English: “${en}”`);
    }
  }
  return findings;
}

/** For each core term: how each language renders it, counted over the strings whose English uses it. */
export function termUsage(list) {
  const out = {};
  for (const [term, v] of Object.entries(TERM_VARIANTS)) {
    out[term] = { strings: 0 };
    for (const lang of LANGUAGES.filter((l) => l !== "en")) out[term][lang] = Object.fromEntries(v[lang].map((w) => [w, 0]));
    for (const e of list) {
      const en = e.forms.en.map(([, t]) => t).join(" ");
      if (!v.en.test(en)) continue;
      out[term].strings += 1;
      for (const lang of LANGUAGES.filter((l) => l !== "en")) {
        const text = e.forms[lang].map(([, t]) => t).join(" ");
        // Count the longest variant found (so "Bibelstudium" is not also counted as "Studium").
        const found = [...v[lang]].sort((a, b) => b.length - a.length).find((w) => text.includes(w));
        if (found) out[term][lang][found] += 1;
        else out[term][lang]["(none of these)"] = (out[term][lang]["(none of these)"] ?? 0) + 1;
      }
    }
  }
  return out;
}

// --- writing ------------------------------------------------------------------

/** A table cell: the text as it is, safe in a Markdown table. Placeholders stay exactly as written. */
export function cell(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}
const formsCell = (forms) => forms.map(([form, text]) => (form ? `*${form}:* ${cell(text)}` : cell(text))).join("<br>");
const placeholdersOf = (forms) => [...new Set(forms.flatMap(([, t]) => [...t.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1])))];

function rowFor(e) {
  const flags = [];
  if (e.plural) flags.push("plural");
  const ph = placeholdersOf(e.forms.en);
  if (ph.length) flags.push(`{{${ph.join("}}, {{")}}}`);
  if (/(Label|label|aria|Tooltip|tooltip)$/.test(e.key) || /\.(label|aria)\./.test(e.key)) flags.push("screen-reader/label");
  const note = [noteFor(e.key), FLAGS[e.key] ? `⚑ ${FLAGS[e.key]}` : ""].filter(Boolean).join(" ");
  const context = [flags.join(", "), note].filter(Boolean).join(" — ");
  return `| ${cell(context)} | \`${e.key}\` | ${LANGUAGES.map((l) => formsCell(e.forms[l])).join(" | ")} |`;
}

const header = `| Context | Key | ${LANGUAGES.map((l) => NAMES[l]).join(" | ")} |\n|---|---|${LANGUAGES.map(() => "---").join("|")}|`;

/** Glossary rows: the established terms, read from the keys that carry them. */
export const GLOSSARY = [
  ["Bible Study", "studies.view.study", "The person's study of Scripture."],
  ["Bible Teaching", "studies.view.teaching", "What a study leads to: sermon, group Bible study, lesson…"],
  ["Study templates", "studies.templates.listLabel", "Reusable structures for a Bible Study."],
  ["Bible Teaching templates", "studies.teaching.templates.listLabel", "Reusable structures for a Bible Teaching."],
  ["Templates (Settings section)", "settings.sections.templates", "Holds Study and Teaching templates; Korean 공부·가르침 틀, while each kind stays 공부 틀 / 가르침 틀."],
  ["Save as my template", "studies.templates.saveAsMine", "Copy a built-in Study template to change it."],
  ["Save as my template (teaching)", "studies.teaching.templates.saveAsMine", "Same for a Teaching template."],
  ["Church templates", "presentation.templates.title", "The look of slides (Korean 서식); never a Study/Teaching template (틀)."],
  ["Materials", "studies.teaching.materials.open", "Everything prepared from a Bible Teaching; not files, not the Library (Korean 자료실)."],
  ["Presentation (a material)", "studies.materials.kinds.presentation.points.name", "The slides; one of the Materials."],
  ["Manuscript", "studies.materials.kinds.manuscript.points.name", "Sermon or talk as one text."],
  ["Leader's guide", "studies.materials.kinds.manuscript.questions.name", "A group study's manuscript."],
  ["Teacher's guide", "studies.materials.kinds.manuscript.steps.name", "A lesson's manuscript."],
  ["Question sheet", "studies.materials.kinds.questions.questions.name", "The group's sheet."],
  ["Worksheet", "studies.materials.kinds.worksheet.steps.name", "A lesson's sheet to hand out."],
  ["Listening notes", "studies.materials.kinds.worksheet.points.name", "A sermon's sheet to hand out."],
  ["Study outline", "studies.journey.label", "The phases of a study."],
  ["Outline (a part's place)", "studies.phase.label", "German Gliederung (not \"Im Aufbau\", which reads \"under construction\")."],
  ["Not in the outline", "studies.phase.none", "A part that belongs to no phase."],
  ["Range of Meaning", "studies.builtin.templates.word-study.sections.semantic-range.title", "Word study part: plain Bible-study words, not linguistic jargon."],
  ["Sermon: main points", "studies.teaching.shape.points.title", "Neutral sermon shape: Introduction · Main points · Conclusion."],
  ["Note (in a study)", "studies.add.note", "Code: finding."],
  ["Sources (pane)", "app.panes.name.sources", "The Library's books and documents."],
  ["Library", "library.view.title", ""],
  ["Marks", "scripture.marks.title", "Notes, highlights and bookmarks on verses."],
  ["Passage", "presentation.editor.passage", "A Bible reference."],
];

function glossaryTable(locales) {
  const rows = GLOSSARY.map(([term, key, meaning]) => {
    for (const lang of LANGUAGES) if (!locales[lang].has(key)) throw new Error(`glossary key ${key} missing in ${lang}`);
    return `| ${cell(term)} | \`${key}\` | ${LANGUAGES.map((l) => cell(locales[l].get(key))).join(" | ")} | ${cell(meaning)} |`;
  });
  return `| Term | Key | ${LANGUAGES.map((l) => NAMES[l]).join(" | ")} | Meaning |\n|---|---|${LANGUAGES.map(() => "---").join("|")}|---|\n${rows.join("\n")}`;
}

function auditTable(findings, { compactSame = true } = {}) {
  if (findings.length === 0) return "_Nothing found._";
  const same = compactSame ? findings.filter((f) => f.kind === "Same spelling as English" || f.kind === "Accepted loanword") : [];
  const rows = findings.filter((f) => !same.includes(f));
  const table = rows.length === 0 ? "_No class A or B findings._" : `| Class | Finding | Key | Language | Text | Note |\n|---|---|---|---|---|---|\n${rows.map((f) => `| ${f.cls} | ${cell(f.kind)} | \`${f.key}\` | ${f.lang} | ${cell(f.text)} | ${cell(f.note)} |`).join("\n")}`;
  if (same.length === 0) return table;
  const byLang = LANGUAGES.filter((l) => same.some((f) => f.lang === l)).map((l) => `- **${l}** (${same.filter((f) => f.lang === l).length}): ${same.filter((f) => f.lang === l).map((f) => `${cell(f.text)} (\`${f.key}\`)`).join("; ")}`);
  return `${table}\n\n**C — same spelling as English (${same.length}).** Cognates, names and accepted loanwords that are the same word in the language; listed so nothing is hidden.\n\n${byLang.join("\n")}`;
}

function termTable(usage) {
  const lines = [];
  for (const [term, u] of Object.entries(usage)) {
    lines.push(`**${term}** — ${u.strings} strings use it in English.\n`);
    lines.push(`| Language | Renderings (strings) |\n|---|---|`);
    for (const lang of LANGUAGES.filter((l) => l !== "en")) {
      const parts = Object.entries(u[lang]).filter(([, n]) => n > 0).map(([w, n]) => `${cell(w)} (${n})`);
      lines.push(`| ${NAMES[lang]} | ${parts.join(", ") || "—"} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Keys changed in any language since RECENT_BASE (null when git cannot tell). */
function recentKeys(current) {
  try {
    const old = readLocales((lang, file) => execFileSync("git", ["show", `${RECENT_BASE}:src/i18n/locales/${lang}/${file}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    if (old.en.size === 0) return null;
    const changed = new Set();
    for (const lang of LANGUAGES) for (const [k, v] of current[lang]) if (old[lang].get(k) !== v) changed.add(k.replace(PLURAL, "$1"));
    return changed;
  } catch {
    return null;
  }
}

export function withoutRecent(doc) {
  return doc.replace(/\n## 3\. [\s\S]*?(?=\n## 4\. )/, "\n## 3. (git history)\n");
}

export function build(locales = readLocales(), { withRecent = true } = {}) {
  const list = entries(locales);
  const groups = new Map(CONTEXTS.map((c) => [c.id, []]));
  const unplaced = [];
  for (const e of list) {
    const id = contextOf(e.key);
    if (id) groups.get(id).push(e);
    else unplaced.push(e.key);
  }
  if (unplaced.length) throw new Error(`keys in no product context (add a rule in scripts/i18n-corpus.mjs): ${unplaced.join(", ")}`);
  const findings = audit(list);
  const usage = termUsage(list);
  const total = [...locales.en.keys()].length;

  // The review document: everything, by context.
  const order = [...CONTEXTS].sort((a, b) => {
    const n = (c) => Number(c.title.match(/^(\d+)\./)[1]);
    return n(a) - n(b);
  });
  const review = [
    "# Six-language review corpus (v0.18.10)",
    "",
    "> Generated by `npm run i18n:corpus` from `src/i18n/locales/*/*.json`. Do not edit by hand: change the locale files and regenerate. Every key is here; plural forms are shown together (*one:*, *other:* …), and `{{placeholders}}` must stay exactly as they are.",
    "",
    `**${list.length} strings** (${total} keys counting each plural form), in ${CONTEXTS.length} groups. Context notes explain what a term means here; they never suggest a translation. ⚑ marks a question for the reviewer.`,
    "",
    "Policy: German informal *du*; Korean established project terms (성경공부, 성경 가르침, 공부 틀, 가르침 틀, 가르침 자료, 교회 서식), no generic 프로젝트 / 템플릿 / 섹션 / 블록 where a project term exists. Address: French *vous*, Spanish *tú*, Portuguese *você*.",
    "",
    "## Established terms",
    "",
    glossaryTable(locales),
    "",
    ...order.flatMap((c) => {
      const rows = groups.get(c.id);
      if (rows.length === 0) return [];
      const title = c.title.replace(/^\d+\.\s*/, "");
      const number = c.title.match(/^(\d+)\./)?.[1];
      return [`## ${number ? `${number}. ` : ""}${title} (${rows.length})`, "", `_${c.note}_`, "", header, ...rows.map((e) => rowFor(e)), ""];
    }),
    "## Automatic terminology audit",
    "",
    "Classes: **A** clear bug (fixed when found); **B** wording question still open; **C** intentional, or decided in the v0.18.10 native polish.",
    "",
    auditTable(findings),
    "",
    "## How core terms are rendered",
    "",
    termTable(usage),
  ].join("\n");

  // The priority pass.
  const byKey = new Map(list.map((e) => [e.key, e]));
  const recent = withRecent ? recentKeys(locales) : null;
  const priority = [
    "# Six-language review — what is still open (v0.18.10)",
    "",
    `> Generated by \`npm run i18n:corpus\`. The full corpus is [native-polish-review-v0.18.10.md](native-polish-review-v0.18.10.md). The v0.18.10 native polish applied the owner's decisions and a conservative pass over every language; this page holds the approved terms, the questions left, and the strings the pass changed, for the final spot review.`,
    "",
    "## 1. Approved terminology",
    "",
    "Decided in v0.18.10. The rest of the corpus follows these.",
    "",
    glossaryTable(locales),
    "",
    termTable(usage),
    "## 2. Questions left",
    "",
    Object.keys(FLAGS).length === 0
      ? "_No open linguistic questions._"
      : [header, ...Object.keys(FLAGS).map((k) => byKey.get(k)).filter(Boolean).map((e) => rowFor(e))].join("\n"),
    "",
    "## 3. Strings changed in v0.18.10",
    "",
    recent === null
      ? "_The v0.18.9 locale files could not be read from git; see the full corpus._"
      : [`${recent.size} strings changed in at least one language since v0.18.9. Spot-check these.`, "", header, ...list.filter((e) => recent.has(e.key)).map((e) => rowFor(e))].join("\n"),
    "",
    "## 4. Automatic audit findings",
    "",
    auditTable(findings),
    "",
  ].join("\n");
  return { review, priority, list, total, findings, groups };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { review, priority, list, total, findings } = build();
  if (process.argv.includes("--check")) {
    const now = readFileSync(join(root, REVIEW), "utf8");
    const nowPriority = readFileSync(join(root, PRIORITY), "utf8");
    if (now !== `${review}\n` || withoutRecent(nowPriority) !== withoutRecent(`${priority}\n`)) {
      console.error(`${REVIEW} or ${PRIORITY} is out of date: run npm run i18n:corpus`);
      process.exit(1);
    }
    console.log(`i18n corpus: ${list.length} strings (${total} keys) — up to date.`);
  } else {
    mkdirSync(dirname(join(root, REVIEW)), { recursive: true });
    writeFileSync(join(root, REVIEW), `${review}\n`);
    writeFileSync(join(root, PRIORITY), `${priority}\n`);
    console.log(`i18n corpus: ${list.length} strings (${total} keys), ${findings.length} audit findings → ${REVIEW}, ${PRIORITY}`);
  }
}
