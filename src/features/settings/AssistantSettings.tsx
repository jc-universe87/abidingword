import { useCallback, useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/design-system/Button";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { isLocalAddress } from "@/lib/localAddress";
import { PROVIDER_KINDS, SEARCH_KINDS, type AssistantConfig, type AssistantSettings as Settings, type ProviderKind } from "@/types/teaching";

/** A sensible model to start with; the person can type any other. */
const SUGGESTED_MODEL: Record<ProviderKind, string> = {
  openai: "gpt-4.1",
  anthropic: "claude-sonnet-5-5",
  google: "gemini-2.5-flash",
  ollama: "llama3.1",
  lmstudio: "",
  openai_compatible: "",
};
const URL_START = "https://";
const NEEDS_KEY = new Set<ProviderKind>(["openai", "anthropic", "google"]);
const LOCAL = new Set<ProviderKind>(["ollama", "lmstudio"]);

/**
 * Settings → Assistant. Off until turned on. Which service, model and key;
 * a search service for checking real stories; images; and, optionally, the
 * person's own description of their theological tradition. Keys go to the
 * computer's credential store and are never shown again.
 */
export function AssistantSettings() {
  const { t } = useTranslation();
  const api = useApi();
  const loaded = useLoad(useCallback(() => api.assistantSettingsGet(), [api]));
  if (loaded.error) return <p role="alert" className="m-0 text-danger">{loaded.error.message}</p>;
  if (!loaded.data) return <p className="m-0 text-text-muted">{t("common.loading")}</p>;
  return <Form initial={loaded.data} />;
}

function Form({ initial }: { initial: Settings }) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const [settings, setSettings] = useState(initial);
  const [config, setConfig] = useState<AssistantConfig>(initial.config);
  const [key, setKey] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof AssistantConfig>(name: K, value: AssistantConfig[K]) => setConfig((c) => ({ ...c, [name]: value }));
  const run = async (action: () => Promise<Settings | void>, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await action();
      if (next) {
        setSettings(next);
        setConfig(next.config);
      }
      setMessage({ tone: "ok", text: ok });
    } catch (e) {
      setMessage({ tone: "error", text: toApiError(e).message });
    } finally {
      setBusy(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.assistantSettingsSet(config), t("settings.assistant.saved"));
  };

  const provider = config.provider;
  // As the core decides it: the address given, else the service's usual one.
  const remote = config.baseUrl ? !isLocalAddress(config.baseUrl) : !LOCAL.has(provider);
  // The key status is the saved service's: for a service not saved yet there is none to show.
  const keyShown = settings.hasKey && settings.config.provider === provider;
  const field = "h-11 w-full max-w-md rounded-aw border border-border bg-bg px-3 text-[0.9375rem] placeholder:text-text-muted";
  const labelText = "text-[0.9375rem] font-semibold text-text-strong";
  const hint = "m-0 text-[0.875rem] text-text-muted";

  return (
    <form onSubmit={save} className="flex flex-col gap-5" noValidate>
      <p className="m-0 max-w-prose text-text">{t("settings.assistant.intro")}</p>

      <label className="flex items-center gap-3">
        <input type="checkbox" checked={config.enabled} onChange={(e) => set("enabled", e.target.checked)} className="size-5" />
        <span className={labelText}>{t("settings.assistant.enabled")}</span>
      </label>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-provider`} className={labelText}>
          {t("settings.assistant.provider")}
        </label>
        <select
          id={`${id}-provider`}
          value={provider}
          onChange={(e) => {
            const next = e.target.value as ProviderKind;
            setConfig((c) => ({ ...c, provider: next, baseUrl: "", model: c.model && c.provider === next ? c.model : SUGGESTED_MODEL[next] }));
          }}
          className={field}
        >
          {PROVIDER_KINDS.map((p) => (
            <option key={p} value={p}>
              {t(`settings.assistant.providers.${p}`)}
            </option>
          ))}
        </select>
        <p className={hint}>{remote ? t("settings.assistant.remote") : t("settings.assistant.local")}</p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-model`} className={labelText}>
          {t("settings.assistant.model")}
        </label>
        <input id={`${id}-model`} value={config.model} onChange={(e) => set("model", e.target.value)} placeholder={SUGGESTED_MODEL[provider] || t("settings.assistant.modelPlaceholder")} className={field} />
        <p className={hint}>{t("settings.assistant.modelHint")}</p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-address`} className={labelText}>
          {t("settings.assistant.address")}
        </label>
        <input id={`${id}-address`} value={config.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder={t("settings.assistant.addressPlaceholder")} className={field} />
        <p className={hint}>{t("settings.assistant.addressHint")}</p>
      </div>

      {(NEEDS_KEY.has(provider) || provider === "openai_compatible") && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-key`} className={labelText}>
            {t("settings.assistant.key")}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={`${id}-key`}
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={keyShown ? t("settings.assistant.keyKeptPlaceholder") : ""}
              className={field}
            />
            <Button
              className="min-h-11"
              disabled={busy || !key.trim()}
              onClick={() =>
                void run(async () => {
                  await api.assistantSettingsSet(config);
                  const next = await api.assistantKeySet("provider", key);
                  setKey("");
                  return next;
                }, t("settings.assistant.keySaved"))
              }
            >
              {t("settings.assistant.keySave")}
            </Button>
            {keyShown && (
              <Button className="min-h-11" disabled={busy} onClick={() => void run(() => api.assistantKeySet("provider", ""), t("settings.assistant.keyRemoved"))}>
                {t("settings.assistant.keyRemove")}
              </Button>
            )}
          </div>
          <p className={hint}>{keyShown ? t("settings.assistant.keyKept") : t("settings.assistant.keyHint")}</p>
        </div>
      )}

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className={`${labelText} mb-1`}>{t("settings.assistant.search")}</legend>
        <p className={hint}>{t("settings.assistant.searchHint")}</p>
        <select aria-label={t("settings.assistant.search")} value={config.search} onChange={(e) => set("search", e.target.value as AssistantConfig["search"])} className={field}>
          {SEARCH_KINDS.map((s) => (
            <option key={s} value={s}>
              {t(`settings.assistant.searchKinds.${s}`)}
            </option>
          ))}
        </select>
        {config.search === "searxng" && (
          <label className="flex flex-col gap-1">
            <span className="text-[0.9375rem] text-text-strong">{t("settings.assistant.searchAddress")}</span>
            <input value={config.searchUrl} onChange={(e) => set("searchUrl", e.target.value)} placeholder={URL_START} className={field} />
          </label>
        )}
        {config.search === "brave" && (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-skey`} className="sr-only">
              {t("settings.assistant.searchKey")}
            </label>
            <input
              id={`${id}-skey`}
              type="password"
              autoComplete="off"
              value={searchKey}
              onChange={(e) => setSearchKey(e.target.value)}
              placeholder={settings.hasSearchKey ? t("settings.assistant.keyKeptPlaceholder") : t("settings.assistant.searchKey")}
              className={field}
            />
            <Button
              className="min-h-11"
              disabled={busy || !searchKey.trim()}
              onClick={() =>
                void run(async () => {
                  await api.assistantSettingsSet(config);
                  const next = await api.assistantKeySet("search", searchKey);
                  setSearchKey("");
                  return next;
                }, t("settings.assistant.keySaved"))
              }
            >
              {t("settings.assistant.keySave")}
            </Button>
          </div>
        )}
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className={`${labelText} mb-1`}>{t("settings.assistant.images")}</legend>
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={config.findImages} onChange={(e) => set("findImages", e.target.checked)} className="size-5" />
          <span>{t("settings.assistant.findImages")}</span>
        </label>
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={config.generateImages} onChange={(e) => set("generateImages", e.target.checked)} className="size-5" />
          <span>{t("settings.assistant.generateImages")}</span>
        </label>
        {config.generateImages && provider !== "openai" && provider !== "openai_compatible" && <p className={hint}>{t("settings.assistant.generateOnlyOpenai")}</p>}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-perspective`} className={labelText}>
          {t("settings.assistant.perspective")}
        </label>
        <p id={`${id}-perspective-hint`} className={hint}>
          {t("settings.assistant.perspectiveHint")}
        </p>
        <textarea
          id={`${id}-perspective`}
          aria-describedby={`${id}-perspective-hint`}
          rows={3}
          value={config.perspective}
          onChange={(e) => set("perspective", e.target.value)}
          className="w-full max-w-xl rounded-aw border border-border bg-bg px-3 py-2 text-[0.9375rem]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" className="min-h-11" disabled={busy}>
          {t("settings.assistant.save")}
        </Button>
        <Button
          className="min-h-11"
          disabled={busy || !config.enabled}
          onClick={() =>
            void run(async () => {
              const next = await api.assistantSettingsSet(config);
              await api.assistantTest();
              return next;
            }, t("settings.assistant.testOk"))
          }
        >
          {t("settings.assistant.test")}
        </Button>
      </div>
      <p aria-live="polite" role={message?.tone === "error" ? "alert" : undefined} className={`m-0 ${message?.tone === "error" ? "text-danger" : "text-text-strong"}`}>
        {message?.text ?? ""}
      </p>
    </form>
  );
}
