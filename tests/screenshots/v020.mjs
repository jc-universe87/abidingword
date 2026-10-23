// The v0.20 review set: the Study with the assistant off; Help in a part with
// what would be sent, an answer with what it rests on, and keeping a point as
// a note; help with a library passage; a comparison; and an error. All answers
// are prepared in the harness (no network). Development only.
//
//   node tests/screenshots/v020.mjs <out-dir> [scene …]
// with the harness server running (see capture.mjs). V020_LANGS, V020_THEMES
// and V020_WIDTHS choose the runs (default: en, light and dark, 1280).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.SCREENSHOT_URL ?? "http://localhost:1430/tests/screenshots/index.html";
const [out, ...only] = process.argv.slice(2);
if (!out) throw new Error("usage: node tests/screenshots/v020.mjs <out-dir> [scene …]");
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
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A string with its {{values}} as wildcards. */

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function open(run, query = "") {
  const q = [query, `lang=${run.lang}`, run.theme === "dark" ? "theme=dark" : ""].filter(Boolean).join("&");
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
const main = (page) => page.getByRole("main").first();
const openStudy = async (page) => {
  await main(page).getByRole("button", { name: /^Abiding in the Vine/ }).first().click();
  await page.waitForTimeout(800);
};
/** Opens Help in the part whose writing begins with `writing` (the Observations part). */
const openHelp = async (page, run, writing = "The word “remain”") => {
  const index = await page.evaluate((writing) => {
    const parts = [...document.querySelectorAll("section")].filter((x) => x.querySelector(":scope [data-testid='part-help']"));
    return parts.findIndex((x) => [...x.querySelectorAll("textarea")].some((t) => t.value.startsWith(writing)));
  }, writing);
  const help = main(page).getByTestId("part-help").nth(Math.max(0, index));
  await help.scrollIntoViewIfNeeded();
  await help.click();
  const panel = page.getByTestId("inquiry-panel");
  await panel.getByTestId("inquiry-preview").waitFor();
  return panel;
};
const ask = async (page, run, panel) => {
  await panel.getByRole("button", { name: s(run.lang, "studies:inquiry.ask"), exact: true }).click();
  await page.waitForTimeout(700);
};
/** Selects words in a paragraph of the open reader, as a person would. */
const select = async (page, words) => {
  await page.evaluate((words) => {
    const paragraph = [...document.querySelectorAll("[data-segment-id]")].find((p) => p.textContent?.includes(words));
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    const at = paragraph.textContent.indexOf(words);
    const place = (offset) => {
      let seen = 0;
      for (const n of nodes) {
        if (offset <= seen + n.textContent.length) return [n, offset - seen];
        seen += n.textContent.length;
      }
      return [nodes.at(-1), nodes.at(-1).textContent.length];
    };
    const range = document.createRange();
    range.setStart(...place(at));
    range.setEnd(...place(at + words.length));
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, words);
  await page.waitForTimeout(500);
};
const openSource = async (page, run, title) => {
  const back = page.getByRole("button", { name: s(run.lang, "library:reader.backToSources") });
  if (await back.count()) await back.first().click();
  await page.getByRole("button", { name: new RegExp(escape(title)) }).first().click();
  await page.waitForTimeout(900);
};
const toCompare = async (page, run, words) => {
  await select(page, words);
  await page.getByRole("button", { name: s(run.lang, "library:more") }).last().click();
  await page.getByRole("menuitem", { name: s(run.lang, "library:compare.add") }).click();
  await page.waitForTimeout(400);
};

const scenes = {
  async "study-plain"(run) {
    const page = await open(run, "assistant=off");
    await openStudy(page);
    await shot(page, run, "v020-study-no-assistant");
    await page.close();
  },
  async "study-help"(run) {
    const page = await open(run, "inquiry=study");
    await openStudy(page);
    const panel = await openHelp(page, run);
    const focus = panel.getByRole("combobox", { name: s(run.lang, "studies:inquiry.study.focus") });
    const note = await focus.locator("option", { hasText: "Fruit comes from remaining" }).getAttribute("value");
    await focus.selectOption(note);
    await page.waitForTimeout(700);
    const preview = page.getByTestId("inquiry-preview");
    await preview.getByRole("button").first().click();
    await panel.scrollIntoViewIfNeeded();
    await shot(page, run, "v020-help-preview");
    await ask(page, run, page.getByTestId("inquiry-panel"));
    await page.getByTestId("inquiry-panel").getByRole("heading").last().scrollIntoViewIfNeeded();
    await shot(page, run, "v020-help-answer");
    const first = page.getByTestId("inquiry-panel").getByRole("article").first();
    await first.getByRole("button", { name: s(run.lang, "studies:inquiry.keep.open") }).click();
    await page.waitForTimeout(400);
    await first.scrollIntoViewIfNeeded();
    await shot(page, run, "v020-keep-form");
    await first.getByRole("button", { name: s(run.lang, "studies:inquiry.keep.add") }).click();
    await page.waitForTimeout(700);
    await page.getByTestId("assisted-by").first().scrollIntoViewIfNeeded();
    await shot(page, run, "v020-kept-note");
    await page.close();
  },
  async source(run) {
    const page = await open(run, "inquiry=source&sourcesOpen=1&sourcesWidth=560");
    await openStudy(page);
    await openSource(page, run, "Notes on Abiding");
    await select(page, "Remaining is not anxious striving. Romans 8:1 reminds us there is no condemnation for those who are in Christ.");
    await page.getByRole("button", { name: s(run.lang, "library:inquiry.help"), exact: true }).click();
    const panel = page.getByTestId("inquiry-panel");
    await panel.getByTestId("inquiry-preview").waitFor();
    await shot(page, run, "v020-source-preview");
    await ask(page, run, panel);
    await shot(page, run, "v020-source-answer");
    await page.close();
  },
  async compare(run) {
    const page = await open(run, "inquiry=compare&sourcesOpen=1&sourcesWidth=560");
    await openStudy(page);
    await openSource(page, run, "Notes on Abiding");
    await toCompare(page, run, "Remaining is not anxious striving.");
    await openSource(page, run, "Sermon outline: The True Vine");
    await toCompare(page, run, "we live by staying joined to him");
    await page.getByRole("button", { name: s(run.lang, "library:compare.compare") }).click();
    const panel = page.getByTestId("inquiry-panel");
    await panel.getByTestId("inquiry-preview").waitFor();
    await ask(page, run, panel);
    await shot(page, run, "v020-compare");
    await page.close();
  },
  async error(run) {
    const page = await open(run, "inquiry=error");
    await openStudy(page);
    const panel = await openHelp(page, run);
    await ask(page, run, panel);
    await panel.getByRole("alert").scrollIntoViewIfNeeded();
    await shot(page, run, "v020-error");
    await page.close();
  },
};

const list = (v, d) => (process.env[v] ? process.env[v].split(",") : d);
const runs = [];
for (const lang of list("V020_LANGS", ["en"])) for (const theme of list("V020_THEMES", ["light", "dark"])) for (const width of list("V020_WIDTHS", ["1280"])) runs.push({ lang, theme, width: Number(width) });
let failed = false;
for (const run of runs)
  for (const [name, scene] of Object.entries(scenes)) {
    if (only.length && !only.includes(name)) continue;
    try {
      await scene(run);
    } catch (e) {
      failed = true;
      console.error(`${name} (${run.lang} ${run.theme} ${run.width}): ${e.message.split("\n")[0]}`);
    }
  }
await browser.close();
process.exitCode = failed ? 1 : 0;
