import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

async function openStudy(slowSave = true) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John Sermon Series" });
  await api.studyCreate({ projectId: project.id, title: "The True Vine" });
  // A save that never finishes: what is on screen must not wait for it.
  if (slowSave) api.studyBlockUpdate = () => new Promise(() => undefined);
  const { user } = await renderApp(api);
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /The True Vine/ }));
  await screen.findByRole("textbox", { name: "Study title" });
  return { api, user };
}

const study = () => within(screen.getByRole("main", { name: "Study" }));
const guidance = /The passage being studied/;

describe("empty prompt and guidance follow what is typed, not what is saved", () => {
  it("shows the start prompt and section guidance for an empty study", async () => {
    await openStudy();
    expect(study().getByText("Start your study")).toBeInTheDocument();
    expect(study().getByText(guidance)).toBeInTheDocument();
  });

  it("hides both as soon as the user types, before the save resolves", async () => {
    const { user } = await openStudy();
    await user.type(study().getByRole("textbox", { name: "Text: paragraph" }), "A");
    expect(study().queryByText("Start your study")).not.toBeInTheDocument();
    expect(study().queryByText(guidance)).not.toBeInTheDocument();
    // The writing area was not replaced while typing.
    await user.type(study().getByRole("textbox", { name: "Text: paragraph" }), "bide");
    expect(study().getByRole("textbox", { name: "Text: paragraph" })).toHaveValue("Abide");
  });

  it("brings them back when the writing is cleared and the study is empty again", async () => {
    const { user } = await openStudy();
    const box = () => study().getByRole("textbox", { name: "Text: paragraph" });
    await user.type(box(), "Abide");
    await user.clear(box());
    expect(study().getByText("Start your study")).toBeInTheDocument();
    expect(study().getByText(guidance)).toBeInTheDocument();
    await user.type(box(), "   ");
    expect(study().getByText(guidance)).toBeInTheDocument();
  });

  it("renders no related-study UI when there are none", async () => {
    await openStudy(false);
    expect(study().queryByRole("region", { name: "Related studies" })).not.toBeInTheDocument();
    expect(study().queryByText(/Related to|Continues/)).not.toBeInTheDocument();
  });
});
