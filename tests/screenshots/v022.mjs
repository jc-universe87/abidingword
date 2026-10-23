// The v0.22 review set: the Add a Bible guidance, the import review's
// original-language summary with its two choices, Settings → Bible texts →
// Word information, lexical-number search, and Greek word details. The Greek
// Bibles are the harness's CONSTRUCTED samples, named "(not Bible text)".
// Development only.
//
//   node tests/screenshots/v022.mjs <out-dir> [scene …]
// with the harness server running (see capture.mjs). V022_RUNS chooses the
// runs (default: English light and dark at 1280, German and Korean at 760 in
// light and dark, English narrow at 560).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.SCREENSHOT_URL ?? "http://localhost:1430/tests/screenshots/index.html";
const [out, ...only] = process.argv.slice(2);
if (!out) throw new Error("usage: node tests/screenshots/v022.mjs <out-dir> [scene …]");
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

const openSettings = async (page, run, section) => {
  await page.getByRole("button", { name: s(run.lang, "app:toolbar.settings") }).click();
  await page.waitForTimeout(500);
  const title = s(run.lang, `settings:sections.${section}`);
  const region = page.getByRole("region", { name: title });
  await region.getByRole("button", { name: title }).click();
  await region.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  return region;
};
const addBible = async (page, run) => {
  await page.getByRole("button", { name: s(run.lang, "scripture:empty.addBible") }).first().click();
  await page.waitForTimeout(500);
};

const scenes = {
  async guide(run) {
    const page = await open(run, "empty=1");
    await addBible(page, run);
    await page.getByText(s(run.lang, "scripture:addBible.guide.title")).click();
    await page.waitForTimeout(400);
    await page.getByText(s(run.lang, "scripture:addBible.guide.title")).scrollIntoViewIfNeeded();
    await shot(page, run, "v022-guide");
    await page.close();
  },
  async "import-choice"(run) {
    const page = await open(run, "empty=1&preview=robinson");
    await addBible(page, run);
    await page.getByRole("button", { name: s(run.lang, "scripture:addBible.chooseFiles") }).click();
    await page.waitForTimeout(800);
    await page.getByRole("region", { name: s(run.lang, "scripture:research.title") }).scrollIntoViewIfNeeded();
    await shot(page, run, "v022-import-grammar-choice");
    await page.close();
  },
  async "import-numbers"(run) {
    const page = await open(run, "empty=1&preview=strongs");
    await addBible(page, run);
    await page.getByRole("button", { name: s(run.lang, "scripture:addBible.chooseFiles") }).click();
    await page.waitForTimeout(800);
    await page.getByRole("region", { name: s(run.lang, "scripture:research.title") }).scrollIntoViewIfNeeded();
    await shot(page, run, "v022-import-numbers");
    await page.close();
  },
  async "settings-words"(run) {
    const page = await open(run, "wordsPreview=strongs");
    const region = await openSettings(page, run, "bibleTexts");
    await region.getByRole("button", { name: s(run.lang, "scripture:bibles.details") }).first().click();
    await region.getByRole("button", { name: s(run.lang, "scripture:bibles.words.check") }).first().click();
    await page.waitForTimeout(600);
    await region.getByRole("checkbox").first().scrollIntoViewIfNeeded();
    await shot(page, run, "v022-settings-words");
    await page.close();
  },
  async "number-search"(run) {
    const page = await open(run, "greek=numbers");
    await concordance(page, run);
    const view = pane(page, run);
    await view.getByRole("radio", { name: s(run.lang, "scripture:concordance.mode.number") }).click();
    await view.getByRole("textbox", { name: s(run.lang, "scripture:concordance.numberLabel") }).fill("g3056");
    await view.getByRole("button", { name: s(run.lang, "scripture:concordance.find"), exact: true }).click();
    await page.waitForTimeout(700);
    await shot(page, run, "v022-number-search");
    await page.close();
  },
  async "greek-details"(run) {
    const page = await open(run, "greek=robinson");
    await selectVerse(page, "JHN.1.1", 10);
    await page.getByRole("button", { name: s(run.lang, "scripture:words.details") }).click();
    await page.waitForTimeout(400);
    await shot(page, run, "v022-greek-details");
    await page.close();
  },
};

const runs = (process.env.V022_RUNS ?? "en:light:1280,en:dark:1280,de:light:760,de:dark:760,ko:light:760,ko:dark:760,en:light:560")
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
