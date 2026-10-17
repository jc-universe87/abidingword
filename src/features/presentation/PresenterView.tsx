import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, ChevronLeft, ChevronRight, Minus, MonitorUp, Pause, Plus, Settings2, X } from "lucide-react";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { readLocal, writeLocal } from "@/lib/storage";
import { PRESENTATION_THEMES, type AudienceState, type PresentationDocument, type PresentationTheme, type ScriptureOverlay, type Screen, type Slide } from "@/types/presentation";
import { palette, refLabel, slideText, themeLabel } from "./labels";
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
  const [panel, setPanel] = useState<"none" | "scripture" | "settings" | "audience">("none");
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

  useEffect(() => {
    nextButton.current?.focus();
  }, []);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (audience === "here") setAudience("none");
        else if (panel !== "none") setPanel("none");
        else close();
        return;
      }
      if (panel !== "none" && audience !== "here") return;
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        go(index + 1);
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        go(index - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        go(0);
      } else if (e.key === "End") {
        e.preventDefault();
        go(total - 1);
      } else if (e.key === "b" || e.key === "B" || e.key === ".") {
        e.preventDefault();
        setBlank((b) => !b);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [audience, close, go, index, panel, total]);

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
        onBack={() => setAudience("none")}
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
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{ backgroundColor: colours.background, color: colours.text }}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2" style={{ borderColor: `${colours.muted}55` }}>
        <h2 id={titleId} className="m-0 min-w-0 flex-1 truncate text-[1rem] font-semibold">
          {layout === "phone" ? doc.title : t("presentation.presenter.titleWith", { title: doc.title })}
        </h2>
        <p aria-live="polite" className="m-0 text-[1rem] font-medium tabular-nums">{position}</p>
        {prefs.timer && (
          <span className="inline-flex items-center gap-1 tabular-nums" aria-label={t("presentation.presenter.elapsed", { time: elapsedLabel(elapsed) })}>
            <span aria-hidden="true">{elapsedLabel(elapsed)}</span>
            <button
              type="button"
              onClick={() => {
                if (startedAt === null) setStartedAt(Date.now());
                else {
                  setBefore(elapsed);
                  setStartedAt(null);
                }
              }}
              className="min-h-11 rounded-aw px-2 text-[0.875rem] underline-offset-2 hover:underline"
            >
              {startedAt === null ? t("presentation.presenter.timerResume") : t("presentation.presenter.timerPause")}
            </button>
            <button
              type="button"
              onClick={() => {
                setBefore(0);
                setStartedAt(Date.now());
              }}
              className="min-h-11 rounded-aw px-2 text-[0.875rem] underline-offset-2 hover:underline"
            >
              {t("presentation.presenter.timerReset")}
            </button>
          </span>
        )}
        {prefs.clock && (
          <span className="tabular-nums" aria-label={t("presentation.presenter.clock", { time: clock })}>
            <span aria-hidden="true">{clock}</span>
          </span>
        )}
        <div className="flex items-center gap-1">
          <ToolButton label={t("presentation.presenter.scripture")} icon={<BookOpen className="size-5" aria-hidden="true" />} pressed={panel === "scripture"} onClick={() => setPanel(panel === "scripture" ? "none" : "scripture")} compact={layout === "phone"} />
          <ToolButton label={t("presentation.presenter.audience")} icon={<MonitorUp className="size-5" aria-hidden="true" />} pressed={panel === "audience"} onClick={() => setPanel(panel === "audience" ? "none" : "audience")} compact={layout === "phone"} />
          <ToolButton label={t("presentation.presenter.settings")} icon={<Settings2 className="size-5" aria-hidden="true" />} pressed={panel === "settings"} onClick={() => setPanel(panel === "settings" ? "none" : "settings")} compact={layout === "phone"} />
          <ToolButton label={t("presentation.presenter.exit")} icon={<X className="size-5" aria-hidden="true" />} onClick={close} compact={layout === "phone"} />
        </div>
      </header>

      {(blank || overlay || audience === "window") && (
        <p className="m-0 flex flex-wrap items-center gap-2 px-3 py-1 text-[0.9375rem]" style={{ backgroundColor: `${colours.accent}22` }}>
          {audience === "window" && <span>{t("presentation.presenter.audienceOn")}</span>}
          {blank && <span>{t("presentation.presenter.blankOn")}</span>}
          {overlay && <span>{t("presentation.presenter.showingScripture", { reference: overlay.label })}</span>}
          {(blank || overlay) && (
            <button
              type="button"
              onClick={() => {
                setBlank(false);
                setOverlay(null);
              }}
              className="min-h-11 rounded-aw px-2 font-medium underline"
            >
              {t("presentation.presenter.backToSlide")}
            </button>
          )}
        </p>
      )}
      <p role="status" className="sr-only">{notice}</p>

      {panel !== "none" && (
        <div className="max-h-[60vh] overflow-y-auto border-b px-3 py-3" style={{ borderColor: `${colours.muted}55` }}>
          {panel === "scripture" && <ScripturePanel doc={doc} shown={overlay} onShow={setOverlay} onClose={() => setPanel("none")} colours={colours} />}
          {panel === "settings" && <SettingsPanel prefs={prefs} setPrefs={setPrefs} awake={awake} />}
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
              }}
              onHere={() => {
                setAudience("here");
                setPanel("none");
              }}
              onCloseWindow={() => {
                void api.presentationAudienceClose().catch(() => undefined);
                setAudience("none");
              }}
            />
          )}
        </div>
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

function ToolButton({ label, icon, onClick, pressed, compact }: { label: string; icon: ReactNode; onClick: () => void; pressed?: boolean; compact: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-aw px-2 text-[0.9375rem] hover:bg-black/10 aria-pressed:bg-black/15"
    >
      {icon}
      {!compact && <span>{label}</span>}
    </button>
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
    <div className="flex flex-col gap-3 text-[0.9375rem]">
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
      <p className="m-0 max-w-prose opacity-80">{t("presentation.presenter.keys")}</p>
    </div>
  );
}

type WakeState = "off" | "on" | "unsupported" | "failed";

interface WakeLockSentinelLike {
  release(): Promise<void>;
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
      <p className="m-0 max-w-prose">{t("presentation.presenter.audienceHelp")}</p>
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
    </div>
  );
}

/** A passage looked up without losing the place; shown to the audience only on request. */
function ScripturePanel({
  doc,
  shown,
  onShow,
  onClose,
  colours,
}: {
  doc: PresentationDocument;
  shown: ScriptureOverlay | null;
  onShow: (overlay: ScriptureOverlay | null) => void;
  onClose: () => void;
  colours: { muted: string; accent: string };
}) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const [text, setText] = useState("");
  const [found, setFound] = useState<ScriptureOverlay | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("presentation.presenter.passageHint")}
          className="h-11 min-w-0 flex-1 basis-40 rounded-aw border border-border bg-bg px-3 text-text"
        />
        <button type="submit" className="min-h-11 rounded-aw border px-3 font-medium">{t("presentation.presenter.lookUp")}</button>
        <button type="button" onClick={onClose} className="min-h-11 rounded-aw px-3">{t("common.close")}</button>
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
            {shown?.label === found.label ? (
              <button type="button" onClick={() => onShow(null)} className="min-h-11 rounded-aw border px-3 font-medium">
                {t("presentation.presenter.stopShowing")}
              </button>
            ) : (
              <button type="button" onClick={() => onShow(found)} disabled={found.verses.length === 0} className="min-h-11 rounded-aw border px-3 font-medium disabled:opacity-50">
                {t("presentation.presenter.showToAudience")}
              </button>
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
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    back.current?.focus();
  }, []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("presentation.audience.title")}
      className="group fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: palette(doc.theme).background }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onNext();
      }}
    >
      <div className="w-full max-w-[177.78vh]">
        <SlideView slide={slide.audience} kind={slide.kind} theme={doc.theme} image={image} overlay={overlay} blank={blank} label={label} />
      </div>
      {/* Hardly visible until the pointer or keyboard is on it, so the audience is not distracted. */}
      <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-90">
        <button type="button" onClick={onPrevious} aria-label={t("presentation.presenter.previous")} className="min-h-11 min-w-11 rounded-aw bg-black/60 px-2 text-white">
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <button type="button" onClick={onNext} aria-label={t("presentation.presenter.next")} className="min-h-11 min-w-11 rounded-aw bg-black/60 px-2 text-white">
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
        <button ref={back} type="button" onClick={onBack} className="min-h-11 rounded-aw bg-black/60 px-3 text-white">
          {t("presentation.presenter.backToPresenter")}
        </button>
      </div>
    </div>
  );
}
