import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/design-system/Button";
import { toApiError } from "@/lib/api";
import type { AppInfo, Theme } from "@/types/domain";
import { BibleTexts } from "./BibleTexts";
import { StudyTemplates } from "./StudyTemplates";
import { UpdateSettings } from "@/features/updates/UpdateSettings";
import { LanguageChoice } from "./LanguageChoice";
import { useTheme } from "./ThemeContext";

const THEMES = ["light", "dark", "system"] as const satisfies readonly Theme[];

const PLANNED = ["ai", "sync", "integrations"] as const;

interface SettingsViewProps {
  info: AppInfo;
  onClose: () => void;
  /** Restores the default workspace layout (order, widths, visibility). */
  onResetLayout: () => void;
  onAddBible: () => void;
  onEditTemplate: (templateId: string | null) => void;
}

export function SettingsView({ info, onClose, onResetLayout, onAddBible, onEditTemplate }: SettingsViewProps) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <main aria-labelledby="settings-title" className="min-h-0 flex-1 overflow-y-auto bg-bg">
      <div
        className="mx-auto flex max-w-[46rem] flex-col gap-10 px-8 pb-24 pt-8"
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="flex flex-col items-start gap-4">
          <Button variant="quiet" onClick={onClose}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t("settings.backToWorkspace")}
          </Button>
          <h1
            id="settings-title"
            ref={heading}
            tabIndex={-1}
            className="m-0 font-display text-[1.875rem] font-heading text-text-strong"
          >
            {t("settings.title")}
          </h1>
        </div>

        <Section id="appearance" title={t("settings.sections.appearance")}>
          <ThemeChoice />
          <LayoutReset onReset={onResetLayout} />
        </Section>

        <Section id="language" title={t("settings.sections.language")}>
          <LanguageChoice />
        </Section>

        <Section id="bible-texts" title={t("settings.sections.bibleTexts")}>
          <BibleTexts onAddBible={onAddBible} />
        </Section>

        <Section id="study-templates" title={t("settings.sections.templates")}>
          <StudyTemplates onEdit={onEditTemplate} />
        </Section>

        <Section id="updates" title={t("app.updates.title")}>
          <UpdateSettings />
        </Section>

        <Section id="about-this-installation" title={t("settings.sections.about")}>
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
        </Section>

        <Section id="coming-in-later-versions" title={t("settings.sections.planned")}>
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {PLANNED.map((item) => (
              <li key={item} className="border-l-[3px] border-border pl-4">
                <p className="m-0 font-semibold text-text-strong">{t(`settings.planned.${item}`)}</p>
                <p className="m-0 mt-1 text-[0.9375rem] text-text-muted">{t(`settings.planned.${item}Text`)}</p>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}

/** `id` is stable across languages (the heading's text is not). */
function Section({ id: name, title, children }: { id: string; title: string; children: ReactNode }) {
  const id = `settings-${name}`;
  return (
    <section aria-labelledby={id} className="border-t border-border-subtle pt-6">
      <h2 id={id} className="m-0 mb-4 font-display text-[1.5rem] font-heading text-text-strong">
        {title}
      </h2>
      {children}
    </section>
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
