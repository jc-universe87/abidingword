import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/design-system/Button";
import { toApiError } from "@/lib/api";
import type { AppInfo, Theme } from "@/types/domain";
import { BibleTexts } from "./BibleTexts";
import { useTheme } from "./ThemeContext";

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Warm ivory, for daytime study." },
  { value: "dark", label: "Dark", hint: "Deep forest green, easier in low light." },
  { value: "system", label: "Match my computer", hint: "Follows your operating system setting." },
];

const PLANNED: { title: string; text: string }[] = [
  { title: "AI assistance", text: "Optional help with study. Abiding Word will always work fully without it." },
  { title: "Sync", text: "Keep your studies in step across your own devices, under your control." },
  { title: "Integrations", text: "Connect other tools you already use." },
];

export function SettingsView({ info, onClose, onAddBible }: { info: AppInfo; onClose: () => void; onAddBible: () => void }) {
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
            Back to workspace
          </Button>
          <h1
            id="settings-title"
            ref={heading}
            tabIndex={-1}
            className="m-0 font-display text-[1.875rem] font-semibold text-text-strong"
          >
            Settings
          </h1>
        </div>

        <Section title="Appearance">
          <ThemeChoice />
        </Section>

        <Section title="Bible Texts">
          <BibleTexts onAddBible={onAddBible} />
        </Section>

        <Section title="About this installation">
          <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
            <Item term="Version">Abiding Word {info.version} (Foundation)</Item>
            <Item term="Data folder">
              <Path value={info.dataDirectory} />
            </Item>
            <Item term="Database">
              <Path value={info.databasePath} />
            </Item>
            <Item term="Log files">
              <Path value={info.logDirectory} />
            </Item>
            <Item term="Database schema">{info.schemaVersion === null ? "Unknown" : `Version ${info.schemaVersion}`}</Item>
          </dl>
          <p className="mt-4 mb-0 text-[0.9375rem] text-text-muted">
            All your studies are stored in the data folder on this computer. To back them up, copy that whole folder
            while Abiding Word is closed.
          </p>
        </Section>

        <Section title="Coming in later versions">
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {PLANNED.map((item) => (
              <li key={item.title} className="border-l-[3px] border-border pl-4">
                <p className="m-0 font-semibold text-text-strong">{item.title}</p>
                <p className="m-0 mt-1 text-[0.9375rem] text-text-muted">{item.text}</p>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `settings-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="border-t border-border-subtle pt-6">
      <h2 id={id} className="m-0 mb-4 font-display text-[1.5rem] font-semibold text-text-strong">
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
  if (!value) return <span className="text-text-muted">Not available</span>;
  return <code className="break-all font-mono text-[0.9375rem]">{value}</code>;
}

function ThemeChoice() {
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
      <legend className="mb-3 font-medium text-text-strong">Theme</legend>
      <div className="flex flex-col gap-3">
        {THEMES.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={theme === option.value}
              onChange={() => choose(option.value)}
              className="mt-1 size-4 accent-[var(--aw-primary)]"
            />
            <span>
              <span className="block">{option.label}</span>
              <span className="block text-[0.9375rem] text-text-muted">{option.hint}</span>
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
