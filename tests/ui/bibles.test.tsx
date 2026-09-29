import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

describe("adding and managing Bibles", () => {
  it("adds the included Bible after reviewing it", async () => {
    const { api, user } = await renderApp();
    const scripture = screen.getByRole("complementary", { name: "Scripture" });
    await user.click(within(scripture).getByRole("button", { name: "Add a Bible…" }));
    await user.click(await screen.findByRole("button", { name: "Add World English Bible" }));

    expect(await screen.findByRole("heading", { level: 1, name: "New Bible" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("World English Bible");
    expect(screen.getByText("3 books detected")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Books" })).getByText("Romans")).toBeInTheDocument();
    expect(screen.getByText(/1 warning — worth reviewing/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add this Bible" }));
    expect(await screen.findByText(/is ready to read/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Read it now" }));

    expect(api.state.bibles.map((b) => b.shortName)).toEqual(["WEB"]);
    const pane = await screen.findByRole("complementary", { name: "Scripture" });
    expect(within(pane).getByRole("combobox", { name: "Translation" })).toHaveDisplayValue("WEB");
  });

  it("will not add a Bible with problems, and says why", async () => {
    const api = createMemoryApi();
    api.state.nextChosenFiles = ["/home/me/broken.zip"];
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Add a Bible…" }));
    await user.click(await screen.findByRole("button", { name: "Choose Bible files…" }));

    expect(await screen.findByText(/1 problem must be fixed/)).toBeInTheDocument();
    expect(screen.getByText("John 15:1 appears twice.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add this Bible" })).toBeDisabled();
  });

  it("refuses unsupported files with a plain message", async () => {
    const api = createMemoryApi();
    api.state.nextChosenFiles = ["/home/me/bible.pdf"];
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Add a Bible…" }));
    await user.click(await screen.findByRole("button", { name: "Choose Bible files…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PDF files can’t be imported");
  });

  it("lists installed Bibles in Settings and removes one after confirmation", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("FXA", "alpha");
    api.installFixtureBible("FXB", "beta");
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Settings" }));

    const list = await screen.findByRole("list", { name: "Installed Bibles" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    await user.click(within(list).getByRole("button", { name: "Remove Fixture FXA" }));
    const confirm = screen.getByRole("alertdialog");
    expect(confirm).toHaveTextContent("Your studies, passage links and notes are kept.");
    await user.click(within(confirm).getByRole("button", { name: "Remove FXA" }));

    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(1));
    expect(api.state.bibles.map((b) => b.shortName)).toEqual(["FXB"]);
  });
});
