import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { canGoBack, canGoForward, goBack, goForward, HISTORY_LIMIT, startHistory, visit } from "@/features/scripture/scriptureHistory";
import type { ScriptureRef } from "@/types/scripture";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Scripture Back / Forward and "Back to {main passage}" (v0.11). All text is invented.

const ref = (canonical: string): ScriptureRef => ({ canonical, display: canonical, book: canonical.slice(0, 3), startChapter: 1, startVerse: null, endChapter: 1, endVerse: null });

describe("Scripture history (model)", () => {
  it("records the place left, goes back and forward, and a new place clears Forward", () => {
    let h = startHistory(ref("JHN.15"));
    h = visit(h, ref("ROM.6"));
    h = visit(h, ref("GAL.2"));
    expect(h.back.map((r) => r.canonical)).toEqual(["JHN.15", "ROM.6"]);
    h = goBack(h);
    expect(h.current.canonical).toBe("ROM.6");
    expect(canGoForward(h)).toBe(true);
    h = goForward(h);
    expect(h.current.canonical).toBe("GAL.2");
    h = goBack(goBack(h));
    expect(h.current.canonical).toBe("JHN.15");
    h = visit(h, ref("EPH.2"));
    expect(canGoForward(h)).toBe(false);
    expect(h.back.map((r) => r.canonical)).toEqual(["JHN.15"]);
  });

  it("makes no entry for going where it already is, and is bounded", () => {
    let h = startHistory(ref("JHN.15"));
    h = visit(h, ref("JHN.15"));
    expect(canGoBack(h)).toBe(false);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = visit(h, ref(`ROM.${i}`));
    expect(h.back).toHaveLength(HISTORY_LIMIT);
    expect(goBack(startHistory(ref("JHN.15"))).current.canonical).toBe("JHN.15");
  });
});

function withBible() {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "JHN.15";
  return api;
}

const pane = () => screen.getByRole("complementary", { name: "Scripture" });
const heading = () => within(pane()).findByRole("heading", { level: 2 });
type User = Awaited<ReturnType<typeof renderApp>>["user"];
const go = async (user: User, text: string) => user.type(within(pane()).getByLabelText("Go to passage"), `${text}{Enter}`);
const backButton = () => within(pane()).getByRole("button", { name: "Back" });
const forwardButton = () => within(pane()).getByRole("button", { name: "Forward" });

describe("Scripture Back / Forward", () => {
  it("goes back and forward through the passages shown, and a new passage clears Forward", async () => {
    const { user } = await renderApp(withBible());
    expect(await heading()).toHaveTextContent("John 15");
    expect(backButton()).toBeDisabled();
    expect(forwardButton()).toBeDisabled();
    await go(user, "Rom 6");
    expect(await heading()).toHaveTextContent("Romans 6");
    await go(user, "Gal 2");
    expect(await heading()).toHaveTextContent("Galatians 2");

    await user.click(backButton());
    expect(await heading()).toHaveTextContent("Romans 6");
    await user.click(backButton());
    expect(await heading()).toHaveTextContent("John 15");
    expect(backButton()).toBeDisabled();
    await user.click(forwardButton());
    expect(await heading()).toHaveTextContent("Romans 6");

    await go(user, "Eph 2");
    expect(await heading()).toHaveTextContent("Ephesians 2");
    expect(forwardButton()).toBeDisabled();
    await user.click(backButton());
    expect(await heading()).toHaveTextContent("Romans 6");
  });

  it("makes no entry for the same passage again, nor for a translation change", async () => {
    const api = withBible();
    api.installFixtureBible("FXB", "beta");
    const { user } = await renderApp(api);
    await heading();
    await go(user, "John 15");
    expect(backButton()).toBeDisabled();
    await go(user, "Rom 8");
    expect(await heading()).toHaveTextContent("Romans 8");
    await user.selectOptions(within(pane()).getByRole("combobox", { name: "Translation" }), "FXB");
    expect(await within(pane()).findByText("Fixture beta ROM 8:1.")).toBeInTheDocument();
    expect(await heading()).toHaveTextContent("Romans 8");
    await user.click(backButton());
    expect(await heading()).toHaveTextContent("John 15");
    // still in the translation chosen
    expect(await within(pane()).findByText("Fixture beta JHN 15:1 about the vine.")).toBeInTheDocument();
    expect(backButton()).toBeDisabled();
  });

  it("can be used from the keyboard", async () => {
    const { user } = await renderApp(withBible());
    await heading();
    await go(user, "Rom 6");
    expect(await heading()).toHaveTextContent("Romans 6");
    backButton().focus();
    await user.keyboard("{Enter}");
    expect(await heading()).toHaveTextContent("John 15");
  });
});

async function withStudies() {
  const api = withBible();
  api.state.settings.scripturePassage = "PSA.23";
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "Series" });
  const vine = await api.studyCreate({ projectId: project.id, title: "The True Vine", primaryPassage: "JHN.15.1-JHN.15.11" });
  await api.studyCreate({ projectId: project.id, title: "Life in the Spirit", primaryPassage: "ROM.8.1-ROM.8.4" });
  await api.studyCreate({ projectId: project.id, title: "Loose Notes" });
  return { api, vineId: vine.study.id };
}

const backToMain = (passage: string) => within(pane()).queryByRole("button", { name: `Back to ${passage}` });

describe("Back to the Study's primary passage", () => {
  it("is not offered without an open Study with a primary passage", async () => {
    const { api } = await withStudies();
    const { user } = await renderApp(api);
    await heading();
    expect(within(pane()).queryByRole("button", { name: /^Back to / })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Loose Notes/ }));
    await screen.findByRole("textbox", { name: "Study title" });
    await go(user, "Rom 6");
    expect(await heading()).toHaveTextContent("Romans 6");
    expect(within(pane()).queryByRole("button", { name: /^Back to / })).not.toBeInTheDocument();
  });

  it("appears only away from the primary passage, returns straight to it, and differs from Back", async () => {
    const { api, vineId } = await withStudies();
    const before = JSON.stringify(api.state.studyPassages ?? null);
    const { user } = await renderApp(api);
    await user.click(await screen.findByRole("button", { name: /The True Vine/ }));
    expect(await within(pane()).findByText(/showing John 15:1–11/)).toBeInTheDocument();
    expect(backToMain("John 15:1–11")).not.toBeInTheDocument();

    await go(user, "Rom 6");
    await go(user, "Gal 2");
    await go(user, "Eph 2");
    expect(await heading()).toHaveTextContent("Ephesians 2");
    // ordinary Back is one step
    await user.click(backButton());
    expect(await heading()).toHaveTextContent("Galatians 2");
    await user.click(forwardButton());
    expect(await heading()).toHaveTextContent("Ephesians 2");

    // the direct return is a single move, and the place left stays reachable by Back
    await user.click(backToMain("John 15:1–11")!);
    expect(await within(pane()).findByText(/showing John 15:1–11/)).toBeInTheDocument();
    expect(backToMain("John 15:1–11")).not.toBeInTheDocument();
    await user.click(backButton());
    expect(await heading()).toHaveTextContent("Ephesians 2");

    // navigation never touched the Study
    const passages = await api.studyPassageList(vineId);
    expect(passages.find((p) => p.role === "primary")?.reference.canonical).toBe("JHN.15.1-JHN.15.11");
    expect(passages).toHaveLength(1);
    expect(JSON.stringify(api.state.studyPassages ?? null)).toBe(before);
  });

  it("follows the Study that is open", async () => {
    const { api } = await withStudies();
    const { user } = await renderApp(api);
    await user.click(await screen.findByRole("button", { name: /The True Vine/ }));
    await within(pane()).findByText(/showing John 15:1–11/);
    await go(user, "Gal 2");
    expect(await within(pane()).findByRole("button", { name: "Back to John 15:1–11" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to Studies" }));
    await waitFor(() => expect(within(pane()).queryByRole("button", { name: /^Back to / })).not.toBeInTheDocument());
    await user.click(await screen.findByRole("button", { name: /Life in the Spirit/ }));
    await within(pane()).findByText(/showing Romans 8:1–4/);
    await go(user, "Gal 2");
    expect(await within(pane()).findByRole("button", { name: "Back to Romans 8:1–4" })).toBeInTheDocument();
    expect(backToMain("John 15:1–11")).not.toBeInTheDocument();
  });
});
