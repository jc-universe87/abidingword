import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

async function seed() {
  const api = createMemoryApi();
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Romans Sermon Series" });
  await api.studyCreate({ projectId: project.id, title: "Romans 8:1–17" });
  await api.studyCreate({ projectId: project.id, title: "Romans 8:18–30" });
  return api;
}

describe("study selection and editing", () => {
  it("opens a project, selects a study and shows its sections", async () => {
    const { user } = await renderApp(await seed());
    const studies = await screen.findByRole("list", { name: "Studies" });
    await user.click(within(studies).getByRole("button", { name: /Romans 8:1–17/ }));

    expect(await screen.findByRole("textbox", { name: "Study title" })).toHaveValue("Romans 8:1–17");
    const sectionTitles = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent)
      .filter((t) => t !== "Findings" && t !== "New study");
    expect(sectionTitles).toEqual([
      "Text",
      "Context",
      "Observations",
      "Structure",
      "Exegesis",
      "Theology",
      "Application",
      "Audience",
      "Teaching",
    ]);
  });

  it("creates a study inside the open project", async () => {
    const { api, user } = await renderApp(await seed());
    await user.click(await screen.findByRole("button", { name: "New study" }));
    await user.type(await screen.findByLabelText("What would you like to study?"), "Romans 12:1-2");
    await user.click(screen.getByRole("button", { name: "Create study" }));

    expect(await screen.findByRole("textbox", { name: "Study title" })).toHaveValue("Romans 12:1–2");
    const created = api.state.studies.find((s) => s.title === "Romans 12:1–2");
    expect(created?.projectId).toBe(api.state.projects[0]?.id);
  });

  it("saves section text and the study title automatically", async () => {
    const api = await seed();
    const { user } = await renderApp(api);
    await user.click(await screen.findByRole("button", { name: /Romans 8:1–17/ }));

    const observations = await screen.findByRole("textbox", { name: "Observations: paragraph" });
    await user.type(observations, "There is therefore now no condemnation.");
    const title = screen.getByRole("textbox", { name: "Study title" });
    await user.clear(title);
    await user.type(title, "Life in the Spirit");
    await user.tab();

    await waitFor(() =>
      expect(api.state.blocks.some((b) => b.content === "There is therefore now no condemnation.")).toBe(true),
    );
    await waitFor(() => expect(api.state.studies.some((s) => s.title === "Life in the Spirit")).toBe(true));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("adds a remark to the section being worked in", async () => {
    const api = await seed();
    const { user } = await renderApp(api);
    await user.click(await screen.findByRole("button", { name: /Romans 8:1–17/ }));

    await user.click(await screen.findByRole("textbox", { name: "Context: paragraph" }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Text block" }));
    const kinds = screen.getByRole("group", { name: "Text block in Context" });
    await user.click(within(kinds).getByRole("button", { name: "Remark" }));

    const remark = await screen.findByRole("textbox", { name: "Context: remark" });
    await waitFor(() => expect(remark).toHaveFocus());
    expect(api.state.blocks.filter((b) => b.blockType === "note")).toHaveLength(1);
  });

  it("returns to the last open study after a restart", async () => {
    const api = await seed();
    const first = await renderApp(api);
    await first.user.click(await screen.findByRole("button", { name: /Romans 8:18–30/ }));
    await screen.findByRole("textbox", { name: "Study title" });

    const { cleanup } = await import("@testing-library/react");
    cleanup();
    await renderApp(api);

    expect(await screen.findByRole("textbox", { name: "Study title" })).toHaveValue("Romans 8:18–30");
  });
});
