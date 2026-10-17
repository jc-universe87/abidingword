import { useTranslation } from "react-i18next";
import { HelpTip } from "@/design-system/HelpTip";
import { LANGUAGES, currentLanguage, setLanguage, type Language } from "@/i18n";

/**
 * Settings → Language. Each language is named in its own language (no
 * flags: flags stand for countries). The change applies at once and is
 * remembered on this device only.
 */
export function LanguageChoice() {
  const { t, i18n } = useTranslation();
  const active = i18n.language ? currentLanguage() : "en";
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="inline-flex items-center gap-1">
        <label htmlFor="settings-ui-language" className="font-medium text-text-strong">
          {t("settings.language.label")}
        </label>
        <HelpTip name={t("settings.help.about", { topic: t("settings.language.label") })}>{t("settings.language.hint")}</HelpTip>
      </span>
      <select
        id="settings-ui-language"
        value={active}
        onChange={(e) => void setLanguage(e.target.value as Language)}
        className="h-10 min-w-56 rounded-aw border border-border bg-bg px-3 text-[1rem] text-text-strong"
      >
        {LANGUAGES.map((language) => (
          <option key={language.code} value={language.code} lang={language.code}>
            {language.name}
          </option>
        ))}
      </select>
    </div>
  );
}
