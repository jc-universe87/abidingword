import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/design-system/Button";
import { toApiError } from "@/lib/api";
import { readLocal, writeLocal } from "@/lib/storage";
import { LANGUAGES, currentLanguage } from "@/i18n";
import type { AppInfo, Theme } from "@/types/domain";
import type { AssistantSettings as AssistantStatus } from "@/types/teaching";
import { AssistantSettings } from "./AssistantSettings";
import { BibleTexts } from "./BibleTexts";
import { StudyTemplates } from "./StudyTemplates";
import { UpdateSettings } from "@/features/updates/UpdateSettings";
import { useUpdates, type UpdateState } from "@/features/updates/UpdatesContext";
import { LanguageChoice } from "./LanguageChoice";
import { useTheme } from "./ThemeContext";

const THEMES = ["light", "dark", "system"] as const satisfies readonly Theme[];

const PLANNED = ["sync", "integrations"] as const;

/** The sections, in the order they appear. Ids are stable across languages. */
export const SETTINGS_SECTIONS = [
  "updates",
  "appearance",
  "bible-texts",
  "study-templates",
  "language",
  "assistant",
  "about-this-installation",
  "coming-in-later-versions",
] as const;
type SectionName = (typeof SETTINGS_SECTIONS)[number];

const TITLE_KEY = {
  updates: "settings.sections.updates",
  appearance: "settings.sections.appearance",
  "bible-texts": "settings.sections.bibleTexts",
  "study-templates": "settings.sections.templates",
  language: "settings.sections.language",
  assistant: "settings.sections.assistant",
  "about-this-installation": "settings.sections.about",
  "coming-in-later-versions": "settings.sections.planned",
} as const satisfies Record<SectionName, string>;

/** Open sections are remembered on this computer, so a visit to a template comes back to the same place. */
const OPEN_KEY = "settings.openSections";

/** An update that needs the person: Updates opens by itself for it. */
const needsAttention = (state: UpdateState) => state.kind === "available" || state.kind === "installing" || state.kind === "failed";

interface SettingsViewProps {
  info: AppInfo;
  onClose: () => void;
  /** Restores the default workspace layout (order, widths, visibility). */
  onResetLayout: () => void;
  onAddBible: () => void;
  onEditTemplate: (templateId: string | null) => void;
}

/**
 * Settings: a short list of sections, each a single line with its title and
 * where things stand, opened only when wanted. The header with "Back" and a
 * jump list stays at the top while the page scrolls.
 */
export function SettingsView({ info, onClose, onResetLayout, onAddBible, onEditTemplate }: SettingsViewProps) {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const updates = useUpdates();
  const updateLine = useUpdateSummary();
  const heading = useRef<HTMLHeadingElement>(null);
  const toggles = useRef(new Map<SectionName, HTMLButtonElement>());
  useEffect(() => heading.current?.focus(), []);

  const [open, setOpen] = useState<ReadonlySet<SectionName>>(
    () => new Set(readLocal<string[]>(OPEN_KEY, []).filter((n): n is SectionName => (SETTINGS_SECTIONS as readonly string[]).includes(n))),
  );
  // Closed by the person while an update needed them: stays closed for that state only.
  const [updatesClosedFor, setUpdatesClosedFor] = useState<string | null>(null);
  const updateKey = updates.state.kind === "available" || updates.state.kind === "installing" ? `${updates.state.kind}:${updates.state.update.version}` : updates.state.kind;
  const [assistant, setAssistant] = useState<AssistantStatus | null>(null);

  const isOpen = (name: SectionName) => open.has(name) || (name === "updates" && needsAttention(updates.state) && updatesClosedFor !== updateKey);
  const setSection = (name: SectionName, value: boolean) => {
    if (name === "updates") setUpdatesClosedFor(value ? null : updateKey);
    setOpen((current) => {
      const next = new Set(current);
      if (value) next.add(name);
      else next.delete(name);
      writeLocal(OPEN_KEY, [...next]);
      return next;
    });
  };

  /** From the jump list: open the section, bring it into view and move focus to it. */
  const jump = (name: SectionName) => {
    setSection(name, true);
    requestAnimationFrame(() => {
      const toggle = toggles.current.get(name);
      toggle?.closest("section")?.scrollIntoView?.({ block: "start" });
      toggle?.focus({ preventScroll: true });
    });
  };

  const summary = (name: SectionName): string => {
    switch (name) {
      case "updates":
        return updateLine;
      case "appearance":
        return t(`settings.theme.${theme}`);
      case "bible-texts":
        return t("settings.summary.bibleTexts");
      case "study-templates":
        return t("settings.summary.templates");
      case "language":
        return LANGUAGES.find((l) => l.code === (i18n.language ? currentLanguage() : "en"))?.name ?? "";
      case "assistant":
        if (!assistant) return "";
        return assistant.config.enabled
          ? t("settings.summary.assistantOn", { service: t(`settings.assistant.providers.${assistant.config.provider}`) })
          : t("settings.summary.assistantOff");
      case "about-this-installation":
        return t("settings.summary.about", { version: info.version });
      case "coming-in-later-versions":
        return PLANNED.map((item) => t(`settings.planned.${item}`)).join(" · ");
    }
  };

  const body = (name: SectionName): ReactNode => {
    switch (name) {
      case "updates":
        return <UpdateSettings />;
      case "appearance":
        return (
          <>
            <ThemeChoice />
            <LayoutReset onReset={onResetLayout} />
          </>
        );
      case "bible-texts":
        return <BibleTexts onAddBible={onAddBible} />;
      case "study-templates":
        return <StudyTemplates onEdit={onEditTemplate} />;
      case "language":
        return <LanguageChoice />;
      case "assistant":
        return <AssistantSettings onStatus={setAssistant} />;
      case "about-this-installation":
        return <About info={info} />;
      case "coming-in-later-versions":
        return (
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {PLANNED.map((item) => (
              <li key={item} className="border-l-[3px] border-border pl-4">
                <p className="m-0 font-semibold text-text-strong">{t(`settings.planned.${item}`)}</p>
                <p className="m-0 mt-1 text-[0.9375rem] text-text-muted">{t(`settings.planned.${item}Text`)}</p>
              </li>
            ))}
          </ul>
        );
    }
  };

  return (
    <main
      aria-labelledby="settings-title"
      className="min-h-0 flex-1 overflow-y-auto bg-bg"
      onKeyDown={(e) => {
        // Escape goes back, but not from a field: there it would throw away what is being typed.
        const target = e.target as HTMLElement;
        if (e.key !== "Escape" || e.defaultPrevented || target.closest("input, textarea, select, details")) return;
        onClose();
      }}
    >
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-bg">
        <div className="mx-auto flex max-w-[46rem] flex-col gap-2 px-4 pb-2 pt-3 sm:px-8">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Button variant="quiet" onClick={onClose}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("settings.backToWorkspace")}
            </Button>
            <h1
              id="settings-title"
              ref={heading}
              tabIndex={-1}
              className="m-0 font-display text-[1.5rem] font-heading text-text-strong"
            >
              {t("settings.title")}
            </h1>
          </div>
          <nav aria-label={t("settings.jumpTo")}>
            <ul className="m-0 flex list-none flex-wrap gap-x-1 p-0 pb-1">
              {SETTINGS_SECTIONS.map((name) => (
                <li key={name} className="shrink-0">
                  <a
                    href={`#settings-section-${name}`}
                    onClick={(e) => {
                      e.preventDefault();
                      jump(name);
                    }}
                    className="inline-flex min-h-9 items-center rounded-aw px-2.5 text-[0.875rem] text-text-muted no-underline hover:bg-bg-secondary hover:text-text-strong"
                  >
                    {t(TITLE_KEY[name])}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex max-w-[46rem] flex-col px-4 pb-24 pt-2 sm:px-8">
        {SETTINGS_SECTIONS.map((name) => (
          <Section
            key={name}
            name={name}
            title={t(TITLE_KEY[name])}
            summary={summary(name)}
            open={isOpen(name)}
            onToggle={(value) => setSection(name, value)}
            toggleRef={(el) => {
              if (el) toggles.current.set(name, el);
              else toggles.current.delete(name);
            }}
          >
            {body(name)}
          </Section>
        ))}
      </div>
    </main>
  );
}

/** Updates in one line: where things stand, so the section needs opening only when something is to be done. */
function useUpdateSummary(): string {
  const { t } = useTranslation();
  const { enabled, version, state } = useUpdates();
  if (!enabled) return t("settings.summary.updatesOff");
  switch (state.kind) {
    case "checking":
      return t("app.updates.checking");
    case "upToDate":
      return t("settings.summary.upToDate");
    case "available":
      return t("settings.summary.updateAvailable", { version: state.update.version });
    case "installing":
      return t("settings.summary.updateInstalling");
    case "failed":
      return t("settings.summary.updateFailed");
    default:
      return t("settings.summary.version", { version });
  }
}

interface SectionProps {
  name: SectionName;
  title: string;
  summary: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  toggleRef: (el: HTMLButtonElement | null) => void;
  children: ReactNode;
}

/**
 * One section: its heading is a button that shows or hides it (independently
 * of the others), with a short line saying where things stand. The contents
 * stay mounted while hidden, so nothing typed is lost.
 */
function Section({ name, title, summary, open, onToggle, toggleRef, children }: SectionProps) {
  const id = `settings-${name}`;
  const summaryId = `${id}-summary`;
  return (
    <section id={`settings-section-${name}`} aria-labelledby={id} className="scroll-mt-32 border-b border-border-subtle">
      <h2 aria-labelledby={id} className="m-0">
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          aria-labelledby={id}
          aria-describedby={summary ? summaryId : undefined}
          onClick={() => onToggle(!open)}
          className="flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-aw py-3 text-left hover:bg-bg-secondary"
        >
          <ChevronRight className={`size-5 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
          <span id={id} className="font-display text-[1.25rem] font-heading text-text-strong">
            {title}
          </span>
          {summary && (
            <span id={summaryId} className="ml-auto min-w-0 text-[0.9375rem] text-text-muted">
              {summary}
            </span>
          )}
        </button>
      </h2>
      <div id={`${id}-body`} hidden={!open} className="pb-8 pl-8 pt-2">
        {children}
      </div>
    </section>
  );
}

function About({ info }: { info: AppInfo }) {
  const { t } = useTranslation();
  return (
    <>
      <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
        <Item term={t("settings.about.version")}>{t("settings.about.versionValue", { version: info.version })}</Item>
        <Item term={t("settings.about.dataFolder")}>
          <Path value={info.dataDirectory} />
        </Item>
        <Item term={t("settings.about.database")}>
          <Path value={info.databasePath} />
        </Item>
        <Item term={t("settings.about.logFiles")}>
          <Path value={info.logDirectory} />
        </Item>
        <Item term={t("settings.about.schema")}>
          {info.schemaVersion === null
            ? t("common.unknown")
            : t("settings.about.schemaVersion", { version: info.schemaVersion })}
        </Item>
      </dl>
      <p className="mt-4 mb-0 text-[0.9375rem] text-text-muted">{t("settings.about.backup")}</p>
    </>
  );
}
function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-medium text-text-strong">{term}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </>
  );
}

function Path({ value }: { value: string | null }) {
  const { t } = useTranslation();
  if (!value) return <span className="text-text-muted">{t("common.notAvailable")}</span>;
  return <code className="break-all font-mono text-[0.9375rem]">{value}</code>;
}

function LayoutReset({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  return (
    <div className="mt-6 flex flex-col items-start gap-2">
      <p className="m-0 font-medium text-text-strong">{t("settings.layout.title")}</p>
      <p className="m-0 text-[0.9375rem] text-text-muted">{t("settings.layout.description")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            onReset();
            setDone(true);
          }}
        >
          {t("settings.layout.reset")}
        </Button>
        <p role="status" className="m-0 text-[0.9375rem] text-text-muted">
          {done ? t("settings.layout.done") : ""}
        </p>
      </div>
    </div>
  );
}

function ThemeChoice() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [error, setError] = useState<string | null>(null);

  const choose = async (next: Theme) => {
    setError(null);
    try {
      await setTheme(next);
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-3 font-medium text-text-strong">{t("settings.theme.legend")}</legend>
      <div className="flex flex-col gap-3">
        {THEMES.map((option) => (
          <label key={option} className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="theme"
              value={option}
              checked={theme === option}
              onChange={() => choose(option)}
              className="mt-1 size-4 accent-[var(--aw-primary)]"
            />
            <span>
              <span className="block">{t(`settings.theme.${option}`)}</span>
              <span className="block text-[0.9375rem] text-text-muted">{t(`settings.theme.${option}Hint`)}</span>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="m-0 mt-3 text-[0.9375rem] text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
