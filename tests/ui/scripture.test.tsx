import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

function withBible(passage = "JHN.15") {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = passage;
  return api;
}

const pane = () => screen.getByRole("complementary", { name: "Scripture" });
const heading = () => within(pane()).findByRole("heading", { level: 2 });

describe("Scripture pane", () => {
  it("reads the installed translation at the saved passage", async () => {
    await renderApp(withBible());
    expect(await heading()).toHaveTextContent("John 15");
    expect(within(pane()).getByText("Fixture alpha JHN 15:1 about the vine.")).toBeInTheDocument();
    expect(within(pane()).getByRole("combobox", { name: "Translation" })).toHaveDisplayValue("FXA");
  });

  it("moves by chapter and by book", async () => {
    const { user } = await renderApp(withBible());
    await heading();
    await user.click(within(pane()).getByRole("button", { name: "Next chapter" }));
    expect(await heading()).toHaveTextContent("John 16");
    await user.click(within(pane()).getByRole("button", { name: "Previous chapter" }));
    await user.click(within(pane()).getByRole("button", { name: "Previous chapter" }));
    expect(await heading()).toHaveTextContent("John 14");

    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Book" }), "ROM");
    expect(await heading()).toHaveTextContent("Romans 1");
    expect(within(pane()).getByText("Fixture FXA has no text for Romans 1.")).toBeInTheDocument();
    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Chapter" }), "8");
    expect(await within(pane()).findByText("Fixture alpha ROM 8:1.")).toBeInTheDocument();
  });

  it("goes to a typed passage and marks it", async () => {
    const { api, user } = await renderApp(withBible());
    await heading();
    await user.type(within(pane()).getByLabelText("Go to passage"), "Rom 8:1-2{Enter}");

    expect(await heading()).toHaveTextContent("Romans 8");
    expect(within(pane()).getByText(/showing Romans 8:1–2/)).toBeInTheDocument();
    const current = pane().querySelectorAll("[data-current='true']");
    expect(current).toHaveLength(2);
    await waitFor(() => expect(api.state.settings.scripturePassage).toBe("ROM.8.1-ROM.8.2"));
  });

  it("explains a passage it cannot read", async () => {
    const { user } = await renderApp(withBible());
    await heading();
    await user.type(within(pane()).getByLabelText("Go to passage"), "Jonn 3{Enter}");
    expect(await within(pane()).findByRole("alert")).toHaveTextContent("“Jonn 3” is not a passage I recognise.");
    expect(await heading()).toHaveTextContent("John 15");
  });

  it("keeps the passage when switching translation", async () => {
    const api = withBible();
    const beta = api.installFixtureBible("FXB", "beta");
    const { user } = await renderApp(api);
    await heading();
    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Translation" }), "FXB");

    expect(await within(pane()).findByText("Fixture beta JHN 15:1 about the vine.")).toBeInTheDocument();
    expect(await heading()).toHaveTextContent("John 15");
    await waitFor(() => expect(api.state.settings.scriptureTranslationId).toBe(beta.id));
  });

  it("adds a note, a highlight and a bookmark that stay across translations", async () => {
    const api = withBible();
    api.installFixtureBible("FXB", "beta");
    const { user } = await renderApp(api);
    await heading();

    await user.click(within(pane()).getByRole("button", { name: /^Verse 1\. Show verse tools/ }));
    const tools = within(pane()).getByRole("region", { name: "Tools for verse 1" });
    await user.click(within(tools).getByRole("button", { name: "Add note" }));
    await user.type(within(tools).getByLabelText("Note on verse 1"), "Remain in the vine.");
    await user.click(within(tools).getByRole("button", { name: "Save note" }));
    await user.click(within(tools).getByRole("button", { name: "Highlight" }));
    await user.click(within(within(tools).getByRole("group", { name: "Highlight colour" })).getByRole("button", { name: "Amber" }));
    await user.click(within(tools).getByRole("button", { name: "Bookmark" }));

    await waitFor(() => expect(api.state.annotations.map((a) => a.kind).sort()).toEqual(["bookmark", "highlight", "note"]));
    expect(api.state.annotations.every((a) => a.reference.canonical === "JHN.15.1")).toBe(true);
    expect(await within(pane()).findByText("Remain in the vine.")).toBeInTheDocument();

    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Translation" }), "FXB");
    expect(
      await within(pane()).findByRole("button", { name: /^Verse 1, has a note, bookmarked, highlighted/ }),
    ).toBeInTheDocument();
  });

  it("searches Scripture from the app bar and opens a result", async () => {
    const { user } = await renderApp(withBible("ROM.8"));
    await heading();
    await user.type(screen.getByRole("searchbox", { name: "Search Scripture" }), "vine{Enter}");

    const results = await within(pane()).findByRole("list", { name: "Search results" });
    await user.click(within(results).getByRole("button", { name: /John 15:1/ }));
    expect(await heading()).toHaveTextContent("John 15");
    expect(within(pane()).getByText(/showing John 15:1/)).toBeInTheDocument();
  });

  it("links a study to a passage and opens it from the study", async () => {
    const api = withBible("PSA.23");
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
    await api.studyCreate({ projectId: project.id, title: "The True Vine" });
    const { user } = await renderApp(api);
    await heading();
    await user.click(await screen.findByRole("button", { name: /The True Vine/ }));
    await user.click(await screen.findByRole("button", { name: "Add passage" }));
    await user.type(screen.getByLabelText("Passage to add"), "John 15:1-11{Enter}");

    const link = await screen.findByRole("button", { name: "John 15:1–11" });
    expect(api.state.passages.map((p) => p.reference.canonical)).toEqual(["JHN.15.1-JHN.15.11"]);
    await user.click(link);
    expect(await heading()).toHaveTextContent("John 15");
    expect(within(pane()).getByText(/showing John 15:1–11/)).toBeInTheDocument();
  });
});

describe("references in study text", () => {
  it("turns a passage mentioned in study text into a link to it", async () => {
    const api = withBible("PSA.23");
    const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Romans" });
    await api.studyCreate({ projectId: project.id, title: "Adoption" });
    const { user } = await renderApp(api);
    await heading();
    await user.click(await screen.findByRole("button", { name: /Adoption/ }));

    await user.type(await screen.findByRole("textbox", { name: "Observations: paragraph" }), "Compare Rom 8:1-2 here.");
    const link = await screen.findByRole("button", { name: "Romans 8:1–2" });
    await user.click(link);
    expect(await heading()).toHaveTextContent("Romans 8");
  });
});
