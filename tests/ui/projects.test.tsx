import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../support/render";

describe("project creation", () => {
  it("creates a project, opens it, and lists it under Projects", async () => {
    const { api, user } = await renderApp();

    await user.type(screen.getByLabelText("New project"), "Romans Sermon Series");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("textbox", { name: "Project title" })).toHaveValue("Romans Sermon Series");
    expect(api.state.projects.map((p) => p.title)).toEqual(["Romans Sermon Series"]);

    await user.click(screen.getByRole("button", { name: "Projects" }));
    const list = await screen.findByRole("list", { name: "Projects" });
    expect(within(list).getByText("Romans Sermon Series")).toBeInTheDocument();
    expect(within(list).getByText("0 studies")).toBeInTheDocument();
  });

  it("asks for a title instead of creating an empty project", async () => {
    const { api, user } = await renderApp();

    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter a title first.");
    expect(api.state.projects).toHaveLength(0);
  });

  it("shows the message from the native core when creation fails", async () => {
    const { api, user } = await renderApp();

    // Whitespace passes the form's own check but is rejected by the core.
    await user.type(screen.getByLabelText("New project"), "  x");
    api.projectCreate = async () => {
      const { ApiError } = await import("@/lib/api");
      throw new ApiError("database", "Abiding Word could not read or save your data.");
    };
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not read or save your data");
  });
});
