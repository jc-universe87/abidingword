#!/usr/bin/env node
// npm run i18n:check — keeps the interface translatable (docs/i18n.md):
//
// 1. Locale files: every language has every area file, as valid JSON, with
//    exactly the English keys (plural keys per the language's CLDR plural
//    categories), non-empty strings, and the same {{placeholders}}.
// 2. Components: no hard-coded interface text in src/**/*.tsx — JSX text,
//    and literal values of aria-label, title, placeholder, alt, label.
//    A line that holds no interface text can be marked `// i18n-ignore`
//    (or `{/* i18n-ignore */}` in JSX).
//
// Exits with 1 and a list of problems if anything is wrong.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const localesDir = join(root, "src/i18n/locales");
const LANGUAGES = ["en", "de", "ko", "fr", "es", "pt"];
const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];
const problems = [];

// --- 1. locale files --------------------------------------------------------

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    problems.push(`${relative(root, file)}: ${error.code === "ENOENT" ? "missing" : `not valid JSON (${error.message})`}`);
    return null;
  }
}

/** { "a.b": "text" } for every string leaf. */
function flatten(value, prefix, out, file) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") out.set(path, child);
    else if (child && typeof child === "object" && !Array.isArray(child)) flatten(child, path, out, file);
    else problems.push(`${file}: "${path}" must be a string or an object`);
  }
  return out;
}

/** Splits "key_one" into ["key", "one"]; other keys have no plural form. */
function pluralParts(key) {
  const match = key.match(/^(.*)_(zero|one|two|few|many|other)$/);
  return match ? [match[1], match[2]] : [key, null];
}

/** Base keys with their plural forms, and plain keys. */
function shape(messages) {
  const plurals = new Map();
  const plain = new Map();
  for (const [key, text] of messages) {
    const [base, form] = pluralParts(key);
    if (form) {
      if (!plurals.has(base)) plurals.set(base, new Map());
      plurals.get(base).set(form, text);
    } else plain.set(key, text);
  }
  return { plurals, plain };
}

const placeholders = (text) => new Set([...text.matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)].map((m) => m[1]));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const withoutCount = (set) => new Set([...set].filter((x) => x !== "count"));

const areas = readdirSync(join(localesDir, "en"))
  .filter((f) => f.endsWith(".json"))
  .sort();
let checkedKeys = 0;

for (const area of areas) {
  const englishFile = `src/i18n/locales/en/${area}`;
  const englishJson = readJson(join(localesDir, "en", area));
  if (!englishJson) continue;
  const english = shape(flatten(englishJson, "", new Map(), englishFile));
  for (const [base, forms] of english.plurals) {
    if (!forms.has("other")) problems.push(`${englishFile}: "${base}" has plural forms but no "${base}_other"`);
  }
  checkedKeys += english.plain.size + english.plurals.size;

  for (const language of LANGUAGES.filter((l) => l !== "en")) {
    const file = `src/i18n/locales/${language}/${area}`;
    const json = readJson(join(localesDir, language, area));
    if (!json) continue;
    const local = shape(flatten(json, "", new Map(), file));
    const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories;

    for (const [key, text] of english.plain) {
      const translated = local.plain.get(key);
      if (translated === undefined) {
        problems.push(`${file}: missing "${key}"`);
        continue;
      }
      if (!translated.trim() && text.trim()) problems.push(`${file}: "${key}" is empty`);
      if (!sameSet(placeholders(text), placeholders(translated))) {
        problems.push(`${file}: "${key}" placeholders differ from English (${[...placeholders(text)].join(", ") || "none"})`);
      }
    }
    for (const key of local.plain.keys()) {
      if (!english.plain.has(key) && !english.plurals.has(key)) problems.push(`${file}: "${key}" is not in English`);
    }

    for (const [base, forms] of english.plurals) {
      const translated = local.plurals.get(base);
      if (!translated) {
        problems.push(`${file}: missing plural "${base}" (${categories.map((c) => `_${c}`).join(", ")})`);
        continue;
      }
      const expected = withoutCount(placeholders(forms.get("other") ?? ""));
      for (const category of categories) {
        const text = translated.get(category);
        if (text === undefined) problems.push(`${file}: missing "${base}_${category}"`);
        else if (!sameSet(withoutCount(placeholders(text)), expected)) {
          problems.push(`${file}: "${base}_${category}" placeholders differ from English`);
        }
      }
      for (const form of translated.keys()) {
        if (!categories.includes(form)) problems.push(`${file}: "${base}_${form}" is not a plural form of ${language}`);
      }
    }
    for (const base of local.plurals.keys()) {
      if (!english.plurals.has(base)) problems.push(`${file}: plural "${base}" is not in English`);
    }
  }
}

for (const language of LANGUAGES) {
  for (const file of readdirSync(join(localesDir, language))) {
    if (file.endsWith(".json") && !areas.includes(file)) {
      problems.push(`src/i18n/locales/${language}/${file}: no English file of that name`);
    }
  }
}

// --- 2. hard-coded interface text --------------------------------------------

const TEXT_ATTRIBUTES = new Set(["aria-label", "title", "placeholder", "alt", "label", "aria-description", "aria-placeholder"]);
const hasWords = (text) => /\p{L}/u.test(text);

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

let checkedFiles = 0;
for (const path of sourceFiles(join(root, "src"))) {
  checkedFiles += 1;
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const report = (node, what) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    if (/i18n-ignore/.test(lines[line] ?? "") || /i18n-ignore/.test(lines[line - 1] ?? "")) return;
    problems.push(`${relative(root, path)}:${line + 1}: hard-coded ${what}: ${JSON.stringify(node.getText().trim().slice(0, 60))}`);
  };
  const literalText = (expression) => {
    if (!expression) return null;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
    if (ts.isTemplateExpression(expression)) {
      return [expression.head.text, ...expression.templateSpans.map((s) => s.literal.text)].join(" ");
    }
    if (ts.isConditionalExpression(expression)) {
      return [literalText(expression.whenTrue), literalText(expression.whenFalse)].filter(Boolean).join(" ") || null;
    }
    return null;
  };
  const visit = (node) => {
    if (ts.isJsxText(node) && hasWords(node.text)) report(node, "text");
    if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText())) {
      const init = node.initializer;
      const value = init && ts.isJsxExpression(init) ? literalText(init.expression) : init ? literalText(init) : null;
      if (value && hasWords(value)) report(node, `${node.name.getText()}`);
    }
    if (ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const value = literalText(node.expression);
      if (value && hasWords(value)) report(node, "text");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (problems.length) {
  console.error(`i18n check: ${problems.length} problem(s)\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `i18n check: ${LANGUAGES.length} languages × ${areas.length} areas, ${checkedKeys} English keys, ` +
    `${checkedFiles} components — all consistent.`,
);
