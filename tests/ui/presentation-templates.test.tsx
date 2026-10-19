import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { acceptImport, textFrame, type TemplateDefinition } from "@/types/presentationTemplate";
import { createMemoryApi } from "../support/memoryApi";
import { IMPORTED } from "../support/memoryTemplates";
import { renderApp, setWindowWidth } from "../support/render";

// Church presentation templates (v0.18.1): a design chosen per presentation,
// imported from PowerPoint with an honest report, designed simply, taken to
// another computer. The slides and the teaching never change. All text is invented.

type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function setup() {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
  const prep = await api.teachingCreate({ studyId: study.id, title: "Remain in the vine", kind: "sermon", points: [{ title: "Stay connected" }] });
  await api.teachingPassageAdd({ preparationId: prep.id, reference: "JHN.15.1-JHN.15.5" });
  return api;
}

const studyPane = () => screen.getByRole("main", { name: "Study" });

async function makeSlides(user: User) {
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /Abiding/ }));
  await within(studyPane()).findByRole("textbox", { name: "Study title" });
  await user.click(within(studyPane()).getByRole("button", { name: "Bible Teaching" }));
  await user.click(await within(studyPane()).findByRole("button", { name: "Materials" }));
  // Materials (v0.18.4): the teaching's outputs; the presentation is one of them.
  await user.click(await screen.findByRole("menuitem", { name: /^Presentation/ }));
  const region = await within(studyPane()).findByRole("region", { name: "Presentation of “Remain in the vine”" });
  await user.click(within(region).getByRole("button", { name: "Make slides from the teaching" }));
  await within(region).findByRole("list", { name: "Slides" });
  await user.click(within(region).getByText("Name, design, Bible and target time"));
  return region;
}

async function addTemplate(api: ReturnType<typeof createMemoryApi>, def?: TemplateDefinition) {
  return api.presentationTemplateCreate({ name: "Grace Church", description: "", definition: def ?? acceptImport(IMPORTED, IMPORTED.suggestions, IMPORTED.definition.fonts), sourceFormat: "pptx" });
}

afterEach(async () => {
  window.localStorage.clear();
  setWindowWidth(1440);
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("church templates", () => {
  it("a template is chosen for a presentation, drawn from the core's pages, and dropped again without touching the slides", async () => {
    const api = await setup();
    const tpl = await addTemplate(api);
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    const before = structuredClone(api.state.presentation.presentations[0]!.items);
    const design = within(region).getByRole("combobox", { name: "Design" });
    await user.selectOptions(design, `template:${tpl.id}`);
    await waitFor(() => expect(api.state.presentation.presentations[0]!.templateId).toBe(tpl.id));
    // The previews are the laid-out pages (16:9 here), not the built-in arrangement.
    await waitFor(() => expect(region.querySelectorAll("[data-template-page]").length).toBeGreaterThan(0));
    expect(api.state.presentation.templates.layoutCalls).toBeGreaterThan(0);
    await user.selectOptions(design, "theme:dark");
    await waitFor(() => expect(api.state.presentation.presentations[0]!.templateId).toBeNull());
    expect(api.state.presentation.presentations[0]!.theme).toBe("dark");
    await waitFor(() => expect(region.querySelectorAll("[data-template-page]")).toHaveLength(0));
    expect(api.state.presentation.presentations[0]!.items).toEqual(before);
  });

  it("a PowerPoint design is reviewed before it is kept: report by level, fonts only replaced on request, roles suggested", async () => {
    const api = await setup();
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    await user.click(within(region).getByRole("button", { name: "Manage templates…" }));
    const manager = await screen.findByRole("dialog", { name: "Church templates" });
    expect(within(manager).getByText("No church templates yet.")).toBeInTheDocument();
    await user.click(within(manager).getByRole("button", { name: "Import from PowerPoint…" }));
    const review = await screen.findByRole("dialog", { name: "Check the imported design" });
    // Each level has words and a symbol, not colour alone.
    expect(within(review).getByRole("heading", { name: "Taken over" })).toBeInTheDocument();
    expect(within(review).getByRole("heading", { name: "Needs a look" })).toBeInTheDocument();
    expect(within(review).getByRole("heading", { name: "Cannot be reproduced (left out)" })).toBeInTheDocument();
    expect(within(review).getByText("SmartArt")).toBeInTheDocument();
    expect(within(review).getByText("The design only; the file's 3 slides are not imported")).toBeInTheDocument();
    // Montserrat SemiBold is missing: a suggestion is offered, never applied by itself.
    const replacement = within(review).getByRole("combobox", { name: "Font to use instead of Montserrat SemiBold (Bold)" });
    expect(replacement).toHaveValue("");
    await user.click(within(review).getByRole("button", { name: "Use Montserrat" }));
    expect(replacement).toHaveValue("Montserrat");
    // The obvious layouts are suggested and marked.
    const scripture = within(review).getByRole("combobox", { name: "Scripture" });
    expect(within(scripture).getByRole("option", { name: "Bible Verse (suggested)" })).toBeInTheDocument();
    expect(scripture).toHaveValue(IMPORTED.suggestions.scripture);
    // A kind can stay on the built-in arrangement.
    await user.selectOptions(within(review).getByRole("combobox", { name: "Question" }), "");
    await waitFor(() => expect(review.querySelectorAll("[data-template-page]").length).toBeGreaterThan(0));
    await user.click(within(review).getByRole("button", { name: "Keep this template" }));
    const manager2 = await screen.findByRole("dialog", { name: "Church templates" });
    expect(await within(manager2).findByText("Grace Church Sunday")).toBeInTheDocument();
    const kept = api.state.presentation.templates.templates[0]!;
    expect(kept.sourceFormat).toBe("pptx");
    expect(kept.definition.fonts.others.find((f) => f.family === "Montserrat SemiBold")?.replacement).toBe("Montserrat");
    expect(kept.definition.roles.scripture?.source).toBe("Bible Verse");
    expect(kept.definition.roles.question).toBeUndefined();
    expect(kept.report?.items.some((i) => i.code === "smartArt")).toBe(true);
  });

  it("cancelling a review keeps nothing", async () => {
    const api = await setup();
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    await user.click(within(region).getByRole("button", { name: "Manage templates…" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Church templates" })).getByRole("button", { name: "Import from PowerPoint…" }));
    const review = await screen.findByRole("dialog", { name: "Check the imported design" });
    await user.click(within(review).getByRole("button", { name: "Cancel" }));
    await screen.findByRole("dialog", { name: "Church templates" });
    expect(api.state.presentation.templates.templates).toHaveLength(0);
  });

  it("Keynote, Google Slides and LibreOffice are explained as saving to PowerPoint first", async () => {
    const api = await setup();
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    await user.click(within(region).getByRole("button", { name: "Manage templates…" }));
    const manager = await screen.findByRole("dialog", { name: "Church templates" });
    await user.click(within(manager).getByText("Keynote, Google Slides or LibreOffice?"));
    expect(within(manager).getByText(/File › Export To › PowerPoint/)).toBeVisible();
    expect(within(manager).getByText(/Microsoft PowerPoint \(\.pptx\)/)).toBeVisible();
    expect(within(manager).getByText(/OpenDocument \(\.odp\) files cannot be read directly yet/)).toBeVisible();
  });

  it("text too long for a box that may not shrink is reported in the editor, with words", async () => {
    const api = await setup();
    const def = acceptImport(IMPORTED, IMPORTED.suggestions, IMPORTED.definition.fonts);
    // The title slide's box is tiny and may not shrink.
    def.roles.title = { ...def.roles.title!, title: textFrame({ x: 100, y: 100, w: 120, h: 40, size: 60, fit: "none" }) };
    const tpl = await addTemplate(api, def);
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    await user.selectOptions(within(region).getByRole("combobox", { name: "Design" }), `template:${tpl.id}`);
    expect(await within(region).findByText(/On 1 slide the text is too long for the template's box/)).toBeInTheDocument();
    expect(within(region).getByText("Text too long for the template's box")).toBeInTheDocument();
  });

  it("a simple template is designed with the keyboard as well as by dragging", async () => {
    const api = await setup();
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    await user.click(within(region).getByRole("button", { name: "Manage templates…" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Church templates" })).getByRole("button", { name: "New template" }));
    const designer = await screen.findByRole("dialog", { name: "New church template" });
    await user.type(within(designer).getByRole("textbox", { name: "Name of the template" }), "Youth night");
    await user.click(within(designer).getByRole("radio", { name: "Standard (4:3)" }));
    await user.click(within(designer).getByRole("checkbox", { name: "Own layout for this kind" }));
    const handle = within(designer).getByRole("button", { name: /Heading box: drag to move/ });
    handle.focus();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}{ArrowDown}");
    const left = within(designer).getByRole("spinbutton", { name: "Box: distance from the left edge in points" });
    expect(left).toHaveValue(58);
    await user.tripleClick(left);
    await user.keyboard("80");
    await user.selectOptions(within(designer).getByRole("combobox", { name: "Alignment" }), "center");
    await user.click(within(designer).getByRole("button", { name: "Save template" }));
    await screen.findByRole("dialog", { name: "Church templates" });
    const kept = api.state.presentation.templates.templates[0]!;
    expect(kept.name).toBe("Youth night");
    expect(kept.sourceFormat).toBe("designer");
    expect([kept.definition.width, kept.definition.height]).toEqual([720, 540]);
    expect(kept.definition.roles.heading?.title).toMatchObject({ x: 80, y: 50, w: 624, align: "center" });
  });

  it("a template is saved as a file, and deleting it returns presentations to their built-in background", async () => {
    const api = await setup();
    const tpl = await addTemplate(api);
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    await user.selectOptions(within(region).getByRole("combobox", { name: "Design" }), `template:${tpl.id}`);
    await waitFor(() => expect(api.state.presentation.presentations[0]!.templateId).toBe(tpl.id));
    await user.click(within(region).getByRole("button", { name: "Manage templates…" }));
    const manager = await screen.findByRole("dialog", { name: "Church templates" });
    await user.click(await within(manager).findByRole("button", { name: "Save Grace Church as a file" }));
    await waitFor(() => expect(api.state.presentation.templates.exportedTemplates).toEqual([{ id: tpl.id, path: "/home/test/Documents/Grace Church.awtemplate" }]));
    await user.click(within(manager).getByRole("button", { name: "Delete Grace Church" }));
    await user.click(within(manager).getByRole("button", { name: "Delete" }));
    expect(await within(manager).findByText(/Presentations that used it show their built-in background again/)).toBeInTheDocument();
    expect(api.state.presentation.presentations[0]!.templateId).toBeNull();
    // Back in the editor the chooser shows the background the presentation really has.
    await user.click(within(manager).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(within(region).getByRole("combobox", { name: "Design" })).toHaveValue("theme:light"));
  });

  it("a pause keeps the template's background picture on screen, as in PowerPoint and PDF", async () => {
    const api = await setup();
    const def = acceptImport(IMPORTED, IMPORTED.suggestions, IMPORTED.definition.fonts);
    def.background = { color: null, image: { assetId: def.assets[0]!.id, crop: { left: 0, top: 0, right: 0, bottom: 0 } } };
    // No layout of its own for a pause: the template's background.
    delete def.roles.pause;
    const tpl = await addTemplate(api, def);
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    await user.selectOptions(within(region).getByRole("combobox", { name: "Design" }), `template:${tpl.id}`);
    await user.click(within(region).getByRole("button", { name: "Add a slide" }));
    await user.click(await within(region).findByRole("button", { name: /Pause/ }));
    const pause = await within(region).findByRole("listitem", { name: /Pause/ });
    await waitFor(() => expect(pause.querySelector("[data-template-page] img")).not.toBeNull());
  });
});
