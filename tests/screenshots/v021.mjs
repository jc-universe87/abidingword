// The v0.21 review set: lemma search with homographs and grammar, word details
// in the reader, a Word Study's lemma, the import preview's word summary, and a
// Bible without annotations. The annotated Bible is the harness's CONSTRUCTED
// sample, named "Constructed sample (not Bible text)". Development only.
//
//   node tests/screenshots/v021.mjs <out-dir> [scene …]
// with the harness server running (see capture.mjs). V021_RUNS chooses the
// runs, e.g. "en:light:1280,de:light:760" (default: English light and dark at
// 1280, German and Korean at 760 in light and dark).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.SCREENSHOT_URL ?? "http://localhost:1430/tests/screenshots/index.html";
const [out, ...only] = process.argv.slice(2);
if (!out) throw new Error("usage: node tests/screenshots/v021.mjs <out-dir> [scene …]");
mkdirSync(out, { recursive: true });

const LOCALES = new URL("../../src/i18n/locales/", import.meta.url).pathname;
const strings = {};
for (const lang of ["en", "de", "ko", "fr", "es", "pt"]) {
  strings[lang] = {};
  for (const file of readdirSync(`${LOCALES}${lang}`)) strings[lang][file.replace(/\.json$/, "")] = JSON.parse(readFileSync(`${LOCALES}${lang}/${file}`, "utf8"));
}
/** A string by "namespace:dotted.key" in a language. */
const s = (lang, key) => {
  const [ns, dotted] = key.split(":");
  return dotted.split(".").reduce((node, part) => node?.[part], strings[lang][ns]) ?? key;
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function open(run, query = "") {
  const q = [query, `lang=${run.lang}`, run.theme === "dark" ? "theme=dark" : "", "scriptureWidth=520"].filter(Boolean).join("&");
  const page = await browser.newPage({ viewport: { width: run.width, height: 900 } });
  await page.goto(`${BASE}?${q}`);
  await page.getByRole("main").first().waitFor();
  await page.waitForTimeout(800);
  return page;
}
const shot = async (page, run, name) => {
  await page.waitForTimeout(500);
  await page.mouse.move(1, 1);
  const file = `${out}/${name}-${run.lang}-${run.theme}-${run.width}.png`;
  await page.screenshot({ path: file, animations: "disabled" });
  console.log(`  ${file}`);
};
const pane = (page, run) => page.getByRole("complementary", { name: s(run.lang, "app:panes.name.scripture") });
const concordance = async (page, run) => {
  await pane(page, run).getByRole("button", { name: s(run.lang, "scripture:marks.concordance") }).click();
  await page.waitForTimeout(400);
};
const lemmaSearch = async (page, run, text) => {
  const view = pane(page, run);
  await view.getByRole("radio", { name: s(run.lang, "scripture:concordance.mode.lemma") }).click();
  await view.getByLabel(s(run.lang, "scripture:concordance.lemmaLabel")).fill(text);
  await view.getByRole("button", { name: s(run.lang, "scripture:concordance.find"), exact: true }).click();
  await page.waitForTimeout(600);
};
/** Selects the first `length` characters of a verse in the reader. */
const selectVerse = async (page, verse, length) => {
  await page.evaluate(([verse, length]) => {
    const el = document.querySelector(`[data-verse-text="${verse}"]`);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(length, node.textContent.length));
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, [verse, length]);
  await page.waitForTimeout(700);
};

const scenes = {
  async "lemma-entries"(run) {
    const page = await open(run, "words=1&read=sample");
    await concordance(page, run);
    await lemmaSearch(page, run, "ברא");
    await shot(page, run, "v021-lemma-entries");
    await page.close();
  },
  async "lemma-grammar"(run) {
    const page = await open(run, "words=1&read=sample");
    await concordance(page, run);
    await lemmaSearch(page, run, "H1254a");
    await pane(page, run).getByRole("button", { name: s(run.lang, "scripture:concordance.grammar") }).click();
    await page.waitForTimeout(400);
    await shot(page, run, "v021-lemma-grammar");
    await page.close();
  },
  async "word-details"(run) {
    const page = await open(run, "words=1&read=sample");
    await selectVerse(page, "GEN.1.1", 6);
    await page.getByRole("button", { name: s(run.lang, "scripture:words.details") }).click();
    await page.waitForTimeout(400);
    await shot(page, run, "v021-word-details");
    await page.close();
  },
  async "word-study"(run) {
    const page = await open(run, "words=1");
    await page.getByRole("main").first().getByRole("button", { name: /^Creating \(word study\)/ }).first().click();
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: s(run.lang, "studies:info.study") }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: s(run.lang, "studies:header.findLemma") }).click();
    await page.waitForTimeout(800);
    await shot(page, run, "v021-word-study");
    await page.close();
  },
  async "import-preview"(run) {
    const page = await open(run, "empty=1&preview=words");
    await page.getByRole("button", { name: s(run.lang, "scripture:empty.addBible") }).first().click();
    await page.getByRole("button", { name: s(run.lang, "scripture:addBible.chooseFiles") }).click();
    await page.waitForTimeout(800);
    await shot(page, run, "v021-import-words");
    await page.close();
  },
  async untagged(run) {
    const page = await open(run, "words=1");
    await concordance(page, run);
    await shot(page, run, "v021-untagged-concordance");
    await page.close();
  },
};

const runs = (process.env.V021_RUNS ?? "en:light:1280,en:dark:1280,de:light:760,de:dark:760,ko:light:760,ko:dark:760")
  .split(",")
  .map((r) => {
    const [lang, theme, width] = r.split(":");
    return { lang, theme, width: Number(width) };
  });
for (const run of runs) {
  console.log(`${run.lang} ${run.theme} ${run.width}`);
  for (const [name, scene] of Object.entries(scenes)) {
    if (only.length && !only.includes(name)) continue;
    try {
      await scene(run);
    } catch (e) {
      console.log(`  ${name}: ${e.message.split("\n")[0]}`);
    }
  }
}
await browser.close();
