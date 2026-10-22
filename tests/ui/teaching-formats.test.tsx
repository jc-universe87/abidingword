import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { FORMAT_KINDS, TEACHING_FORMATS, formatOf, formatStarts } from "@/features/teaching/teachingTemplates";
import { TEACHING_KINDS, type TeachingKind } from "@/types/teaching";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Bible Teaching in three formats (v0.19): a message, a group Bible study and
// an interactive lesson. The kinds stored since v0.16 stay as they are; each
// belongs to one format, so older teachings and templates keep working.
// All text is invented for the tests.

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

const studyPane = () => screen.getByRole("main", { name: "Study" });

async function setup(kinds: TeachingKind[] = []) {
  const api = createMemoryApi();
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
  for (const kind of kinds) await api.teachingCreate({ studyId: study.id, title: `Old ${kind}`, kind, points: [{ title: "Kept point", kind: null }] });
  return { api, studyId: study.id };
}

async function openTeaching(api: ReturnType<typeof createMemoryApi>) {
  const { user } = await renderApp(api);
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /Abiding/ }));
  await within(studyPane()).findByRole("textbox", { name: "Study title" });
  await user.click(within(studyPane()).getByRole("button", { name: "Bible Teaching" }));
  return user;
}

describe("the three formats", () => {
  it("give every stored kind exactly one format", () => {
    const placed = TEACHING_FORMATS.flatMap((f) => FORMAT_KINDS[f]);
    expect([...placed].sort()).toEqual([...TEACHING_KINDS].sort());
    expect(formatOf("sermon")).toBe("message");
    expect(formatOf("youth")).toBe("message");
    expect(formatOf("bible_study")).toBe("group");
    expect(formatOf("children")).toBe("lesson");
  });

  it("start from the format's built-in starts first, then the person's own of any kind in it", () => {
    const mine = [
      { id: "y", name: "Youth evening", description: null, kind: "youth" as const, points: [], createdAt: "", updatedAt: "", revision: 1 },
      { id: "k", name: "Kids club", description: null, kind: "children" as const, points: [], createdAt: "", updatedAt: "", revision: 1 },
    ];
    expect(formatStarts("message", "talk", mine).map((s) => s.id)).toEqual(["builtin:talk", "y"]);
    expect(formatStarts("group", "sermon", mine).map((s) => s.id)).toEqual(["builtin:bible_study"]);
    expect(formatStarts("lesson", "sermon", mine).map((s) => s.id)).toEqual(["builtin:lesson", "builtin:children", "k"]);
  });

  it("are offered when a teaching starts, a message as a sermon or a talk", async () => {
    const { api } = await setup();
    const user = await openTeaching(api);
    const form = await within(studyPane()).findByRole("form", { name: "Prepare a teaching from this study" });
    const formats = within(form).getAllByRole("radio").filter((r) => r.getAttribute("name")?.endsWith("-format"));
    expect(formats.map((r) => r.getAttribute("aria-label"))).toEqual(["Message", "Group Bible study", "Interactive lesson"]);
    expect(within(form).getByRole("radio", { name: "Message" })).toBeChecked();
    await user.click(within(form).getByRole("radio", { name: "Talk" }));
    await user.click(within(form).getByRole("button", { name: "Start" }));
    await within(studyPane()).findByRole("article", { name: "Talk · Abiding" });
    expect(api.state.teaching.preparations[0]!.kind).toBe("talk");
  });

  it("names the group format Hauskreis in German and 소그룹 성경공부 in Korean", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    expect(i18n.t("studies.teaching.formats.group.name")).toBe("Hauskreis");
    expect(i18n.t("studies.teaching.kind.bible_study")).toBe("Hauskreis");
    expect(i18n.t("studies.teaching.formats.lesson.name")).toBe("Bibelunterricht");
    expect(i18n.t("studies.teaching.newTeaching")).toBe("Neue Bibellehre");
    await act(async () => {
      await i18n.changeLanguage("ko");
    });
    expect(i18n.t("studies.teaching.formats.group.name")).toBe("소그룹 성경공부");
  });
});

describe("older teachings", () => {
  it("open as they were, whatever their kind, and keep their kind in the information panel", async () => {
    const { api } = await setup(["youth", "children", "other"]);
    const before = JSON.stringify(api.state.teaching.preparations);
    const user = await openTeaching(api);
    await within(studyPane()).findByRole("combobox", { name: "Teaching:" });
    for (const prep of api.state.teaching.preparations) {
      await user.selectOptions(within(studyPane()).getByRole("combobox", { name: "Teaching:" }), prep.id);
      const article = await within(studyPane()).findByRole("article", { name: prep.title });
      expect(within(article).getByDisplayValue("Kept point")).toBeInTheDocument();
      await user.click(within(article).getByRole("button", { name: "Bible Teaching information" }));
      const panel = await screen.findByRole("dialog", { name: "Bible Teaching information" });
      expect(within(panel).getByRole("combobox", { name: "Kind of teaching" })).toHaveValue(prep.kind);
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
    expect(JSON.stringify(api.state.teaching.preparations)).toBe(before);
  });

  it("can still be given any kind, grouped under its format", async () => {
    const { api } = await setup(["sermon"]);
    const user = await openTeaching(api);
    const article = await within(studyPane()).findByRole("article", { name: "Old sermon" });
    await user.click(within(article).getByRole("button", { name: "Bible Teaching information" }));
    const panel = await screen.findByRole("dialog", { name: "Bible Teaching information" });
    const kind = within(panel).getByRole("combobox", { name: "Kind of teaching" });
    const groups = [...kind.querySelectorAll("optgroup")].map((g) => [g.label, [...g.querySelectorAll("option")].map((o) => o.value)]);
    expect(groups).toEqual([
      ["Message", ["sermon", "talk", "youth", "other"]],
      ["Group Bible study", ["bible_study"]],
      ["Interactive lesson", ["lesson", "children"]],
    ]);
  });
});

describe("notes for oneself", () => {
  it("come after the teaching, folded away, and keep what was written", async () => {
    const { api } = await setup(["sermon"]);
    await api.teachingUpdate({ id: api.state.teaching.preparations[0]!.id, notes: "Thank the choir." });
    const user = await openTeaching(api);
    const article = await within(studyPane()).findByRole("article", { name: "Old sermon" });
    const toggle = within(article).getByRole("button", { name: /^Notes for yourself/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("has notes");
    expect(within(article).queryByRole("textbox", { name: "Notes for yourself" })).toBeNull();
    await user.click(toggle);
    expect(within(article).getByRole("textbox", { name: "Notes for yourself" })).toHaveValue("Thank the choir.");
    expect(within(article).getByText(/never part of the Materials/)).toBeInTheDocument();
  });
});
