// The interface languages and how the active one is chosen
// (docs/i18n.md). The choice is a device preference kept in the webview's
// local storage, like the workspace layout: it never goes into the study
// database, so changing the data folder or resetting the layout keeps it.
import { readLocal, writeLocal } from "@/lib/storage";

/** Supported languages, each named in its own language (no flags). */
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
  { code: "ko", name: "한국어" },
  { code: "fr", name: "Français" },
  { code: "es", name: "Español" },
  { code: "pt", name: "Português" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

export const FALLBACK_LANGUAGE: Language = "en";

/** Local-storage key (stored as `abiding-word.ui.language`). */
export const LANGUAGE_KEY = "ui.language";

const CODES: readonly string[] = LANGUAGES.map((l) => l.code);

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && CODES.includes(value);
}

/**
 * The supported language for a BCP-47 tag, or null: "pt-BR" and "pt-PT"
 * are "pt", "en-GB" is "en", "zh-CN" is not supported.
 */
export function normaliseLanguage(tag: string | null | undefined): Language | null {
  const primary = tag?.trim().toLowerCase().split(/[-_]/)[0];
  return isLanguage(primary) ? primary : null;
}

/** The first supported language among the system's preferences, else English. */
export function detectLanguage(preferences: readonly string[]): Language {
  for (const tag of preferences) {
    const language = normaliseLanguage(tag);
    if (language) return language;
  }
  return FALLBACK_LANGUAGE;
}

function systemPreferences(): string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? [...navigator.languages] : [navigator.language];
}

/** The saved choice if valid, otherwise the system language, otherwise English. */
export function initialLanguage(): Language {
  const saved = readLocal<unknown>(LANGUAGE_KEY, null);
  return isLanguage(saved) ? saved : detectLanguage(systemPreferences());
}

export function saveLanguage(language: Language): void {
  writeLocal(LANGUAGE_KEY, language);
}
