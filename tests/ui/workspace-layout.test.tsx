import { cleanup, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "../support/memoryApi";
import { openSettingsSection, renderApp } from "../support/render";

/** The workspace panes from left to right, by name. */
function paneOrder(): string[] {
  return Array.from(document.querySelectorAll("#pane-scripture, #pane-study, #pane-sources")).map(
    (pane) => pane.id.replace("pane-", ""),
  );
}

const divider = (name: string) => screen.getByRole("separator", { name: `Resize ${name} pane` });
const width = (id: string) => (document.getElementById(id) as HTMLElement).style.width;
const stored = (key: string) => window.localStorage.getItem(`abiding-word.${key}`);

/** Starts the app again on the same device: same browser storage, new window. */
async function restart(api: ReturnType<typeof createMemoryApi>, options?: { width?: number }) {
  cleanup();
  return renderApp(api, options);
}

describe("workspace layout", () => {
  it("starts as Scripture | Study | Sources", async () => {
    await renderApp();
    expect(paneOrder()).toEqual(["scripture", "study", "sources"]);
    const sources = screen.getByRole("complementary", { name: "Sources" });
    expect(within(sources).getByRole("button", { name: "Move Sources pane right" })).toBeDisabled();
    expect(within(sources).getByRole("button", { name: "Move Sources pane left" })).toBeEnabled();
  });

  it("moves panes left and right, keeping focus on the moved pane, and remembers the order", async () => {
    const api = createMemoryApi();
    const { user } = await renderApp(api);

    await user.click(screen.getByRole("button", { name: "Move Sources pane left" }));
    expect(paneOrder()).toEqual(["scripture", "sources", "study"]);
    expect(screen.getByRole("button", { name: "Move Sources pane left" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(paneOrder()).toEqual(["sources", "scripture", "study"]);
    // At the left edge, focus moves to the button that can still act.
    expect(screen.getByRole("button", { name: "Move Sources pane right" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Move Study pane left" }));
    expect(paneOrder()).toEqual(["sources", "study", "scripture"]);
    // Every pane keeps its meaning and content wherever it is.
    expect(screen.getByRole("main", { name: "Study" })).toContainElement(screen.getByRole("heading", { level: 1, name: "Studies" }));
    expect(screen.getAllByRole("complementary").map((p) => p.id)).toEqual(["pane-sources", "pane-scripture"]);

    await restart(api);
    expect(paneOrder()).toEqual(["sources", "study", "scripture"]);
  });

  it("resizes side panes from the keyboard, within limits that keep the Study pane usable", async () => {
    const api = createMemoryApi();
    const { user } = await renderApp(api);
    expect(width("pane-sources")).toBe("320px");

    // The Sources divider is on its left edge: moving it left widens the pane.
    divider("Sources").focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(width("pane-sources")).toBe("368px");
    expect(divider("Sources")).toHaveAttribute("aria-valuenow", "368");

    // At most: window (1440) − Study minimum (360) − Scripture (300).
    expect(divider("Sources")).toHaveAttribute("aria-valuemax", "780");
    await user.keyboard("{End}");
    expect(width("pane-sources")).toBe("780px");
    await user.keyboard("{Home}");
    expect(width("pane-sources")).toBe("240px");
    await user.keyboard("{ArrowLeft}");

    await restart(api);
    expect(width("pane-sources")).toBe("264px");
    expect(width("pane-scripture")).toBe("300px");
  });

  it("resizes the pane away from Study when two side panes are next to each other", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Move Study pane left" }));
    expect(paneOrder()).toEqual(["study", "scripture", "sources"]);
    // Study | Scripture | Sources: the divider between the side panes resizes Sources.
    const dividers = screen.getAllByRole("separator");
    expect(dividers.map((d) => d.getAttribute("aria-label"))).toEqual(["Resize Scripture pane", "Resize Sources pane"]);
    dividers[1]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(width("pane-sources")).toBe("296px");
    expect(width("pane-scripture")).toBe("300px");
  });

  it("hides and shows panes without losing their place or width", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Move Sources pane left" }));
    await user.click(screen.getByRole("button", { name: "Move Sources pane left" }));
    divider("Sources").focus();
    await user.keyboard("{ArrowRight}");
    expect(paneOrder()).toEqual(["sources", "scripture", "study"]);
    expect(width("pane-sources")).toBe("344px");

    await user.click(screen.getByRole("button", { name: "Show Sources pane" }));
    expect(paneOrder()).toEqual(["scripture", "study"]);
    // With Sources hidden, Scripture is first and cannot move further left.
    expect(screen.getByRole("button", { name: "Move Scripture pane left" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Show Scripture pane" }));
    expect(paneOrder()).toEqual(["study"]);
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show Sources pane" }));
    await user.click(screen.getByRole("button", { name: "Show Scripture pane" }));
    expect(paneOrder()).toEqual(["sources", "scripture", "study"]);
    expect(width("pane-sources")).toBe("344px");
    expect(width("pane-scripture")).toBe("300px");
  });

  it("Reset layout restores order, widths and visibility, and nothing else", async () => {
    const api = createMemoryApi();
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Move Scripture pane right" }));
    divider("Sources").focus();
    await user.keyboard("{End}");
    await user.click(screen.getByRole("button", { name: "Show Scripture pane" }));
    expect(paneOrder()).toEqual(["study", "sources"]);
    const studyLocation = stored("studyPane.location");
    expect(studyLocation).not.toBeNull();

    await openSettingsSection(user, "Appearance");
    await user.click(await screen.findByRole("button", { name: "Reset layout" }));
    expect(await screen.findByText("Layout reset.")).toBeInTheDocument();
    expect(stored("layout.order")).toBeNull();
    expect(stored("layout.sourcesWidth")).toBeNull();
    // Not a layout preference: the Study pane's place is kept.
    expect(stored("studyPane.location")).toBe(studyLocation);

    await user.click(screen.getByRole("button", { name: "Back to workspace" }));
    await screen.findByRole("main", { name: "Study" });
    expect(paneOrder()).toEqual(["scripture", "study", "sources"]);
    expect(width("pane-scripture")).toBe("300px");
    expect(width("pane-sources")).toBe("320px");
  });

  it("on a narrow window, Sources starts hidden unless the user chose to show it; Reset brings back that default", async () => {
    const api = createMemoryApi();
    const { user } = await renderApp(api, { width: 864 });
    expect(paneOrder()).toEqual(["scripture", "study"]);

    await user.click(screen.getByRole("button", { name: "Show Sources pane" }));
    await restart(api, { width: 864 });
    expect(paneOrder()).toEqual(["scripture", "study", "sources"]);
    // The narrow window leaves less room, so less to grow into.
    expect(divider("Sources")).toHaveAttribute("aria-valuemax", "240");

    await openSettingsSection(user, "Appearance");
    await user.click(await screen.findByRole("button", { name: "Reset layout" }));
    await user.click(screen.getByRole("button", { name: "Back to workspace" }));
    await screen.findByRole("main", { name: "Study" });
    expect(paneOrder()).toEqual(["scripture", "study"]);
  });

  it("puts the app-bar pane icons on the side each pane is on", async () => {
    const { user } = await renderApp();
    const icon = (name: string) => screen.getByRole("button", { name }).querySelector("svg")?.getAttribute("class") ?? "";
    expect(icon("Show Sources pane")).toContain("panel-right");
    await user.click(screen.getByRole("button", { name: "Move Sources pane left" }));
    await user.click(screen.getByRole("button", { name: "Move Sources pane left" }));
    expect(icon("Show Sources pane")).toContain("panel-left");
  });
});
