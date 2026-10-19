import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { ApiProvider } from "@/lib/ApiContext";
import { AudienceWindow } from "@/features/presentation/AudienceWindow";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp, setWindowWidth } from "../support/render";

// Presentation & Delivery (v0.18): slides made from a Bible Teaching by fixed
// rules, following it live; one Presenter View for phone, tablet and
// desktop; the audience sees only audience content; exports go only where
// the person chooses. All text is invented.

type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function setup() {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
  const prep = await api.teachingCreate({
    studyId: study.id,
    title: "Remain in the vine",
    kind: "sermon",
    points: [{ title: "Stay connected" }, { title: "Bear fruit" }],
  });
  await api.teachingUpdate({ id: prep.id, introduction: "Have you ever pruned a rose?", centralMessage: "Fruit comes from abiding." });
  await api.teachingPointUpdate({ id: prep.points[0]!.id, explanation: "SPEAKER EXPLANATION: branches live from the vine." });
  await api.teachingPassageAdd({ preparationId: prep.id, reference: "JHN.15.1-JHN.15.5" });
  return { api, prepId: prep.id, pointId: prep.points[0]!.id };
}

const studyPane = () => screen.getByRole("main", { name: "Study" });

async function openPresentation(user: User) {
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /Abiding/ }));
  await within(studyPane()).findByRole("textbox", { name: "Study title" });
  await user.click(within(studyPane()).getByRole("button", { name: "Bible Teaching" }));
  await user.click(await within(studyPane()).findByRole("button", { name: "Materials" }));
  // Materials (v0.18.4): the teaching's outputs; the presentation is one of them.
  await user.click(await screen.findByRole("menuitem", { name: /^Presentation/ }));
  return within(studyPane()).findByRole("region", { name: "Presentation of “Remain in the vine”" });
}

async function makeSlides(user: User) {
  const region = await openPresentation(user);
  await user.click(within(region).getByRole("button", { name: "Make slides from the teaching" }));
  await within(region).findByRole("list", { name: "Slides" });
  await within(region).findByRole("button", { name: "Start Presenter View" });
  await waitFor(() => expect(within(region).getByRole("button", { name: "Start Presenter View" })).toBeEnabled());
  return region;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
}

afterEach(async () => {
  window.localStorage.clear();
  setWindowWidth(1440);
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("making a presentation from a Bible Teaching", () => {
  it("proposes slides in the teaching's order, without an assistant", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const region = await openPresentation(user);
    expect(within(region).getByText("Made by fixed rules on this computer. No assistant is used.")).toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: "Make slides from the teaching" }));
    const list = await within(region).findByRole("list", { name: "Slides" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(6));
    const names = within(list)
      .getAllByRole("listitem")
      .map((li) => li.getAttribute("aria-label"));
    expect(names).toEqual([
      "Slide 1: Remain in the vine",
      "Slide 2: Introduction",
      "Slide 3: John 15:1–5",
      "Slide 4: Fruit comes from abiding.",
      "Slide 5: Stay connected",
      "Slide 6: Bear fruit",
    ]);
    // Leaving the presentation goes back to the teaching, focus on its button.
    await user.click(within(region).getByRole("button", { name: "Back to the teaching" }));
    await waitFor(() => expect(within(studyPane()).getByRole("button", { name: "Materials" })).toHaveFocus());
  });

  it("follows the teaching live until the person writes their own wording, and never changes the teaching", async () => {
    const { api, pointId } = await setup();
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    const slide = within(region).getByRole("listitem", { name: "Slide 5: Stay connected" });
    await user.click(within(slide).getByRole("button", { name: /Stay connected/ }));
    expect(within(slide).getByText("From your teaching; it changes when the teaching changes.")).toBeInTheDocument();
    await user.click(within(slide).getByRole("button", { name: "Write your own for the slide" }));
    const heading = await within(slide).findByRole("textbox", { name: "Heading on the slide" });
    await waitFor(() => expect(heading).toHaveFocus());
    await user.clear(heading);
    await user.type(heading, "Joined to him");
    fireEvent.blur(heading);
    await settle();
    const item = api.state.presentation.presentations[0]!.items[4]!;
    expect(item.heading).toBe("Joined to him");
    // The teaching keeps its own words.
    expect(api.state.teaching.preparations[0]!.points.find((p) => p.id === pointId)!.title).toBe("Stay connected");
    await user.click(within(slide).getByRole("button", { name: "Use the teaching's words again" }));
    await waitFor(() => expect(api.state.presentation.presentations[0]!.items[4]!.heading).toBeNull());
  });

  it("speaker notes are saved with the slide and marked as private", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    const slide = within(region).getByRole("listitem", { name: "Slide 2: Introduction" });
    await user.click(within(slide).getByRole("button", { name: /Introduction/ }));
    expect(within(slide).getByText(/Never on the audience screen/)).toBeInTheDocument();
    const notes = within(slide).getByRole("textbox", { name: "Speaker notes" });
    await user.type(notes, "Smile. Look at the back row.");
    fireEvent.blur(notes);
    await settle();
    expect(api.state.presentation.presentations[0]!.items[1]!.notes).toBe("Smile. Look at the back row.");
  });

  it("leaves out, moves and adds slides without touching the teaching", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    const revision = api.state.teaching.preparations[0]!.revision;
    await user.click(within(region).getByRole("button", { name: "Move slide 6 earlier" }));
    await waitFor(() => expect(within(region).getByRole("listitem", { name: "Slide 5: Bear fruit" })).toBeInTheDocument());
    await waitFor(() => expect(within(region).getByRole("button", { name: "Move slide 5 earlier" })).toHaveFocus());
    const slide = within(region).getByRole("listitem", { name: "Slide 2: Introduction" });
    await user.click(within(slide).getByRole("button", { name: /Introduction/ }));
    await user.click(within(slide).getByRole("checkbox", { name: "Show this slide" }));
    await waitFor(() => expect(api.state.presentation.presentations[0]!.items[1]!.skipped).toBe(true));
    await user.click(within(region).getByRole("button", { name: "Add a slide" }));
    await user.click(within(region).getByRole("button", { name: "Pause (empty screen)" }));
    await waitFor(() => expect(api.state.presentation.presentations[0]!.items.at(-1)!.kind).toBe("pause"));
    expect(api.state.teaching.preparations[0]!.revision).toBe(revision);
  });
});

describe("the Presenter View", () => {
  it("is a speaker sheet on a phone: large text, notes and big Back/Next, moved by keys", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api, { width: 390 });
    const region = await makeSlides(user);
    await user.click(within(region).getByRole("button", { name: "Start Presenter View" }));
    const view = await screen.findByRole("dialog", { name: "Remain in the vine" });
    expect(view.dataset.layout).toBe("phone");
    expect(within(view).getByText("Slide 1 of 6")).toBeInTheDocument();
    await waitFor(() => expect(within(view).getByRole("button", { name: "Next" })).toHaveFocus());
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(within(view).getByText("Slide 2 of 6")).toBeInTheDocument();
    // The introduction is the speaker's to say.
    expect(within(view).getByText("Have you ever pruned a rose?")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "PageDown" });
    fireEvent.keyDown(window, { key: "PageDown" });
    fireEvent.keyDown(window, { key: "PageDown" });
    expect(within(view).getByText("Slide 5 of 6")).toBeInTheDocument();
    expect(within(view).getByText("SPEAKER EXPLANATION: branches live from the vine.")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "PageUp" });
    expect(within(view).getByText("Slide 4 of 6")).toBeInTheDocument();
    await user.click(within(view).getByRole("button", { name: "Back" }));
    expect(within(view).getByText("Slide 3 of 6")).toBeInTheDocument();
    // Escape leaves, and the keyboard is back on the start button.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remain in the vine" })).toBeNull());
    await waitFor(() => expect(within(region).getByRole("button", { name: "Start Presenter View" })).toHaveFocus());
  });

  it("shows the current and next slide beside the notes on a tablet, and all slides on a desktop", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api, { width: 800 });
    const region = await makeSlides(user);
    await user.click(within(region).getByRole("button", { name: "Start Presenter View" }));
    const view = await screen.findByRole("dialog", { name: /Presenter View · Remain in the vine/ });
    expect(view.dataset.layout).toBe("tablet");
    expect(within(view).getByRole("group", { name: "Current slide, Slide 1 of 6" })).toBeInTheDocument();
    expect(within(view).getByRole("group", { name: "Next slide: Introduction" })).toBeInTheDocument();
    expect(within(view).queryByRole("list", { name: "All slides" })).toBeNull();
    act(() => {
      setWindowWidth(1300);
      window.dispatchEvent(new Event("resize"));
    });
    expect(view.dataset.layout).toBe("desktop");
    const all = within(view).getByRole("list", { name: "All slides" });
    await user.click(within(all).getByRole("button", { name: /Bear fruit/ }));
    expect(within(view).getByText("Slide 6 of 6")).toBeInTheDocument();
    expect(within(all).getByRole("button", { name: /Bear fruit/ })).toHaveAttribute("aria-current", "step");
  });

  it("makes the text larger, follows the app or offers three backgrounds, and says when the screen cannot be kept on", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    await user.click(within(region).getByRole("button", { name: "Start Presenter View" }));
    const view = await screen.findByRole("dialog", { name: /Presenter View/ });
    await user.click(within(view).getByRole("button", { name: "View" }));
    await user.click(within(view).getByRole("button", { name: "Larger text" }));
    expect(within(view).getByText("115 %")).toBeInTheDocument();
    expect(within(view).getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual(["Slides and notes", "Larger notes", "Larger slides", "Follow app", "Light", "Dark", "Warm"]);
    // jsdom has no wake lock: the limitation is said, not hidden.
    expect(within(view).getByRole("checkbox", { name: "Keep the screen on" })).toBeDisabled();
    expect(within(view).getByText(/does not let the app keep the screen on/)).toBeInTheDocument();
  });
});

describe("what the audience sees", () => {
  it("in this window: only the slide, never the speaker's notes or manuscript", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    const slide = within(region).getByRole("listitem", { name: "Slide 5: Stay connected" });
    await user.click(within(slide).getByRole("button", { name: /Stay connected/ }));
    await user.type(within(slide).getByRole("textbox", { name: "Speaker notes" }), "PRIVATE NOTE");
    fireEvent.blur(within(slide).getByRole("textbox", { name: "Speaker notes" }));
    await settle();
    await user.click(within(region).getByRole("button", { name: "Start Presenter View" }));
    const view = await screen.findByRole("dialog", { name: /Presenter View/ });
    await user.click(within(view).getByRole("button", { name: "Audience screen" }));
    await user.click(await within(view).findByRole("button", { name: "Show in this window" }));
    const audience = await screen.findByRole("dialog", { name: "Audience screen" });
    for (let i = 0; i < 4; i++) fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(within(audience).getByText("Stay connected")).toBeInTheDocument());
    expect(audience.textContent).not.toContain("PRIVATE NOTE");
    expect(audience.textContent).not.toContain("SPEAKER EXPLANATION");
    // B empties the screen; Escape goes back to the Presenter View.
    fireEvent.keyDown(window, { key: "b" });
    await waitFor(() => expect(within(audience).queryByText("Stay connected")).toBeNull());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(await screen.findByRole("dialog", { name: /Presenter View/ })).toBeInTheDocument();
  });

  it("on a second screen: the window follows the presenter, with a pause and a passage shown on request", async () => {
    const { api } = await setup();
    api.state.presentation.screens = [
      { index: 0, name: "Built-in", width: 1440, height: 900, primary: true },
      { index: 1, name: "Projector", width: 1920, height: 1080, primary: false },
    ];
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    await user.click(within(region).getByRole("button", { name: "Start Presenter View" }));
    const view = await screen.findByRole("dialog", { name: /Presenter View/ });
    await user.click(within(view).getByRole("button", { name: "Audience screen" }));
    await user.click(await within(view).findByRole("button", { name: "Show on screen 2 (1920 × 1080)" }));
    expect(api.state.presentation.audienceOpen).toEqual({ presentationId: api.state.presentation.presentations[0]!.id, screen: 1 });
    expect(within(view).getByText("The audience screen is on.")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(api.state.presentation.audienceShown.at(-1)).toMatchObject({ index: 1, blank: false, scripture: null }));
    fireEvent.keyDown(window, { key: "b" });
    await waitFor(() => expect(api.state.presentation.audienceShown.at(-1)!.blank).toBe(true));
    fireEvent.keyDown(window, { key: "b" });

    // A passage is looked up privately, then shown, without losing the place.
    await user.click(within(view).getByRole("button", { name: "Bible passage" }));
    await user.click(within(view).getByRole("button", { name: "John 15:1–5" }));
    const found = await within(view).findByRole("region", { name: "John 15:1–5" });
    expect(found.textContent).toMatch(/alpha/);
    expect(api.state.presentation.audienceShown.at(-1)!.scripture).toBeNull();
    await user.click(within(view).getByRole("button", { name: "Show to audience" }));
    await waitFor(() => expect(api.state.presentation.audienceShown.at(-1)!.scripture?.label).toBe("John 15:1–5"));
    expect(api.state.presentation.audienceShown.at(-1)!.index).toBe(1);
    expect(within(view).getByText("Slide 2 of 6")).toBeInTheDocument();
    // Leaving the Presenter View closes the audience window.
    await user.click(within(view).getByRole("button", { name: "Exit" }));
    expect(api.state.presentation.audienceOpen).toBeNull();
  });

  it("the audience window itself is given audience content only and follows the presenter", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    const presentationId = api.state.presentation.presentations[0]!.id;
    await api.presentationItemUpdate({ id: api.state.presentation.presentations[0]!.items[4]!.id, notes: "PRIVATE NOTE" });
    void region;
    const audience = await api.presentationAudience(presentationId);
    expect(JSON.stringify(audience)).not.toMatch(/PRIVATE NOTE|SPEAKER EXPLANATION|manuscript|notes|citations/);

    document.body.innerHTML = "";
    render(
      <ApiProvider api={api}>
        <AudienceWindow presentationId={presentationId} />
      </ApiProvider>,
    );
    const main = await screen.findByRole("main", { name: "Audience screen" });
    // Nothing but the background until the presenter says what to show.
    await settle();
    expect(main.textContent).toBe("");
    await act(async () => {
      await api.presentationAudienceShow({ presentationId, index: 0, blank: false, scripture: null, seq: 1 });
    });
    await within(main).findByText("Remain in the vine");
    await act(async () => {
      await api.presentationAudienceShow({ presentationId, index: 4, blank: false, scripture: null, seq: 3 });
    });
    await within(main).findByText("Stay connected");
    // A change that arrives late never replaces a newer one.
    await act(async () => {
      await api.presentationAudienceShow({ presentationId, index: 0, blank: false, scripture: null, seq: 2 });
    });
    expect(within(main).getByText("Stay connected")).toBeInTheDocument();
    expect(main.textContent).not.toContain("PRIVATE NOTE");
    expect(main.textContent).not.toContain("SPEAKER EXPLANATION");
  });
});

describe("review fixes", () => {
  it("a clicker on the audience screen moves the Presenter View; Space presses buttons instead of turning pages", async () => {
    const { api } = await setup();
    api.state.presentation.screens = [
      { index: 0, name: "Built-in", width: 1440, height: 900, primary: true },
      { index: 1, name: "Projector", width: 1920, height: 1080, primary: false },
    ];
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    await user.click(within(region).getByRole("button", { name: "Start Presenter View" }));
    const view = await screen.findByRole("dialog", { name: /Presenter View/ });
    await user.click(within(view).getByRole("button", { name: "Audience screen" }));
    await user.click(await within(view).findByRole("button", { name: "Show on screen 2 (1920 × 1080)" }));
    await act(async () => {
      await api.presentationAudienceKey("PageDown");
    });
    expect(within(view).getByText("Slide 2 of 6")).toBeInTheDocument();
    // A clicker's Esc must not end the talk at once: the first asks, the second closes the audience screen.
    await act(async () => {
      await api.presentationAudienceKey("Escape");
    });
    expect(api.state.presentation.audienceOpen).not.toBeNull();
    expect(within(view.querySelector("header")!).getByText("Press Esc again to stop presenting")).toBeInTheDocument();
    await act(async () => {
      await api.presentationAudienceKey("Escape");
    });
    expect(api.state.presentation.audienceOpen).toBeNull();
    expect(within(view).getByText("Slide 2 of 6")).toBeInTheDocument();
    // Space on a focused button presses it.
    within(view).getByRole("button", { name: "Back" }).focus();
    await user.keyboard(" ");
    expect(within(view).getByText("Slide 1 of 6")).toBeInTheDocument();
  });

  it("keeps Tab inside the Presenter View and returns focus to the button that opened a panel", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    await user.click(within(region).getByRole("button", { name: "Start Presenter View" }));
    const view = await screen.findByRole("dialog", { name: /Presenter View/ });
    for (let i = 0; i < 40; i++) {
      await user.tab();
      expect(view.contains(document.activeElement)).toBe(true);
    }
    await user.click(within(view).getByRole("button", { name: "View" }));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(within(view).getByRole("button", { name: "View" })).toHaveFocus());
  });

  it("moving a slide to the first place keeps the keyboard on it", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    await user.click(within(region).getByRole("button", { name: "Move slide 2 earlier" }));
    await waitFor(() => expect(within(region).getByRole("listitem", { name: "Slide 1: Introduction" })).toBeInTheDocument());
    await waitFor(() => expect(within(region).getByRole("button", { name: "Move slide 1 later" })).toHaveFocus());
  });
});

describe("presenter layout: controls float, the speaker's material never moves", () => {
  /** The parts of the Presenter View that take part in its layout (overlays excluded). */
  const flow = (view: HTMLElement) =>
    Array.from(view.children).filter((el) => !el.matches("[data-presenter-panel], [data-panel-backdrop], [data-presenter-status]"));

  async function presenting(width: number) {
    const { api } = await setup();
    api.state.presentation.screens = [
      { index: 0, name: "Built-in", width: 1440, height: 900, primary: true },
      { index: 1, name: "Projector", width: 1920, height: 1080, primary: false },
    ];
    const { user } = await renderApp(api, { width });
    const region = await makeSlides(user);
    await user.click(within(region).getByRole("button", { name: "Start Presenter View" }));
    const view = await screen.findByRole("dialog", { name: /Remain in the vine/ });
    return { api, user, view };
  }

  it.each([1920, 1366, 1280, 820])("opening View, Audience screen, Scripture or the timer at %ipx inserts nothing into the layout", async (width) => {
    const { user, view } = await presenting(width);
    const before = flow(view);
    const main = within(view).getByRole("main");
    for (const name of ["Overview", "View", "Audience screen", "Bible passage", /Time so far/]) {
      await user.click(within(view).getByRole("button", { name }));
      const panel = await within(view).findByRole("dialog");
      expect(panel).toHaveAttribute("data-presenter-panel");
      expect(panel.className).toMatch(/\babsolute\b/);
      expect(flow(view)).toEqual(before);
      expect(within(view).getByRole("main")).toBe(main);
      // Focus is in the panel; Escape closes it and returns to its button.
      expect(panel.contains(document.activeElement)).toBe(true);
      // Escape from wherever focus is inside the panel (in Scripture, its text field).
      fireEvent.keyDown(document.activeElement ?? window, { key: "Escape" });
      await waitFor(() => expect(within(view).queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(within(view).getByRole("button", { name })).toHaveFocus());
    }
  });

  it("keeps the top bar to status and four doors; the timer's controls and the keys are behind a click", async () => {
    const { user, view } = await presenting(1366);
    const header = view.querySelector("header")!;
    expect(within(header).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Time so far: 0:00 (starts when you move on)",
      "Overview",
      "Bible passage",
      "Audience screen",
      "View",
      "Exit",
    ]);
    expect(within(header).queryByRole("button", { name: "Pause timer" })).toBeNull();
    await user.click(within(header).getByRole("button", { name: /Time so far/ }));
    const timer = await within(view).findByRole("dialog", { name: "Timer" });
    // Before the talk begins the timer waits; it can be started by hand.
    await user.click(within(timer).getByRole("button", { name: "Start timer" }));
    await user.click(within(timer).getByRole("button", { name: "Pause timer" }));
    expect(within(timer).getByRole("button", { name: "Continue timer" })).toBeInTheDocument();
    await user.click(within(timer).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(within(view).getByRole("button", { name: /Time so far/ })).toHaveFocus());

    expect(view.textContent).not.toMatch(/Page Down or Space for the next slide/);
    await user.click(within(view).getByRole("button", { name: "View" }));
    const settings = await within(view).findByRole("dialog", { name: "View" });
    expect(settings.textContent).not.toMatch(/Page Down or Space for the next slide/);
    await user.click(within(settings).getByRole("button", { name: "Keyboard shortcuts" }));
    expect(settings.textContent).toMatch(/Page Down or Space for the next slide/);
    // Tab stays inside the open panel.
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(settings.contains(document.activeElement)).toBe(true);
    }
  });

  it("on a phone: one menu door, panels as bottom sheets, and back to the menu afterwards", async () => {
    const { user, view } = await presenting(390);
    const header = view.querySelector("header")!;
    expect(within(header).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Time so far: 0:00 (starts when you move on)", "Presenter options", "Exit"]);
    const before = flow(view);
    await user.click(within(header).getByRole("button", { name: "Presenter options" }));
    const menu = await within(view).findByRole("dialog", { name: "Presenter options" });
    expect(menu.className).toMatch(/bottom-0/);
    await user.click(within(menu).getByRole("button", { name: "Audience screen" }));
    const audience = await within(view).findByRole("dialog", { name: "Audience screen" });
    expect(within(audience).getByRole("button", { name: "Show on screen 2 (1920 × 1080)" })).toBeInTheDocument();
    expect(flow(view)).toEqual(before);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(within(header).getByRole("button", { name: "Presenter options" })).toHaveFocus());
  });

  it("on a phone: a choice in the menu puts the keyboard inside the new sheet", async () => {
    const { user, view } = await presenting(390);
    await user.click(within(view).getByRole("button", { name: "Presenter options" }));
    for (const name of ["Overview", "View", "Audience screen", "Bible passage"]) {
      const menu = await within(view).findByRole("dialog", { name: "Presenter options" });
      await user.click(within(menu).getByRole("button", { name }));
      const panel = await within(view).findByRole("dialog", { name });
      await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
      fireEvent.keyDown(document.activeElement ?? window, { key: "Escape" });
      await waitFor(() => expect(within(view).getByRole("button", { name: "Presenter options" })).toHaveFocus());
      await user.click(within(view).getByRole("button", { name: "Presenter options" }));
    }
  });

  it("a click beside a panel closes it and returns the keyboard; the top bar stays usable", async () => {
    const { user, view } = await presenting(1366);
    await user.click(within(view).getByRole("button", { name: "View" }));
    await within(view).findByRole("dialog", { name: "View" });
    const backdrop = view.querySelector("[data-panel-backdrop]")!;
    expect(backdrop.className).toMatch(/top-14/);
    fireEvent.mouseDown(backdrop);
    await waitFor(() => expect(within(view).queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(within(view).getByRole("button", { name: "View" })).toHaveFocus());
    // With a panel open, another door in the bar still works and takes the keyboard into its panel.
    await user.click(within(view).getByRole("button", { name: "View" }));
    await within(view).findByRole("dialog", { name: "View" });
    await user.click(within(view).getByRole("button", { name: "Bible passage" }));
    const scripture = await within(view).findByRole("dialog", { name: "Bible passage" });
    expect(within(view).queryByRole("dialog", { name: "View" })).toBeNull();
    await waitFor(() => expect(scripture.contains(document.activeElement)).toBe(true));
    // Escape while an input method is composing belongs to the input method.
    fireEvent.keyDown(document.activeElement!, { key: "Escape", isComposing: true });
    expect(within(view).getByRole("dialog", { name: "Bible passage" })).toBeInTheDocument();
  });

  it("on a phone the timer opens as a full-width bottom sheet, not a popover placed under the button", async () => {
    const { user, view } = await presenting(390);
    await user.click(within(view).getByRole("button", { name: /Time so far/ }));
    const timer = await within(view).findByRole("dialog", { name: "Timer" });
    expect(timer.className).toMatch(/inset-x-0/);
    expect(timer.style.left).toBe("");
  });

  it("the Audience screen panel starts on Close, and showing on screen 2 returns the keyboard to its button", async () => {
    const { api, user, view } = await presenting(1366);
    await user.click(within(view).getByRole("button", { name: "Audience screen" }));
    const panel = await within(view).findByRole("dialog", { name: "Audience screen" });
    expect(within(panel).getByRole("button", { name: "Close" })).toHaveFocus();
    await user.click(await within(panel).findByRole("button", { name: "Show on screen 2 (1920 × 1080)" }));
    expect(api.state.presentation.audienceOpen).not.toBeNull();
    await waitFor(() => expect(within(view).queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(within(view).getByRole("button", { name: "Audience screen" })).toHaveFocus());
    // Closing the audience window keeps the keyboard in the panel.
    await user.click(within(view).getByRole("button", { name: "Audience screen" }));
    const again = await within(view).findByRole("dialog", { name: "Audience screen" });
    await user.click(within(again).getByRole("button", { name: "Close the audience screen" }));
    await waitFor(() => expect(within(again).getByRole("button", { name: "Close" })).toHaveFocus());
  });

  it("the timer says when it is paused, and page keys still turn slides while its popover is open", async () => {
    const { user, view } = await presenting(1366);
    // The timer waits for the talk to begin: the first move starts it.
    expect(within(view).getByRole("button", { name: /starts when you move on/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "PageDown" });
    expect(within(view).getByRole("button", { name: "Time so far: 0:00" })).toBeInTheDocument();
    await user.click(within(view).getByRole("button", { name: /Time so far/ }));
    const timer = await within(view).findByRole("dialog", { name: "Timer" });
    await user.click(within(timer).getByRole("button", { name: "Pause timer" }));
    expect(within(view).getByRole("button", { name: "Time so far: 0:00 (paused)" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "PageDown" });
    await waitFor(() => expect(within(view).getByText("Slide 3 of 6")).toBeInTheDocument());
  });

  it("what the audience sees now is a floating note, not a row above the speaker's material", async () => {
    const { user, view } = await presenting(1366);
    const before = flow(view);
    fireEvent.keyDown(window, { key: "b" });
    const note = await within(view).findByText("The audience screen is blank.");
    expect(note.closest("[data-presenter-status]")).not.toBeNull();
    // Beside the title, so the slide position and timer stay centred and the doors stay put.
    const [left, centre, right] = Array.from(view.querySelector("header")!.children);
    expect(left!.contains(note)).toBe(true);
    expect(centre!.textContent).toMatch(/^Slide 1 of 6/);
    expect(within(right as HTMLElement).getAllByRole("button").map((b) => b.textContent)).toEqual(["Overview", "Bible passage", "Audience screen", "View", "Exit"]);
    expect(flow(view)).toEqual(before);
    await user.click(within(view).getByRole("button", { name: "Return to slide" }));
    expect(within(view).queryByText("The audience screen is blank.")).toBeNull();
  });
});

describe("presenting: the useful few things, simply", () => {
  async function presenting(width = 1366, target?: number) {
    const { api } = await setup();
    api.state.presentation.screens = [
      { index: 0, name: "Built-in", width: 1440, height: 900, primary: true },
      { index: 1, name: "Projector", width: 1920, height: 1080, primary: false },
    ];
    const { user } = await renderApp(api, { width });
    const region = await makeSlides(user);
    if (target !== undefined) {
      await user.click(within(region).getByText("Name, design, Bible and target time"));
      await user.selectOptions(within(region).getByRole("combobox", { name: /Target time/ }), String(target));
      await waitFor(() => expect(api.state.presentation.presentations[0]!.targetMinutes).toBe(target));
    }
    await user.click(within(region).getByRole("button", { name: "Start Presenter View" }));
    const view = await screen.findByRole("dialog", { name: /Remain in the vine/ });
    return { api, user, view, region };
  }
  async function onScreenTwo(user: User, view: HTMLElement) {
    await user.click(within(view).getByRole("button", { name: "Audience screen" }));
    await user.click(await within(view).findByRole("button", { name: "Show on screen 2 (1920 × 1080)" }));
    await within(view.querySelector("header")!).findByText("The audience screen is on.");
  }
  const last = (api: Awaited<ReturnType<typeof setup>>["api"]) => api.state.presentation.audienceShown.at(-1)!;

  it("Overview shows every slide over the view and goes straight to the one chosen", async () => {
    const { api, user, view } = await presenting();
    await onScreenTwo(user, view);
    const main = within(view).getByRole("main");
    const saved = structuredClone(api.state.presentation.presentations[0]!);
    await user.click(within(view).getByRole("button", { name: "Overview" }));
    const overview = await within(view).findByRole("dialog", { name: "Overview" });
    expect(overview.className).toMatch(/\babsolute\b/);
    expect(within(view).getByRole("main")).toBe(main);
    const items = within(overview).getAllByRole("button").filter((b) => b.closest("ol"));
    expect(items).toHaveLength(6);
    // The keyboard starts on the current slide.
    expect(items[0]).toHaveAttribute("aria-current", "step");
    expect(items[0]).toHaveFocus();
    await user.click(items[3]!);
    await waitFor(() => expect(within(view).queryByRole("dialog")).toBeNull());
    expect(within(view).getByText("Slide 4 of 6")).toBeInTheDocument();
    await waitFor(() => expect(within(view).getByRole("button", { name: "Overview" })).toHaveFocus());
    // The audience follows; the order of the presentation is unchanged; the audience screen stays on.
    await waitFor(() => expect(last(api).index).toBe(3));
    expect(api.state.presentation.audienceOpen).not.toBeNull();
    expect(api.state.presentation.presentations[0]).toEqual(saved);
    // O opens it from the keyboard too.
    fireEvent.keyDown(window, { key: "o" });
    expect(await within(view).findByRole("dialog", { name: "Overview" })).toBeInTheDocument();
  });

  it("Blank audience screen empties only the audience screen; B brings back exactly the same slide", async () => {
    const { api, user, view } = await presenting();
    await onScreenTwo(user, view);
    fireEvent.keyDown(window, { key: "PageDown" });
    fireEvent.keyDown(window, { key: "PageDown" });
    await waitFor(() => expect(last(api).index).toBe(2));
    const blankButton = within(view).getByRole("button", { name: "Blank audience screen" });
    await user.click(blankButton);
    await waitFor(() => expect(last(api)).toMatchObject({ index: 2, blank: true }));
    expect(blankButton).toHaveAttribute("aria-pressed", "true");
    // The speaker keeps their own material and place.
    expect(within(view).getByText("Slide 3 of 6")).toBeInTheDocument();
    expect(within(view).getByRole("main").textContent).not.toBe("");
    fireEvent.keyDown(window, { key: "b" });
    await waitFor(() => expect(last(api)).toMatchObject({ index: 2, blank: false }));
    expect(blankButton).toHaveAttribute("aria-pressed", "false");
    // What reaches the audience screen is only the place, the blank, a passage and the marks.
    for (const shown of api.state.presentation.audienceShown) {
      expect(Object.keys(shown).sort()).toEqual(["blank", "index", "marks", "presentationId", "scripture", "seq"]);
      expect(JSON.stringify(shown)).not.toMatch(/SPEAKER EXPLANATION|notes|manuscript/);
    }
  });

  it("the pointer and highlighter show on the audience screen for this moment only", async () => {
    const { api, user, view } = await presenting();
    await onScreenTwo(user, view);
    const tools = within(view).getByRole("group", { name: "Pointer and highlighter" });
    await user.click(within(tools).getByRole("button", { name: "Highlighter" }));
    const layer = view.querySelector<HTMLElement>("[data-draw-layer='pen']")!;
    fireEvent.pointerDown(layer, { clientX: 10, clientY: 10, pointerId: 1 });
    await waitFor(() => expect(last(api).marks?.strokes).toHaveLength(1));
    expect(view.querySelector("[data-live-marks]")).not.toBeNull();
    await user.click(within(tools).getByRole("button", { name: "Clear marks" }));
    await waitFor(() => expect(last(api).marks?.strokes).toEqual([]));
    fireEvent.pointerDown(layer, { clientX: 20, clientY: 20, pointerId: 1 });
    await waitFor(() => expect(last(api).marks?.strokes).toHaveLength(1));
    // A new slide starts clean.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(last(api)).toMatchObject({ index: 1, marks: { strokes: [] } }));
    // The pointer: shown while used, gone when it is put away (Esc), and Esc does not leave the Presenter View.
    await user.click(within(tools).getByRole("button", { name: "Pointer" }));
    fireEvent.pointerDown(view.querySelector<HTMLElement>("[data-draw-layer='pointer']")!, { clientX: 5, clientY: 5, pointerId: 1 });
    await waitFor(() => expect(last(api).marks?.pointer).not.toBeNull());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(last(api).marks?.pointer).toBeNull());
    expect(within(tools).getByRole("button", { name: "Pointer" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("dialog", { name: /Remain in the vine/ })).toBeInTheDocument();
    // Nothing of it is saved with the presentation.
    expect(JSON.stringify(api.state.presentation.presentations)).not.toMatch(/strokes|pointer/);
  });

  it("with a target time, the timer quietly says how much is left; without one it only counts", async () => {
    const { view } = await presenting(1366, 30);
    const timer = within(view).getByRole("button", { name: /Time so far/ });
    expect(timer).toHaveAccessibleName("Time so far: 0:00 (starts when you move on) · 30 min left");
    expect(timer.querySelector("[data-time-guidance='normal']")!.textContent).toBe("· 30 min left");
    fireEvent.click(timer);
    const popover = await within(view).findByRole("dialog", { name: "Timer" });
    expect(popover.textContent).toMatch(/Target: 30 min · 30 min left/);
  });

  it("the target time is chosen with the presentation's name and design, and saved with it", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    await user.click(within(region).getByText("Name, design, Bible and target time"));
    await user.selectOptions(within(region).getByRole("combobox", { name: /Target time/ }), "30");
    await waitFor(() => expect(api.state.presentation.presentations[0]!.targetMinutes).toBe(30));
    await user.selectOptions(within(region).getByRole("combobox", { name: /Target time/ }), "0");
    await waitFor(() => expect(api.state.presentation.presentations[0]!.targetMinutes).toBeNull());
  });

  it("a layout is remembered on this computer; a phone always shows the speaker sheet", async () => {
    const { user, view, region } = await presenting(1366);
    expect(view).toHaveAttribute("data-arrangement", "balanced");
    await user.click(within(view).getByRole("button", { name: "View" }));
    await user.click(within(view).getByRole("radio", { name: "Larger notes" }));
    expect(view).toHaveAttribute("data-arrangement", "notes");
    // The order of slides and the notes stay in the layout: only their sizes change.
    expect(within(view).queryByRole("list", { name: "All slides" })).toBeNull();
    await user.click(within(view).getByRole("radio", { name: "Larger slides" }));
    expect(view).toHaveAttribute("data-arrangement", "slides");
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Remain in the vine/ })).toBeNull());
    await user.click(within(region).getByRole("button", { name: "Start Presenter View" }));
    expect(await screen.findByRole("dialog", { name: /Remain in the vine/ })).toHaveAttribute("data-arrangement", "slides");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Remain in the vine/ })).toBeNull());
    setWindowWidth(390);
    await user.click(within(region).getByRole("button", { name: "Start Presenter View" }));
    const phone = await screen.findByRole("dialog", { name: /Remain in the vine/ });
    expect(phone).toHaveAttribute("data-arrangement", "sheet");
    await user.click(within(phone).getByRole("button", { name: "Presenter options" }));
    await user.click(within(phone).getByRole("button", { name: "View" }));
    const settings = await within(phone).findByRole("dialog", { name: "View" });
    expect(within(settings).queryByRole("radio", { name: "Larger slides" })).toBeNull();
  });

  it("a Bible passage is shown to the audience for a moment and Return to slide brings back the same slide", async () => {
    const { api, user, view } = await presenting();
    await onScreenTwo(user, view);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    const before = structuredClone(api.state.presentation.presentations[0]!);
    await user.click(within(view).getByRole("button", { name: "Bible passage" }));
    await user.click(within(view).getByRole("button", { name: "John 15:1–5" }));
    // Read privately first.
    await within(view).findByRole("region", { name: "John 15:1–5" });
    expect(last(api).scripture).toBeNull();
    await user.click(within(view).getByRole("button", { name: "Show to audience" }));
    await waitFor(() => expect(last(api)).toMatchObject({ index: 1, scripture: { label: "John 15:1–5" } }));
    fireEvent.keyDown(document.activeElement ?? window, { key: "Escape" });
    await user.click(within(view).getByRole("button", { name: "Return to slide" }));
    await waitFor(() => expect(last(api)).toMatchObject({ index: 1, scripture: null }));
    // The presentation itself is unchanged.
    expect(api.state.presentation.presentations[0]).toEqual(before);
  });

  it("Bible passage reads a passage typed in another language through the shared Scripture reader", async () => {
    const { api, user, view } = await presenting();
    const parse = vi.spyOn(api, "referenceParse");
    await user.click(within(view).getByRole("button", { name: "Bible passage" }));
    const scripture = await within(view).findByRole("dialog", { name: "Bible passage" });
    await user.type(within(scripture).getByRole("textbox", { name: "Passage" }), "Johannes 15,5{Enter}");
    // The same reader as Scripture navigation, Bible Study and Teaching — no
    // parser of the Presenter View's own, and the English interface no gate.
    expect(parse).toHaveBeenCalledWith("Johannes 15,5", api.state.bibles[0]!.id);
    await within(view).findByRole("region", { name: "John 15:5" });
  });

  it("Bible passage: the presentation's Bible language decides an ambiguous abbreviation before the interface language", async () => {
    // "Jn" is Jonah in Portuguese and John in English. Interface English, the
    // presentation's Bible Portuguese (its stored language tag): Jonah.
    const { api, user, view } = await presenting();
    api.state.bibles[0]!.languageCode = "pt";
    const parse = vi.spyOn(api, "referenceParse");
    await user.click(within(view).getByRole("button", { name: "Bible passage" }));
    const scripture = await within(view).findByRole("dialog", { name: "Bible passage" });
    await user.type(within(scripture).getByRole("textbox", { name: "Passage" }), "Jn 3:5{Enter}");
    expect(parse).toHaveBeenCalledWith("Jn 3:5", api.state.bibles[0]!.id);
    await within(view).findByRole("region", { name: "Jonah 3:5" });
    // The other way round: an English Bible under a Portuguese interface reads John.
    api.state.bibles[0]!.languageCode = "en";
    await act(async () => {
      await i18n.changeLanguage("pt");
    });
    const box = within(view).getByRole("textbox", { name: "Passagem" });
    await user.clear(box);
    await user.type(box, "Jn 3:5{Enter}");
    await within(view).findByRole("region", { name: "João 3:5" });
  });

  it("a clicker's Page Down / Page Up, the arrows and Space move; a number and Enter go to that slide", async () => {
    const { view } = await presenting();
    for (const [key, at] of [
      ["PageDown", 2],
      ["ArrowRight", 3],
      [" ", 4],
      ["PageUp", 3],
      ["ArrowLeft", 2],
      ["End", 6],
      ["Home", 1],
    ] as const) {
      fireEvent.keyDown(window, { key });
      expect(within(view).getByText(`Slide ${at} of 6`)).toBeInTheDocument();
    }
    fireEvent.keyDown(window, { key: "5" });
    expect(within(view).getByText("Go to slide 5…")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(within(view).getByText("Slide 5 of 6")).toBeInTheDocument();
    // A number that is not a slide changes nothing; Esc forgets a typed number before anything else.
    fireEvent.keyDown(window, { key: "9" });
    fireEvent.keyDown(window, { key: "9" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(within(view).getByText("Slide 5 of 6")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(within(view).getByText("Slide 5 of 6")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /Remain in the vine/ })).toBeInTheDocument();
  });

  it("an audience window closed by accident or a lost projector never ends the presentation; Show again brings it back", async () => {
    const { api, user, view } = await presenting();
    await onScreenTwo(user, view);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    // The window closes without the speaker asking.
    act(() => {
      api.state.presentation.audienceOpen = null;
      for (const handler of api.state.presentation.closedHandlers) handler();
    });
    expect(await within(view.querySelector("header")!).findByText("Audience screen disconnected")).toBeInTheDocument();
    expect(within(view).getByText("Slide 3 of 6")).toBeInTheDocument();
    await user.click(within(view).getByRole("button", { name: "Show again" }));
    await waitFor(() => expect(api.state.presentation.audienceOpen).toMatchObject({ screen: 1 }));
    expect(last(api).index).toBe(2);
    expect(within(view.querySelector("header")!).queryByText("Audience screen disconnected")).toBeNull();

    // The projector is unplugged: the window is closed (it would cover the speaker's screen) and the speaker is told.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      // The check starts again with the new interval timers.
      await user.click(within(view).getByRole("button", { name: "Audience screen" }));
      await user.click(within(view).getByRole("button", { name: "Close the audience screen" }));
      fireEvent.keyDown(document.activeElement ?? window, { key: "Escape" });
      await onScreenTwo(user, view);
      api.state.presentation.screens = [{ index: 0, name: "Built-in", width: 1440, height: 900, primary: true }];
      await act(async () => {
        vi.advanceTimersByTime(3100);
        await Promise.resolve();
      });
      expect(await within(view.querySelector("header")!).findByText("Audience screen disconnected")).toBeInTheDocument();
      expect(api.state.presentation.audienceOpen).toBeNull();
      expect(within(view).getByText("Slide 3 of 6")).toBeInTheDocument();
      // Its screen is gone: Show again lets the speaker choose where.
      await user.click(within(view).getByRole("button", { name: "Show again" }));
      expect(await within(view).findByRole("dialog", { name: "Audience screen" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("review fixes: a number and Enter work while Next has the keyboard; clicker keys work over a panel", async () => {
    const { api, user, view } = await presenting();
    await onScreenTwo(user, view);
    const next = within(view).getByRole("button", { name: "Next" });
    next.focus();
    fireEvent.keyDown(next, { key: "4" });
    fireEvent.keyDown(next, { key: "Enter" });
    expect(within(view).getByText("Slide 4 of 6")).toBeInTheDocument();
    expect(within(view).queryByText("Go to slide 4…")).toBeNull();
    // A passage shown from the open panel: the clicker's Page Down still moves on.
    await user.click(within(view).getByRole("button", { name: "Bible passage" }));
    await user.click(within(view).getByRole("button", { name: "John 15:1–5" }));
    await user.click(await within(view).findByRole("button", { name: "Show to audience" }));
    await waitFor(() => expect(last(api).scripture).not.toBeNull());
    fireEvent.keyDown(document.activeElement!, { key: "PageDown" });
    await waitFor(() => expect(last(api)).toMatchObject({ index: 4, scripture: null }));
    // Esc closes the panel before anything else.
    await user.click(within(view).getByRole("button", { name: "Pointer" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(within(view).queryByRole("dialog", { name: "Bible passage" })).toBeNull());
    expect(within(view).getByRole("button", { name: "Pointer" })).toHaveAttribute("aria-pressed", "true");
  });

  it("review fixes: with the audience screen on, one Esc only asks; the pointer never sticks; tools go away with the screen", async () => {
    const { api, user, view } = await presenting();
    await onScreenTwo(user, view);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: /Remain in the vine/ })).toBeInTheDocument();
    expect(within(view.querySelector("header")!).getByText("Press Esc again to stop presenting")).toBeInTheDocument();
    expect(api.state.presentation.audienceOpen).not.toBeNull();
    // The pointer leaving the slide is gone from the audience screen, even with a move still waiting for its frame.
    await user.click(within(view).getByRole("button", { name: "Pointer" }));
    const layer = view.querySelector<HTMLElement>("[data-draw-layer='pointer']")!;
    fireEvent.pointerDown(layer, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 9, clientY: 9, pointerId: 1 });
    fireEvent.pointerLeave(layer, { pointerId: 1 });
    await settle();
    expect(last(api).marks?.pointer).toBeNull();
    // The highlighter on, then the projector lost: no drawing layer is left without its buttons.
    await user.click(within(view).getByRole("button", { name: "Highlighter" }));
    expect(view.querySelector("[data-draw-layer]")).not.toBeNull();
    act(() => {
      api.state.presentation.audienceOpen = null;
      for (const handler of api.state.presentation.closedHandlers) handler();
    });
    await within(view.querySelector("header")!).findByText("Audience screen disconnected");
    expect(view.querySelector("[data-draw-layer]")).toBeNull();
    expect(view.querySelector("[role=status]")!.textContent).toBe("Audience screen disconnected");
    // Without the audience screen, one Esc leaves as before.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Remain in the vine/ })).toBeNull());
  });

  it("review fixes: after clicking Blank or a slide, Space goes on to the next slide", async () => {
    const { api, user, view } = await presenting();
    await onScreenTwo(user, view);
    await user.click(within(within(view).getByRole("list", { name: "All slides" })).getAllByRole("button")[2]!);
    expect(within(view).getByText("Slide 3 of 6")).toBeInTheDocument();
    await user.keyboard(" ");
    expect(within(view).getByText("Slide 4 of 6")).toBeInTheDocument();
    await user.click(within(view).getByRole("button", { name: "Blank audience screen" }));
    await waitFor(() => expect(last(api).blank).toBe(true));
    await user.keyboard(" ");
    // On to the next slide (which ends the blank screen); the Blank button is not pressed again.
    await waitFor(() => expect(last(api)).toMatchObject({ index: 4, blank: false }));
    expect(within(view).getByText("Slide 5 of 6")).toBeInTheDocument();
  });

  it("review fixes: in the one-window audience view O does nothing", async () => {
    const { user, view } = await presenting();
    await user.click(within(view).getByRole("button", { name: "Audience screen" }));
    await user.click(await within(view).findByRole("button", { name: "Show in this window" }));
    const here = await screen.findByRole("dialog", { name: "Audience screen" });
    fireEvent.keyDown(window, { key: "o" });
    fireEvent.keyDown(window, { key: "Escape" });
    const back = await screen.findByRole("dialog", { name: /Remain in the vine/ });
    expect(here).not.toBeInTheDocument();
    expect(within(back).queryByRole("dialog", { name: "Overview" })).toBeNull();
  });

  it("closing the audience screen on purpose is not reported as a problem", async () => {
    const { api, user, view } = await presenting();
    await onScreenTwo(user, view);
    await user.click(within(view).getByRole("button", { name: "Audience screen" }));
    // The window's closing is reported back (as the app does); it is not a problem.
    await user.click(within(view).getByRole("button", { name: "Close the audience screen" }));
    expect(api.state.presentation.audienceOpen).toBeNull();
    expect(within(view.querySelector("header")!).queryByText("Audience screen disconnected")).toBeNull();
    expect(view.querySelector("[role=status]")!.textContent).toBe("The audience screen was closed.");
  });
});

describe("exports", () => {
  it("saves through the system's save dialog with words in the person's language, and does nothing when cancelled", async () => {
    const { api } = await setup();
    const { user } = await renderApp(api);
    const region = await makeSlides(user);
    await user.click(within(region).getByRole("button", { name: "Export…" }));
    const dialog = await screen.findByRole("dialog", { name: "Export the presentation" });
    expect(within(dialog).getAllByRole("radio").map((r) => r.closest("label")!.querySelector("span span")!.textContent)).toEqual([
      "PowerPoint (.pptx)",
      "PDF slides",
      "Speaker sheet (PDF for a phone)",
      "Markdown (.md)",
      "Delivery package (.json)",
    ]);
    await user.click(within(dialog).getByRole("radio", { name: /Markdown/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Include my manuscript and speaker notes" }));
    api.state.presentation.nextSavePath = "/home/test/Documents/Remain in the vine.md";
    await user.click(within(dialog).getByRole("button", { name: "Choose where to save…" }));
    await within(dialog).findByText("Saved: /home/test/Documents/Remain in the vine.md");
    expect(api.state.presentation.saveDialogs.at(-1)).toEqual({ defaultName: "Remain in the vine.md", format: "markdown" });
    const exported = api.state.presentation.exports.at(-1)!;
    expect(exported.format).toBe("markdown");
    expect(exported.options.speakerNotes).toBe(true);
    expect(exported.options.locale.bookNames.JHN).toBe("John");
    expect(exported.options.locale.labels.speakerNotes).toBe("Speaker notes");

    // The speaker sheet always has the speaker's text; a cancelled dialog saves nothing.
    await user.click(within(dialog).getByRole("radio", { name: /Speaker sheet/ }));
    api.state.presentation.nextSavePath = null;
    await user.click(within(dialog).getByRole("button", { name: "Choose where to save…" }));
    await waitFor(() => expect(api.state.presentation.saveDialogs.at(-1)!.defaultName).toBe("Remain in the vine – speaker sheet.pdf"));
    expect(api.state.presentation.exports).toHaveLength(1);
  });
});

describe("in other languages", () => {
  it("names the single presenter mode naturally in German, with du", async () => {
    const { api } = await setup();
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    const { user } = await renderApp(api);
    await user.click(within(await screen.findByRole("list", { name: "Bibelstudien" })).getByRole("button", { name: /Abiding/ }));
    await user.click(await within(screen.getByRole("main", { name: /Bibelstudium/ })).findByRole("button", { name: "Bibellehre" }));
    await user.click(await screen.findByRole("button", { name: "Unterlagen" }));
    await user.click(await screen.findByRole("menuitem", { name: /^Präsentation/ }));
    expect(await screen.findByText(/Wähle, was deine Zuhörer sehen/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Folien aus der Bibellehre machen" }));
    expect(await screen.findByRole("button", { name: "Referentenansicht starten" })).toBeInTheDocument();
  });
});
