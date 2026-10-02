// Interface translation (docs/i18n.md). Components use
//   const { t } = useTranslation();  t("common.save")
// and code outside React uses `i18n.t`. English is the fallback for any
// missing text; the language is chosen in Settings and kept on this device.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { FALLBACK_LANGUAGE, LANGUAGES, initialLanguage, isLanguage, saveLanguage, type Language } from "./languages";
import { resources } from "./resources";

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: LANGUAGES.map((l) => l.code),
  load: "languageOnly",
  // React already escapes text; double escaping would show "&amp;".
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  initAsync: false,
  react: { useSuspense: false },
});

function applyDocumentLanguage(language: string) {
  if (typeof document !== "undefined") document.documentElement.lang = language;
}
applyDocumentLanguage(i18n.language);
i18n.on("languageChanged", applyDocumentLanguage);

/** The active interface language. */
export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : FALLBACK_LANGUAGE;
}

/** Switches the interface language at once and remembers it on this device. */
export async function setLanguage(language: Language): Promise<void> {
  saveLanguage(language);
  await i18n.changeLanguage(language);
}

export { LANGUAGES, type Language } from "./languages";
export default i18n;
