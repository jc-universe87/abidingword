import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, ChevronLeft, ChevronRight, CircleHelp, Menu, Minus, MonitorUp, Pause, Play, Plus, RotateCcw, Settings2, X } from "lucide-react";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { readLocal, writeLocal } from "@/lib/storage";
import { PRESENTATION_THEMES, type AudienceState, type PresentationDocument, type PresentationTheme, type ScriptureOverlay, type Screen, type Slide } from "@/types/presentation";
import { palette, refLabel, slideText, splitVerses, themeLabel } from "./labels";
import { SlideView } from "./SlideView";
import { layoutFor, useSlideImages, useViewportWidth } from "./useSlideImages";

interface PresenterViewProps {
  doc: PresentationDocument;
  /** Leaves the Presenter View; the caller gives focus back to where it started. */
  onClose: () => void;
}

/** Where the audience sees the slides: nowhere yet, a second window, or this window. */
type AudienceMode = "none" | "window" | "here";

const SCALES = [0.85, 1, 1.15, 1.3, 1.5, 1.75] as const;

interface Prefs {
  scale: number;
  theme: PresentationTheme;
  timer: boolean;
  clock: boolean;
  awake: boolean;
}

const DEFAULT_PREFS: Prefs = { scale: 1, theme: "warm", timer: true, clock: true, awake: true };

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/** Space and Enter on a button or link press it; they do not turn the page. */
function pressesControl(target: EventTarget | null, key: string): boolean {
  return (key === " " || key === "Enter") && target instanceof HTMLElement && target.closest("button, a, [role='button'], summary") !== null;
}

/** Tab stays inside the open panel, else inside the Presenter View (it covers the whole window). */
function keepTabInside(e: KeyboardEvent) {
  const root = document.querySelector<HTMLElement>("[data-presenter-panel]") ?? document.querySelector<HTMLElement>("[data-presenter-root]");
  if (!root) return;
  const items = Array.from(root.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")).filter(
    (el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0,
  );
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const inside = root.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || !inside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
    e.preventDefault();
    first.focus();
  }
}

function elapsedLabel(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/**
 * The Presenter View (v0.18): one speaker view that adapts to the screen —
 * a speaker sheet with large text and big Back/Next buttons on a phone; the
 * current and next slide beside the notes on a tablet; the audience slide,
 * the next slide, the manuscript and all slides on a desktop. Nothing can be
 * edited here. The audience sees only audience content, on a second window
 * or in this window.
 */
export function PresenterView({ doc, onClose }: PresenterViewProps) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const titleId = useId();
  const width = useViewportWidth();
  const layout = layoutFor(width);
  const images = useSlideImages(doc.presentationId, doc.images);
  const [index, setIndex] = useState(0);
  const [blank, setBlank] = useState(false);
  const [overlay, setOverlay] = useState<ScriptureOverlay | null>(null);
  const [audience, setAudience] = useState<AudienceMode>("none");
  // One floating panel at a time; none of them moves the speaker's material.
  const [panel, setPanel] = useState<"none" | "scripture" | "settings" | "audience" | "timer" | "menu">("none");
  const [prefs, setPrefsState] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...readLocal<Partial<Prefs>>("presenter", {}) }));
  const [notice, setNotice] = useState("");
  const nextButton = useRef<HTMLButtonElement>(null);
  const total = doc.slides.length;
  const slide: Slide | undefined = doc.slides[index];
  const next: Slide | undefined = doc.slides[index + 1];

  const setPrefs = (change: Partial<Prefs>) =>
    setPrefsState((current) => {
      const updated = { ...current, ...change };
      writeLocal("presenter", updated);
      return updated;
    });

  const exitButton = useRef<HTMLButtonElement>(null);
  const toolButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  // The timer's popover opens under it.
  const [timerButton, setTimerButton] = useState<HTMLButtonElement | null>(null);
  useEffect(() => {
    const next = nextButton.current;
    if (next && !next.disabled) next.focus();
    else exitButton.current?.focus();
  }, []);
  /** Back from a panel or the audience view: the keyboard returns to the button that opened it. */
  const returnTo = (name: string) =>
    requestAnimationFrame(() => {
      // On a phone, Scripture, Audience screen and View are reached through the menu.
      const target = [toolButtons.current[name], toolButtons.current.menu, exitButton.current].find((el) => el?.isConnected);
      target?.focus();
    });

  const go = useCallback(
    (to: number) => {
      const target = Math.max(0, Math.min(total - 1, to));
      setIndex(target);
      // Moving on takes the passage and a pause away from the audience screen.
      setOverlay(null);
      setBlank(false);
    },
    [total],
  );

  // What the audience screen shows follows the presenter.
  const shown: AudienceState = useMemo(() => ({ presentationId: doc.presentationId, index, blank, scripture: overlay }), [doc.presentationId, index, blank, overlay]);
  useEffect(() => {
    if (audience === "window") void api.presentationAudienceShow(shown).catch(() => undefined);
  }, [api, audience, shown]);
  useEffect(() => {
    let stop: (() => void) | null = null;
    let active = true;
    void api
      .onAudienceClosed(() => {
        setAudience((mode) => (mode === "window" ? "none" : mode));
        setNotice(t("presentation.presenter.audienceClosed"));
      })
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      }, () => undefined);
    return () => {
      active = false;
      stop?.();
    };
  }, [api, t]);
  // Leaving the Presenter View closes the audience window too.
  const close = useCallback(() => {
    if (audience === "window") void api.presentationAudienceClose().catch(() => undefined);
    onClose();
  }, [api, audience, onClose]);

  // One set of keys for this window and for the audience screen (a clicker there).
  const handleKey = useCallback(
    (key: string, fromAudience: boolean): boolean => {
      if (key === "Escape") {
        if (fromAudience) {
          void api.presentationAudienceClose().catch(() => undefined);
          setAudience("none");
        } else if (audience === "here") {
          setAudience("none");
          returnTo("audience");
        } else if (panel !== "none") {
          const open = panel;
          setPanel("none");
          returnTo(open);
        } else close();
        return true;
      }
      if (panel !== "none" && panel !== "timer" && audience !== "here" && !fromAudience) return false;
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(key)) go(index + 1);
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(key)) go(index - 1);
      else if (key === "Home") go(0);
      else if (key === "End") go(total - 1);
      else if (key === "b" || key === "B" || key === ".") setBlank((b) => !b);
      else return false;
      return true;
    },
    [api, audience, close, go, index, panel, total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        keepTabInside(e);
        return;
      }
      // Escape closes a panel even from its text field; other keys there are typing.
      if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.isComposing) {
        if (handleKey(e.key, false)) e.preventDefault();
        return;
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || pressesControl(e.target, e.key)) return;
      // Enter only turns the page from the audience screen (where nothing can be pressed).
      if (e.key === "Enter") return;
      if (handleKey(e.key, false)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleKey]);

  // Keys pressed while the audience window has focus come back here.
  const keyHandler = useRef(handleKey);
  useEffect(() => {
    keyHandler.current = handleKey;
  }, [handleKey]);
  useEffect(() => {
    let stop: (() => void) | null = null;
    let active = true;
    void api.onAudienceKey((key) => keyHandler.current(key, true)).then(
      (unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      },
      () => undefined,
    );
    return () => {
      active = false;
      stop?.();
    };
  }, [api]);

  // Timer and clock.
  const [startedAt, setStartedAt] = useState<number | null>(() => Date.now());
  const [before, setBefore] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);
  const elapsed = before + (startedAt === null ? 0 : Math.max(0, now - startedAt));
  const clock = new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(now);

  const awake = useWakeLock(prefs.awake);
  const colours = palette(prefs.theme);
  const position = t("presentation.presenter.position", { current: index + 1, total });
  const slideName = (s: Slide) => slideText(t, s.kind, s.audience.heading, s.audience.body, s.audience.reference);

  if (!slide) {
    return (
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-bg p-4">
        <h2 id={titleId} className="m-0 text-xl">{t("presentation.presenter.title")}</h2>
        <p className="m-0 text-text-muted">{t("presentation.presenter.empty")}</p>
        <button type="button" onClick={onClose} className="min-h-11 rounded-aw border border-border px-4">
          {t("presentation.presenter.exit")}
        </button>
      </div>
    );
  }

  if (audience === "here") {
    return (
      <HereAudience
        doc={doc}
        slide={slide}
        image={slide.audience.image ? (images.get(slide.audience.image.assetId) ?? null) : null}
        blank={blank}
        overlay={overlay}
        label={position}
        onBack={() => {
          setAudience("none");
          returnTo("audience");
        }}
        onNext={() => go(index + 1)}
        onPrevious={() => go(index - 1)}
      />
    );
  }

  const textSize = (rem: number) => ({ fontSize: `${rem * prefs.scale}rem` });
  const preview = (s: Slide, label: string) => (
    <SlideView
      slide={s.audience}
      kind={s.kind}
      theme={doc.theme}
      image={s.audience.image ? (images.get(s.audience.image.assetId) ?? null) : null}
      label={label}
      className="rounded-aw border border-black/20"
    />
  );
  const currentLabel = t("presentation.presenter.current", { position });

  const nav = (
    <nav aria-label={t("presentation.presenter.navigation")} className="flex items-stretch gap-2">
      <button
        type="button"
        onClick={() => go(index - 1)}
        disabled={index === 0}
        className="inline-flex min-h-14 flex-1 items-center justify-center gap-1 rounded-aw border px-4 text-[1.0625rem] font-medium disabled:opacity-50"
        style={{ borderColor: colours.muted }}
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
        {t("presentation.presenter.previous")}
      </button>
      <button
        ref={nextButton}
        type="button"
        onClick={() => go(index + 1)}
        disabled={index >= total - 1}
        className="inline-flex min-h-14 flex-[2] items-center justify-center gap-1 rounded-aw px-4 text-[1.0625rem] font-semibold disabled:opacity-50"
        style={{ backgroundColor: colours.accent, color: colours.background }}
      >
        {t("presentation.presenter.next")}
        <ChevronRight className="size-5" aria-hidden="true" />
      </button>
    </nav>
  );

  const speakerText = (s: Slide, withAudience: boolean) => (
    <div className="flex flex-col gap-4" style={textSize(1.125)}>
      {withAudience && <AudienceText slide={s} colours={colours} scale={prefs.scale} />}
      {s.speaker.manuscript.map((part, i) => (
        <section key={i} className="flex flex-col gap-1">
          <h3 className="m-0 text-[0.875em] font-semibold uppercase tracking-wide" style={{ color: colours.muted }}>
            {t(`presentation.export.labels.${part.field}`)}
          </h3>
          <p className="m-0 whitespace-pre-wrap leading-relaxed">{part.field === "standing" ? t(`presentation.export.standings.${part.text}`, { defaultValue: part.text }) : part.text}</p>
        </section>
      ))}
      {s.speaker.notes && (
        <section className="flex flex-col gap-1">
          <h3 className="m-0 text-[0.875em] font-semibold uppercase tracking-wide" style={{ color: colours.muted }}>
            {t("presentation.export.labels.speakerNotes")}
          </h3>
          <p className="m-0 whitespace-pre-wrap leading-relaxed">{s.speaker.notes}</p>
        </section>
      )}
      {s.speaker.manuscript.length === 0 && !s.speaker.notes && !withAudience && (
        <p className="m-0" style={{ color: colours.muted }}>{t("presentation.presenter.noNotes")}</p>
      )}
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-layout={layout}
      data-presenter-root=""
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{ backgroundColor: colours.background, color: colours.text }}
    >
      {/* One calm bar of fixed height: the title (and what the audience sees) left, slide and timer
          centred, the four doors right. On a phone: slide, timer and one menu door. */}
      <header
        className={`h-14 shrink-0 items-center gap-3 border-b px-3 ${layout === "phone" ? "flex flex-nowrap" : "grid grid-cols-[minmax(0,1fr)_auto_minmax(min-content,1fr)]"}`}
        style={{ borderColor: `${colours.muted}55` }}
      >
        <div className={`flex min-w-0 items-center gap-2 ${layout === "phone" ? "shrink-0" : ""}`}>
          <h2 id={titleId} className={layout === "phone" ? "sr-only" : "m-0 min-w-0 truncate text-[1rem] font-semibold"}>
            {layout === "phone" ? doc.title : t("presentation.presenter.titleWith", { title: doc.title })}
          </h2>
          {/* What the audience sees, when it differs from the slide: a chip in the bar, covering nothing. */}
          {(blank || overlay || audience === "window") && (
            <div data-presenter-status="" className="flex min-w-0 max-w-full shrink-0 items-center gap-1 rounded-full border pl-2 text-[0.875rem]" style={{ borderColor: colours.accent }}>
              <MonitorUp className="size-4 shrink-0" aria-hidden="true" style={{ color: colours.accent }} />
              <span className={layout === "desktop" ? "min-w-0 truncate" : "sr-only"}>
                {blank
                  ? t("presentation.presenter.blankOn")
                  : overlay
                    ? t("presentation.presenter.showingScripture", { reference: overlay.label })
                    : t("presentation.presenter.audienceOn")}
              </span>
              {blank || overlay ? (
                <button
                  type="button"
                  onClick={() => {
                    setBlank(false);
                    setOverlay(null);
                  }}
                  aria-label={layout === "desktop" ? undefined : t("presentation.presenter.backToSlide")}
                  className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full px-2 font-medium underline"
                >
                  {layout === "desktop" ? t("presentation.presenter.backToSlide") : <RotateCcw className="size-4" aria-hidden="true" />}
                </button>
              ) : (
                <span className="pr-2" />
              )}
            </div>
          )}
        </div>
        <div className={`flex min-w-0 items-center gap-2 tabular-nums ${layout === "phone" ? "flex-1" : "justify-center"}`}>
          <p aria-live="polite" className="m-0 min-w-0 truncate whitespace-nowrap text-[1rem] font-medium">{position}</p>
          {prefs.timer && (
            <button
              ref={(el) => {
                toolButtons.current.timer = el;
                setTimerButton(el);
              }}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={panel === "timer"}
              aria-label={t(startedAt === null ? "presentation.presenter.elapsedPaused" : "presentation.presenter.elapsed", { time: elapsedLabel(elapsed) })}
              onClick={() => setPanel(panel === "timer" ? "none" : "timer")}
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-aw px-2 hover:bg-black/10"
              style={{ color: startedAt === null ? colours.muted : undefined }}
            >
              <span aria-hidden="true">{elapsedLabel(elapsed)}</span>
              {startedAt === null && <Pause className="size-3.5" aria-hidden="true" />}
            </button>
          )}
          {prefs.clock && layout !== "phone" && (
            <span className="shrink-0 whitespace-nowrap text-[0.9375rem]" style={{ color: colours.muted }}>
              <span className="sr-only">{t("presentation.presenter.clock", { time: clock })}</span>
              <span aria-hidden="true">{clock}</span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end">
          <div className="flex shrink-0 items-center gap-1">
            {layout === "phone" ? (
              <ToolButton buttonRef={(el) => (toolButtons.current.menu = el)} label={t("presentation.presenter.menu")} icon={<Menu className="size-5" aria-hidden="true" />} pressed={panel === "menu"} haspopup onClick={() => setPanel(panel === "menu" ? "none" : "menu")} compact />
            ) : (
              <>
                <ToolButton buttonRef={(el) => (toolButtons.current.scripture = el)} label={t("presentation.presenter.scripture")} icon={<BookOpen className="size-5" aria-hidden="true" />} pressed={panel === "scripture"} haspopup onClick={() => setPanel(panel === "scripture" ? "none" : "scripture")} compact={layout !== "desktop"} />
                <ToolButton buttonRef={(el) => (toolButtons.current.audience = el)} label={t("presentation.presenter.audience")} icon={<MonitorUp className="size-5" aria-hidden="true" />} pressed={panel === "audience"} haspopup onClick={() => setPanel(panel === "audience" ? "none" : "audience")} compact={layout !== "desktop"} />
                <ToolButton buttonRef={(el) => (toolButtons.current.settings = el)} label={t("presentation.presenter.settings")} icon={<Settings2 className="size-5" aria-hidden="true" />} pressed={panel === "settings"} haspopup onClick={() => setPanel(panel === "settings" ? "none" : "settings")} compact={layout !== "desktop"} />
              </>
            )}
            <ToolButton buttonRef={(el) => (exitButton.current = el)} label={t("presentation.presenter.exit")} icon={<X className="size-5" aria-hidden="true" />} onClick={close} compact={layout !== "desktop"} />
          </div>
        </div>
      </header>

      <p role="status" className="sr-only">{notice}</p>

      {panel !== "none" && (
        <FloatingPanel
          key={panel}
          initialFocus={panel === "audience" ? "close" : "first"}
          anchor={panel === "timer" ? timerButton : null}
          title={
            panel === "scripture"
              ? t("presentation.presenter.scripture")
              : panel === "audience"
                ? t("presentation.presenter.audience")
                : panel === "settings"
                  ? t("presentation.presenter.settings")
                  : panel === "timer"
                    ? t("presentation.presenter.timer")
                    : t("presentation.presenter.menu")
          }
          placement={layout === "phone" ? "bottom" : panel === "timer" ? "popover" : "side"}
          wide={panel === "scripture"}
          colours={colours}
          onClose={() => {
            const open = panel;
            setPanel("none");
            returnTo(open);
          }}
        >
          {panel === "scripture" && <ScripturePanel doc={doc} shown={overlay} onShow={setOverlay} colours={colours} />}
          {panel === "settings" && <SettingsPanel prefs={prefs} setPrefs={setPrefs} awake={awake} />}
          {panel === "timer" && (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-[1.5rem] font-semibold tabular-nums">{elapsedLabel(elapsed)}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (startedAt === null) setStartedAt(Date.now());
                    else {
                      setBefore(elapsed);
                      setStartedAt(null);
                    }
                  }}
                  className="inline-flex min-h-11 items-center gap-2 rounded-aw border px-3"
                >
                  {startedAt === null ? <Play className="size-4" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}
                  {startedAt === null ? t("presentation.presenter.timerResume") : t("presentation.presenter.timerPause")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBefore(0);
                    setStartedAt(Date.now());
                  }}
                  className="inline-flex min-h-11 items-center gap-2 rounded-aw border px-3"
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  {t("presentation.presenter.timerReset")}
                </button>
              </div>
            </div>
          )}
          {panel === "menu" && (
            <div className="flex flex-col gap-1">
              {(
                [
                  ["scripture", t("presentation.presenter.scripture"), <BookOpen key="s" className="size-5" aria-hidden="true" />],
                  ["audience", t("presentation.presenter.audience"), <MonitorUp key="a" className="size-5" aria-hidden="true" />],
                  ["settings", t("presentation.presenter.settings"), <Settings2 key="v" className="size-5" aria-hidden="true" />],
                ] as const
              ).map(([name, label, icon]) => (
                <button key={name} type="button" onClick={() => setPanel(name)} className="inline-flex min-h-12 items-center gap-3 rounded-aw px-3 text-left text-[1rem] hover:bg-black/10">
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          )}
          {panel === "audience" && (
            <AudiencePanel
              doc={doc}
              mode={audience}
              blank={blank}
              onBlank={() => setBlank((b) => !b)}
              state={shown}
              onWindow={() => {
                setAudience("window");
                setPanel("none");
                returnTo("audience");
              }}
              onHere={() => {
                setAudience("here");
                setPanel("none");
              }}
              onCloseWindow={() => {
                void api.presentationAudienceClose().catch(() => undefined);
                setAudience("none");
                requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-presenter-panel] [data-panel-close]")?.focus());
              }}
            />
          )}
        </FloatingPanel>
      )}

      {layout === "phone" && (
        <>
          <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {speakerText(slide, true)}
            {next && (
              <p className="m-0 mt-6 border-t pt-3 text-[0.9375rem]" style={{ borderColor: `${colours.muted}55`, color: colours.muted }}>
                {t("presentation.presenter.upNext", { title: slideName(next) })}
              </p>
            )}
          </main>
          <div className="border-t px-3 py-3" style={{ borderColor: `${colours.muted}55` }}>{nav}</div>
        </>
      )}

      {layout === "tablet" && (
        <>
          <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 overflow-hidden p-4">
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
              {preview(slide, currentLabel)}
              {next && (
                <div className="flex flex-col gap-1">
                  <p className="m-0 text-[0.9375rem]" style={{ color: colours.muted }}>{t("presentation.presenter.nextSlide")}</p>
                  <div className="w-2/3">{preview(next, t("presentation.presenter.nextLabel", { title: slideName(next) }))}</div>
                </div>
              )}
            </div>
            <div className="min-h-0 overflow-y-auto pr-1">{speakerText(slide, false)}</div>
          </main>
          <div className="border-t px-4 py-3" style={{ borderColor: `${colours.muted}55` }}>{nav}</div>
        </>
      )}

      {layout === "desktop" && (
        <main className="grid min-h-0 flex-1 grid-cols-[14rem_minmax(0,3fr)_minmax(0,2fr)] gap-4 overflow-hidden p-4">
          <ol aria-label={t("presentation.presenter.allSlides")} className="m-0 flex min-h-0 list-none flex-col gap-1 overflow-y-auto p-0">
            {doc.slides.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={s.index === index ? "step" : undefined}
                  onClick={() => go(s.index)}
                  className="flex min-h-11 w-full items-start gap-2 rounded-aw px-2 py-1 text-left text-[0.9375rem]"
                  style={s.index === index ? { backgroundColor: `${colours.accent}33`, fontWeight: 600 } : undefined}
                >
                  <span className="tabular-nums" style={{ color: colours.muted }}>{s.index + 1}</span>
                  <span className="min-w-0 flex-1 break-words">{slideName(s)}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            {preview(slide, currentLabel)}
            {nav}
            {next && (
              <div className="flex items-start gap-3">
                <div className="w-1/3 shrink-0">{preview(next, t("presentation.presenter.nextLabel", { title: slideName(next) }))}</div>
                <p className="m-0 text-[0.9375rem]" style={{ color: colours.muted }}>{t("presentation.presenter.upNext", { title: slideName(next) })}</p>
              </div>
            )}
          </div>
          <div className="min-h-0 overflow-y-auto pr-1">{speakerText(slide, false)}</div>
        </main>
      )}
    </div>
  );
}

function ToolButton({
  label,
  icon,
  onClick,
  pressed,
  compact,
  buttonRef,
  haspopup = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  compact: boolean;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  /** Opens a floating panel (announced as expanded while it is open). */
  haspopup?: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-haspopup={haspopup ? "dialog" : undefined}
      aria-expanded={haspopup ? Boolean(pressed) : undefined}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-aw px-2 text-[0.9375rem] hover:bg-black/10 aria-expanded:bg-black/15"
    >
      {icon}
      {!compact && <span>{label}</span>}
    </button>
  );
}

/**
 * A floating panel over the Presenter View: a side sheet on a computer or
 * tablet, a small popover for the timer, a bottom sheet on a phone. It never
 * takes room from the speaker's material. Focus goes into it and stays there
 * (Tab), Escape or Close shuts it and the keyboard returns to its button.
 */
function FloatingPanel({
  title,
  placement,
  wide = false,
  initialFocus = "first",
  anchor = null,
  colours,
  onClose,
  children,
}: {
  title: string;
  placement: "side" | "popover" | "bottom";
  wide?: boolean;
  /** Where the keyboard starts: the first control, or Close (when the first control would act at once). */
  initialFocus?: "first" | "close";
  /** A popover opens under the button it belongs to. */
  anchor?: HTMLElement | null;
  colours: { background: string; text: string; muted: string };
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;
    const first = initialFocus === "first" ? panel.querySelector<HTMLElement>("[data-panel-body] input, [data-panel-body] button:not([disabled]), [data-panel-body] select") : null;
    (first ?? panel.querySelector<HTMLElement>("[data-panel-close]"))?.focus();
    // Only when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [left] = useState<number | null>(() => {
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(288, window.innerWidth - 24);
    return Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  });
  const position = {
    side: `right-3 top-16 max-h-[calc(100%-5rem)] ${wide ? "w-[min(30rem,calc(100%-1.5rem))]" : "w-[min(22.5rem,calc(100%-1.5rem))]"} rounded-aw`,
    popover: `top-16 w-[min(18rem,calc(100%-1.5rem))] rounded-aw ${left === null ? "left-1/2 -translate-x-1/2" : ""}`,
    bottom: "inset-x-0 bottom-0 max-h-[85%] rounded-t-2xl",
  }[placement];
  return (
    <>
      {/* A click beside the panel closes it; the presentation stays exactly where it is. */}
      <div aria-hidden="true" data-panel-backdrop="" className={`absolute inset-x-0 bottom-0 z-20 ${placement === "bottom" ? "top-0 bg-black/30" : "top-14"}`} onMouseDown={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-presenter-panel=""
        className={`absolute z-30 flex flex-col overflow-hidden border shadow-2xl ${position}`}
        style={{ backgroundColor: colours.background, color: colours.text, borderColor: `${colours.muted}66`, ...(left !== null ? { left } : {}) }}
      >
        <div className="flex shrink-0 items-center gap-2 border-b py-1 pl-4 pr-1" style={{ borderColor: `${colours.muted}44` }}>
          <h3 id={titleId} className="m-0 flex-1 text-[1rem] font-semibold">{title}</h3>
          <button type="button" data-panel-close="" onClick={onClose} aria-label={t("common.close")} title={t("common.close")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-aw hover:bg-black/10">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div data-panel-body="" className="min-h-0 overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </>
  );
}

/** What the audience sees, as text for the speaker (on a phone, where no slide picture fits). */
function AudienceText({ slide, colours, scale }: { slide: Slide; colours: { muted: string; accent: string }; scale: number }) {
  const { t } = useTranslation();
  const a = slide.audience;
  return (
    <section aria-label={t("presentation.presenter.onScreen")} className="flex flex-col gap-2 border-l-4 pl-3" style={{ borderColor: colours.accent }}>
      {a.blank && <p className="m-0 font-semibold" style={{ color: colours.muted }}>{t("presentation.kinds.pause")}</p>}
      {a.heading && <p className="m-0 font-semibold leading-snug" style={{ fontSize: `${1.5 * scale}rem` }}>{a.heading}</p>}
      {a.reference && (
        <p className="m-0 font-semibold" style={{ color: colours.accent }}>
          {a.bible ? t("presentation.slide.referenceWithBible", { reference: refLabel(a.reference), bible: a.bible }) : refLabel(a.reference)}
        </p>
      )}
      {a.verses.length > 0 && (
        <p className="m-0 leading-relaxed">
          {a.verses.map((v) => (
            <span key={`${v.chapter}.${v.verse}`}>
              <sup>{v.verse}</sup> {v.text}{" "}
            </span>
          ))}
        </p>
      )}
      {a.body && <p className="m-0 whitespace-pre-wrap leading-relaxed">{a.body}</p>}
      {a.image && <p className="m-0" style={{ color: colours.muted }}>{t("presentation.presenter.imageOnScreen", { caption: a.image.caption ?? t("presentation.kinds.image") })}</p>}
    </section>
  );
}

function SettingsPanel({ prefs, setPrefs, awake }: { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; awake: WakeState }) {
  const { t } = useTranslation();
  const id = useId();
  const at = SCALES.findIndex((s) => s >= prefs.scale);
  const step = (delta: number) => setPrefs({ scale: SCALES[Math.max(0, Math.min(SCALES.length - 1, (at < 0 ? 1 : at) + delta))]! });
  return (
    <div className="flex flex-col gap-2 text-[0.9375rem]">
      <div role="group" aria-labelledby={`${id}-size`} className="flex flex-wrap items-center gap-2">
        <span id={`${id}-size`}>{t("presentation.presenter.textSize")}</span>
        <button type="button" onClick={() => step(-1)} disabled={at === 0} aria-label={t("presentation.presenter.smaller")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-aw border disabled:opacity-50">
          <Minus className="size-4" aria-hidden="true" />
        </button>
        <span className="tabular-nums">{t("presentation.presenter.percent", { value: Math.round(prefs.scale * 100) })}</span>
        <button type="button" onClick={() => step(1)} disabled={at === SCALES.length - 1} aria-label={t("presentation.presenter.larger")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-aw border disabled:opacity-50">
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>
      <fieldset className="m-0 flex flex-wrap items-center gap-3 border-0 p-0">
        <legend className="mb-1 p-0">{t("presentation.presenter.background")}</legend>
        {PRESENTATION_THEMES.map((theme) => (
          <label key={theme} className="inline-flex min-h-11 items-center gap-2">
            <input type="radio" name={`${id}-theme`} checked={prefs.theme === theme} onChange={() => setPrefs({ theme })} className="size-5" />
            {themeLabel(t, theme)}
          </label>
        ))}
      </fieldset>
      <label className="inline-flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={prefs.timer} onChange={(e) => setPrefs({ timer: e.target.checked })} className="size-5" />
        {t("presentation.presenter.showTimer")}
      </label>
      <label className="inline-flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={prefs.clock} onChange={(e) => setPrefs({ clock: e.target.checked })} className="size-5" />
        {t("presentation.presenter.showClock")}
      </label>
      <label className="inline-flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={prefs.awake && awake !== "unsupported"} disabled={awake === "unsupported"} onChange={(e) => setPrefs({ awake: e.target.checked })} className="size-5" />
        {t("presentation.presenter.keepAwake")}
      </label>
      {(awake === "unsupported" || awake === "failed") && <p className="m-0 max-w-prose">{t("presentation.presenter.keepAwakeUnavailable")}</p>}
      {awake === "on" && <p className="m-0">{t("presentation.presenter.keepAwakeOn")}</p>}
      <KeysHelp />
    </div>
  );
}

/** The keys, only when asked for: a presenter who knows them should not have to look at them. */
function KeysHelp() {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="inline-flex min-h-11 items-center gap-2 self-start rounded-aw px-2 hover:bg-black/10">
        <CircleHelp className="size-4" aria-hidden="true" />
        {t("presentation.presenter.keysToggle")}
      </button>
      {open && (
        <p id={id} className="m-0 max-w-prose opacity-80">
          {t("presentation.presenter.keys")}
        </p>
      )}
    </div>
  );
}

type WakeState = "off" | "on" | "unsupported" | "failed";

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

/** Keeps the screen on while presenting, where the system allows it. */
function useWakeLock(wanted: boolean): WakeState {
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator;
  const [state, setState] = useState<WakeState>("off");
  useEffect(() => {
    if (!wanted || !supported) return;
    let lock: WakeLockSentinelLike | null = null;
    let active = true;
    const request = () => {
      const wake = (navigator as Navigator & { wakeLock: { request(type: "screen"): Promise<WakeLockSentinelLike> } }).wakeLock;
      wake.request("screen").then(
        (sentinel) => {
          if (!active) {
            void sentinel.release();
            return;
          }
          lock = sentinel;
          setState("on");
          // The system can let go of the lock (a hidden window, low battery): say so.
          sentinel.addEventListener("release", () => active && setState("off"));
        },
        () => active && setState("failed"),
      );
    };
    request();
    // The system lets go of the lock when the window is hidden; ask again on return.
    const onVisible = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [wanted, supported]);
  if (!supported) return "unsupported";
  return wanted ? state : "off";
}

function AudiencePanel({
  doc,
  mode,
  blank,
  onBlank,
  state,
  onWindow,
  onHere,
  onCloseWindow,
}: {
  doc: PresentationDocument;
  mode: AudienceMode;
  blank: boolean;
  onBlank: () => void;
  state: AudienceState;
  onWindow: () => void;
  onHere: () => void;
  onCloseWindow: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const [screens, setScreens] = useState<Screen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api.presentationScreens().then(
      (list) => active && setScreens(list),
      () => active && setScreens([]),
    );
    return () => {
      active = false;
    };
  }, [api]);
  const open = async (screen: number | null) => {
    setError(null);
    try {
      await api.presentationAudienceOpen({ presentationId: doc.presentationId, screen, title: t("presentation.audience.windowTitle", { title: doc.title }), state });
      onWindow();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };
  const others = (screens ?? []).filter((s) => !s.primary);
  return (
    <div className="flex flex-col gap-3 text-[0.9375rem]">
      {mode === "window" ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onBlank} aria-pressed={blank} className="inline-flex min-h-11 items-center gap-1 rounded-aw border px-3">
            <Pause className="size-4" aria-hidden="true" />
            {t("presentation.presenter.blank")}
          </button>
          <button type="button" onClick={onCloseWindow} className="min-h-11 rounded-aw border px-3">
            {t("presentation.presenter.closeAudience")}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {screens === null && <span>{t("presentation.presenter.lookingForScreens")}</span>}
          {others.map((s) => (
            <button key={s.index} type="button" onClick={() => void open(s.index)} className="min-h-11 rounded-aw border px-3 font-medium">
              {t("presentation.presenter.onScreenNamed", { number: s.index + 1, width: s.width, height: s.height })}
            </button>
          ))}
          {screens !== null && screens.length > 0 && (
            <button type="button" onClick={() => void open(null)} className="min-h-11 rounded-aw border px-3">
              {t("presentation.presenter.inNewWindow")}
            </button>
          )}
          <button type="button" onClick={onHere} className="min-h-11 rounded-aw border px-3">
            {t("presentation.presenter.inThisWindow")}
          </button>
        </div>
      )}
      {screens !== null && screens.length === 0 && <p className="m-0 max-w-prose">{t("presentation.presenter.noSecondWindow")}</p>}
      {screens !== null && screens.length === 1 && mode !== "window" && <p className="m-0 max-w-prose">{t("presentation.presenter.oneScreen")}</p>}
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
      <p className="m-0 max-w-prose text-[0.875rem] opacity-80">{t("presentation.presenter.audienceHelp")}</p>
    </div>
  );
}

/** A passage looked up without losing the place; shown to the audience only on request. */
function ScripturePanel({
  doc,
  shown,
  onShow,
  colours,
}: {
  doc: PresentationDocument;
  shown: ScriptureOverlay | null;
  onShow: (overlay: ScriptureOverlay | null) => void;
  colours: { muted: string; accent: string };
}) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const [text, setText] = useState("");
  const [found, setFound] = useState<ScriptureOverlay | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A long passage goes to the audience a slide's worth at a time, as on the Scripture slides.
  const parts = useMemo(() => (found ? splitVerses(found.verses) : []), [found]);
  const labelFor = (i: number) => (found && parts.length > 1 ? t("presentation.presenter.partOf", { reference: found.label, part: i + 1, parts: parts.length }) : (found?.label ?? ""));
  const at = found && shown ? parts.findIndex((_, i) => shown.label === labelFor(i)) : -1;
  const shownPart = at < 0 ? null : at;
  const showPart = (i: number) => found && onShow({ label: labelFor(i), bible: found.bible, verses: parts[i] ?? [] });
  const passages = useMemo(() => {
    const seen = new Map<string, string>();
    if (doc.primaryPassage) seen.set(doc.primaryPassage.canonical, refLabel(doc.primaryPassage));
    for (const s of doc.slides) if (s.kind === "scripture" && s.audience.reference && s.part === 1) seen.set(s.audience.reference.canonical, refLabel(s.audience.reference));
    return [...seen.entries()];
  }, [doc]);
  const look = async (canonical: string | null) => {
    setError(null);
    try {
      if (!doc.bible) {
        setError(t("presentation.presenter.noBible"));
        return;
      }
      const ref = canonical ?? (await api.referenceParse(text)).canonical;
      const passage = await api.scriptureGetPassage({ translationId: doc.bible.id, reference: ref });
      const info = passage.reference;
      setFound({ label: refLabel(info), bible: doc.bible.shortName, verses: passage.verses.map((v) => ({ chapter: v.chapter, verse: v.verse, text: v.text })) });
    } catch (e) {
      setError(toApiError(e).message);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (text.trim()) void look(null);
        }}
      >
        <label htmlFor={`${id}-ref`} className="text-[0.9375rem]">{t("presentation.presenter.passage")}</label>
        <input
          id={`${id}-ref`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("presentation.presenter.passageHint")}
          className="h-11 min-w-0 flex-1 basis-40 rounded-aw border border-border bg-bg px-3 text-text"
        />
        <button type="submit" className="min-h-11 rounded-aw border px-3 font-medium">{t("presentation.presenter.lookUp")}</button>
      </form>
      {passages.length > 0 && (
        <div role="group" aria-label={t("presentation.presenter.passagesHere")} className="flex flex-wrap gap-2">
          {passages.map(([canonical, label]) => (
            <button key={canonical} type="button" onClick={() => void look(canonical)} className="min-h-11 rounded-full border px-3 text-[0.9375rem]">
              {label}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
      {found && (
        <section aria-label={found.label} className="flex flex-col gap-2">
          <p className="m-0 font-semibold" style={{ color: colours.accent }}>
            {found.bible ? t("presentation.slide.referenceWithBible", { reference: found.label, bible: found.bible }) : found.label}
          </p>
          <p className="m-0 max-w-prose text-[1.125rem] leading-relaxed">
            {found.verses.map((v) => (
              <span key={`${v.chapter}.${v.verse}`}>
                <sup style={{ color: colours.muted }}>{v.verse}</sup> {v.text}{" "}
              </span>
            ))}
          </p>
          <div className="flex flex-wrap gap-2">
            {shownPart === null ? (
              <button type="button" onClick={() => showPart(0)} disabled={found.verses.length === 0} className="min-h-11 rounded-aw border px-3 font-medium disabled:opacity-50">
                {t("presentation.presenter.showToAudience")}
              </button>
            ) : (
              <>
                {shownPart < parts.length - 1 && (
                  <button type="button" onClick={() => showPart(shownPart + 1)} className="min-h-11 rounded-aw border px-3 font-medium">
                    {t("presentation.presenter.showNextPart")}
                  </button>
                )}
                <button type="button" onClick={() => onShow(null)} className="min-h-11 rounded-aw border px-3 font-medium">
                  {t("presentation.presenter.stopShowing")}
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** One window: the audience slide fills this window (for a mirrored or shared screen). */
function HereAudience({
  doc,
  slide,
  image,
  blank,
  overlay,
  label,
  onBack,
  onNext,
  onPrevious,
}: {
  doc: PresentationDocument;
  slide: Slide;
  image: string | null;
  blank: boolean;
  overlay: ScriptureOverlay | null;
  label: string;
  onBack: () => void;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const { t } = useTranslation();
  const screenRef = useRef<HTMLDivElement>(null);
  // The keyboard goes to the screen itself: the controls stay out of the audience's sight until wanted.
  useEffect(() => {
    screenRef.current?.focus();
  }, []);
  return (
    <div
      ref={screenRef}
      tabIndex={-1}
      data-presenter-root=""
      role="dialog"
      aria-modal="true"
      aria-label={t("presentation.audience.title")}
      className="group fixed inset-0 z-50 flex items-center justify-center outline-none"
      style={{ backgroundColor: palette(doc.theme).background }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onNext();
      }}
    >
      <div className="w-full max-w-[177.78vh]">
        <SlideView slide={slide.audience} kind={slide.kind} theme={doc.theme} image={image} overlay={overlay} blank={blank} label={label} />
      </div>
      {/* Hardly visible until the pointer or keyboard is on it, so the audience is not distracted. */}
      <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 hover:opacity-90">
        <button type="button" onClick={onPrevious} aria-label={t("presentation.presenter.previous")} className="min-h-11 min-w-11 rounded-aw bg-black/60 px-2 text-white">
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <button type="button" onClick={onNext} aria-label={t("presentation.presenter.next")} className="min-h-11 min-w-11 rounded-aw bg-black/60 px-2 text-white">
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
        <button type="button" onClick={onBack} className="min-h-11 rounded-aw bg-black/60 px-3 text-white">
          {t("presentation.presenter.backToPresenter")}
        </button>
      </div>
    </div>
  );
}
