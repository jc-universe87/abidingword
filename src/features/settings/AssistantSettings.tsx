import { useCallback, useEffect, useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { Button } from "@/design-system/Button";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { isLocalAddress } from "@/lib/localAddress";
import { SEARCH_KINDS, type AssistantConfig, type AssistantSettings as Settings, type ProviderKind } from "@/types/teaching";

interface Service {
  /** The company or program, as it names itself (used in the help texts). */
  name: string;
  /** A sensible model to start with; the person can type any other. */
  model: string;
  /** The official page where a key is made (services on the internet). */
  keyPage?: string;
  /** The official download page (programs on this computer). */
  download?: string;
}

/** What the setup needs to know about each service. No service is preferred. */
const SERVICES: Record<ProviderKind, Service> = {
  openai: { name: "OpenAI", model: "gpt-4.1", keyPage: "https://platform.openai.com/api-keys" },
  anthropic: { name: "Anthropic", model: "claude-sonnet-5-5", keyPage: "https://console.anthropic.com/settings/keys" },
  google: { name: "Google", model: "gemini-2.5-flash", keyPage: "https://aistudio.google.com/apikey" },
  xai: { name: "xAI", model: "grok-4", keyPage: "https://console.x.ai" },
  perplexity: { name: "Perplexity", model: "sonar-pro", keyPage: "https://www.perplexity.ai/settings/api" },
  deepseek: { name: "DeepSeek", model: "deepseek-chat", keyPage: "https://platform.deepseek.com/api_keys" },
  qwen: { name: "Alibaba Cloud", model: "qwen-plus", keyPage: "https://www.alibabacloud.com/help/en/model-studio/get-api-key" },
  ollama: { name: "Ollama", model: "llama3.1", download: "https://ollama.com/download" },
  lmstudio: { name: "LM Studio", model: "", download: "https://lmstudio.ai" },
  openai_compatible: { name: "", model: "" },
};

/** The choices, grouped as a person thinks of them: on the internet, on this computer, anything else. */
const GROUPS = [
  { name: "internet", kinds: ["anthropic", "deepseek", "google", "openai", "perplexity", "qwen", "xai"] },
  { name: "local", kinds: ["ollama", "lmstudio"] },
  { name: "other", kinds: ["openai_compatible"] },
] as const satisfies readonly { name: string; kinds: readonly ProviderKind[] }[];

const PERSPECTIVE_EXAMPLES = ["reformed", "catholic", "lutheran", "pentecostal", "none", "views"] as const;

const URL_START = "https://";

/** The config with the service's suggested model when none is chosen yet. */
const withModel = (config: AssistantConfig): AssistantConfig => (config.model.trim() ? config : { ...config, model: SERVICES[config.provider].model });
const WEB_ADDRESS = /^https?:\/\/\S+$/i;

/** Why the connection cannot be checked yet, in the order the person meets the steps. */
export function connectionBlocker(config: AssistantConfig, hasKey: boolean): "noAddress" | "badAddress" | "noKey" | "noModel" | null {
  const address = config.baseUrl.trim();
  if (config.provider === "openai_compatible" && !address) return "noAddress";
  if (address && !WEB_ADDRESS.test(address)) return "badAddress";
  if (SERVICES[config.provider].keyPage && !hasKey) return "noKey";
  if (!config.model.trim()) return "noModel";
  return null;
}

/**
 * Settings → Assistant. Off until turned on; then, step by step: which
 * service, its key (with plain help on getting one), the model, and a check
 * that it answers. Technical details (the service's address) wait under
 * "Advanced". After that, optional extras: real stories, images and how to
 * treat theological questions. Keys go to the computer's credential store
 * and are never shown again.
 */
export function AssistantSettings({ onStatus }: { onStatus?: (settings: Settings) => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const loaded = useLoad(useCallback(() => api.assistantSettingsGet(), [api]));
  useEffect(() => {
    if (loaded.data) onStatus?.(loaded.data);
  }, [loaded.data, onStatus]);
  if (loaded.error) return <p role="alert" className="m-0 text-danger">{loaded.error.message}</p>;
  if (!loaded.data) return <p className="m-0 text-text-muted">{t("common.loading")}</p>;
  return <Form initial={loaded.data} onStatus={onStatus} />;
}

type Message = { tone: "ok" | "error"; text: string } | null;

function Form({ initial, onStatus }: { initial: Settings; onStatus?: (settings: Settings) => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const id = useId();
  const [settings, setSettings] = useState(initial);
  // A service without a model yet (as on first start) gets its suggested one, so the path needs no typing.
  const [config, setConfig] = useState<AssistantConfig>(() => withModel(initial.config));
  const [key, setKey] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [connection, setConnection] = useState<Message>(null);
  const [busy, setBusy] = useState<"save" | "check" | null>(null);

  const set = <K extends keyof AssistantConfig>(name: K, value: AssistantConfig[K]) => {
    setConfig((c) => ({ ...c, [name]: value }));
    setConnection(null);
  };
  const saved = (next: Settings) => {
    setSettings(next);
    setConfig(withModel(next.config));
    onStatus?.(next);
  };
  /** Runs a save; on failure `undo` puts the form back as it was saved, so it never shows a state that is not. */
  const run = async (action: () => Promise<Settings>, ok: string, undo?: () => void) => {
    setBusy("save");
    setMessage(null);
    try {
      saved(await action());
      setMessage(ok ? { tone: "ok", text: ok } : null);
    } catch (e) {
      undo?.();
      setMessage({ tone: "error", text: toApiError(e).message });
    } finally {
      setBusy(null);
    }
  };

  const keepKey = () => {
    if (busy || !key.trim()) return;
    void run(async () => {
      await api.assistantSettingsSet(config);
      const next = await api.assistantKeySet("provider", key);
      setKey("");
      setConnection(null);
      return next;
    }, t("settings.assistant.keySaved"));
  };
  const keepSearchKey = () => {
    if (busy || !searchKey.trim()) return;
    void run(async () => {
      await api.assistantSettingsSet(config);
      const next = await api.assistantKeySet("search", searchKey);
      setSearchKey("");
      return next;
    }, t("settings.assistant.keySaved"));
  };
  /** Enter in a key field keeps the key (it would otherwise save the form and leave the key behind). */
  const onEnter = (keep: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      keep();
    }
  };

  const provider = config.provider;
  const service = SERVICES[provider];
  const label = service.name || t(`settings.assistant.providers.${provider}`);
  // The key status is the saved service's: for a service not saved yet there is none to show.
  const keyShown = settings.hasKey && settings.config.provider === provider;
  const blocker = connectionBlocker(config, keyShown);
  // As the core decides it: the address given, else the service's usual one.
  const remote = config.baseUrl ? !isLocalAddress(config.baseUrl) : !service.download;

  const check = async () => {
    setBusy("check");
    setMessage(null);
    setConnection(null);
    try {
      saved(await api.assistantSettingsSet(config));
      await api.assistantTest();
      setConnection({ tone: "ok", text: t("settings.assistant.testOk") });
    } catch (e) {
      setConnection({ tone: "error", text: toApiError(e).message });
    } finally {
      setBusy(null);
    }
  };

  const field = "h-11 w-full max-w-md rounded-aw border border-border bg-bg px-3 text-[0.9375rem] placeholder:text-text-muted";
  const labelText = "text-[0.9375rem] font-semibold text-text-strong";
  const hint = "m-0 max-w-prose text-[0.875rem] text-text-muted";

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api.assistantSettingsSet(config), t("settings.assistant.saved"));
      }}
      className="flex flex-col gap-6"
      noValidate
    >
      <p className="m-0 max-w-prose text-text">{t("settings.assistant.intro")}</p>

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={config.enabled}
            disabled={busy !== null}
            onChange={(e) => {
              const enabled = e.target.checked;
              set("enabled", enabled);
              void run(
                () => api.assistantSettingsSet({ ...config, enabled }),
                enabled ? t("settings.assistant.turnedOn") : t("settings.assistant.turnedOff"),
                () => set("enabled", !enabled),
              );
            }}
            className="size-5"
          />
          <span className={labelText}>{t("settings.assistant.enabled")}</span>
        </label>
        {!config.enabled && <p className={`${hint} pl-8`}>{t("settings.assistant.offHint")}</p>}
      </div>

      {config.enabled && (
        <>
          <Step title={t("settings.assistant.provider")} htmlFor={`${id}-provider`}>
            <select
              id={`${id}-provider`}
              value={provider}
              onChange={(e) => {
                const next = e.target.value as ProviderKind;
                const changed = { ...config, provider: next, baseUrl: "", model: SERVICES[next].model };
                setConfig(changed);
                setConnection(null);
                setKey("");
                // Saved at once: keys are kept per service, so whether one is kept is known for the new choice.
                void run(() => api.assistantSettingsSet(changed), "", () => setConfig(withModel(settings.config)));
              }}
              className={field}
            >
              {GROUPS.map((group) => (
                <optgroup key={group.name} label={t(`settings.assistant.providerGroups.${group.name}`)}>
                  {group.kinds.map((p) => (
                    <option key={p} value={p}>
                      {t(`settings.assistant.providers.${p}`)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className={hint}>{remote ? t("settings.assistant.remote") : t("settings.assistant.local")}</p>
            {service.download && (
              <Help summary={t("settings.assistant.localHelp.title", { service: label })}>
                <p className="m-0">{t("settings.assistant.localHelp.what", { service: label })}</p>
                <p className="m-0">{t("settings.assistant.localHelp.steps", { service: label })}</p>
                <OfficialLink url={service.download} text={t("settings.assistant.localHelp.open", { service: label })} />
              </Help>
            )}
            {provider === "openai_compatible" && <p className={hint}>{t("settings.assistant.otherHelp")}</p>}
          </Step>

          {provider === "openai_compatible" && (
            <Step title={t("settings.assistant.address")} htmlFor={`${id}-address`}>
              <input id={`${id}-address`} value={config.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder={URL_START} className={field} />
            </Step>
          )}

          {(service.keyPage || provider === "openai_compatible") && (
            <Step title={service.keyPage ? t("settings.assistant.key") : t("settings.assistant.keyOptional")} htmlFor={`${id}-key`}>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={`${id}-key`}
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={onEnter(keepKey)}
                  placeholder={keyShown ? t("settings.assistant.keyKeptPlaceholder") : ""}
                  className={field}
                />
                <Button className="min-h-11" disabled={busy !== null || !key.trim()} onClick={keepKey}>
                  {t("settings.assistant.keySave")}
                </Button>
                {keyShown && (
                  <Button className="min-h-11" disabled={busy !== null} onClick={() => void run(() => api.assistantKeySet("provider", ""), t("settings.assistant.keyRemoved"))}>
                    {t("settings.assistant.keyRemove")}
                  </Button>
                )}
              </div>
              <p className={hint}>{keyShown ? t("settings.assistant.keyKept") : t("settings.assistant.keyHint")}</p>
              {service.keyPage && (
                <Help summary={t("settings.assistant.keyHelp.title")}>
                  <QA q={t("settings.assistant.keyHelp.whatQ")} a={t("settings.assistant.keyHelp.whatA", { service: label })} />
                  <QA q={t("settings.assistant.keyHelp.whyQ")} a={t("settings.assistant.keyHelp.whyA", { service: label })} />
                  <QA q={t("settings.assistant.keyHelp.whereQ")} a={t("settings.assistant.keyHelp.whereA", { service: label })}>
                    <OfficialLink url={service.keyPage} text={t("settings.assistant.keyHelp.open", { service: label })} />
                  </QA>
                  <QA q={t("settings.assistant.keyHelp.costQ")} a={t("settings.assistant.keyHelp.costA", { service: label })} />
                  <QA q={t("settings.assistant.keyHelp.pasteQ")} a={t("settings.assistant.keyHelp.pasteA")} />
                </Help>
              )}
            </Step>
          )}

          <Step title={t("settings.assistant.model")} htmlFor={`${id}-model`}>
            <input id={`${id}-model`} value={config.model} onChange={(e) => set("model", e.target.value)} placeholder={t("settings.assistant.modelPlaceholder")} className={field} />
            <p className={hint}>{service.model ? t("settings.assistant.modelHint") : t("settings.assistant.modelHintEmpty", { service: label })}</p>
          </Step>

          <div className="flex flex-col gap-2">
            <Button className="min-h-11 self-start" disabled={busy !== null || blocker !== null} aria-describedby={`${id}-connection`} onClick={() => void check()}>
              {t("settings.assistant.test")}
            </Button>
            <p
              id={`${id}-connection`}
              role="status"
              className={`m-0 text-[0.9375rem] ${connection?.tone === "error" ? "text-danger" : connection || busy === "check" ? "text-text-strong" : "text-text-muted"}`}
            >
              {busy === "check"
                ? t("settings.assistant.checking")
                : connection
                  ? connection.text
                  : blocker
                    ? t(`settings.assistant.why.${blocker}`)
                    : ""}
            </p>
          </div>

          {provider !== "openai_compatible" && (
            <Help summary={t("settings.assistant.advanced")}>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-address`} className={labelText}>
                  {t("settings.assistant.address")}
                </label>
                <input id={`${id}-address`} value={config.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder={t("settings.assistant.addressPlaceholder")} className={field} />
                <p className={hint}>{t("settings.assistant.addressHint")}</p>
              </div>
            </Help>
          )}

          <div className="flex flex-col gap-5 border-t border-border-subtle pt-5">
            <h3 className="m-0 text-[1rem] font-semibold text-text-strong">{t("settings.assistant.extras")}</h3>

            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className={`${labelText} mb-1`}>{t("settings.assistant.search")}</legend>
              <p id={`${id}-search-hint`} className={hint}>
                {t("settings.assistant.searchHint")}
              </p>
              <select
                aria-label={t("settings.assistant.search")}
                aria-describedby={`${id}-search-hint`}
                value={config.search}
                onChange={(e) => set("search", e.target.value as AssistantConfig["search"])}
                className={field}
              >
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
                    onKeyDown={onEnter(keepSearchKey)}
                    placeholder={settings.hasSearchKey ? t("settings.assistant.keyKeptPlaceholder") : t("settings.assistant.searchKey")}
                    className={field}
                  />
                  <Button className="min-h-11" disabled={busy !== null || !searchKey.trim()} onClick={keepSearchKey}>
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

            <div className="flex flex-col gap-2">
              <label htmlFor={`${id}-perspective`} className={labelText}>
                {t("settings.assistant.perspective")} <span className="font-normal text-text-muted">{t("settings.assistant.optional")}</span>
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
              <div role="group" aria-label={t("settings.assistant.perspectiveExamples")} className="flex flex-wrap items-center gap-2">
                <span className="text-[0.875rem] text-text-muted">{t("settings.assistant.perspectiveExamples")}</span>
                {PERSPECTIVE_EXAMPLES.map((example) => {
                  const text = t(`settings.assistant.perspectiveExample.${example}`);
                  return (
                    <button
                      key={example}
                      type="button"
                      onClick={() => set("perspective", config.perspective.trim() ? `${config.perspective.trim()} ${text}` : text)}
                      className="min-h-9 rounded-full border border-border-subtle px-3 text-[0.875rem] text-text hover:bg-bg-secondary"
                    >
                      {text}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" className="min-h-11" disabled={busy !== null}>
              {t("settings.assistant.save")}
            </Button>
          </div>
        </>
      )}
      <p aria-live="polite" role={message?.tone === "error" ? "alert" : undefined} className={`m-0 ${message?.tone === "error" ? "text-danger" : "text-text-strong"}`}>
        {message?.text ?? ""}
      </p>
    </form>
  );
}

function Step({ title, htmlFor, children }: { title: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[0.9375rem] font-semibold text-text-strong">
        {title}
      </label>
      {children}
    </div>
  );
}

/** Plain help that opens on request (a native disclosure: keyboard and screen readers know it). */
function Help({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="max-w-prose rounded-aw text-[0.9375rem]">
      <summary className="min-h-9 cursor-pointer py-1.5 text-text-strong underline-offset-2 hover:underline">{summary}</summary>
      <div className="mt-1 flex flex-col gap-3 border-l-[3px] border-border-subtle pl-4 text-text">{children}</div>
    </details>
  );
}

function QA({ q, a, children }: { q: string; a: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 font-semibold text-text-strong">{q}</p>
      <p className="m-0">{a}</p>
      {children}
    </div>
  );
}

/** Opens a service's own page in the browser; the address is shown so the person knows where it goes. */
function OfficialLink({ url, text }: { url: string; text: string }) {
  const api = useApi();
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Button variant="quiet" className="min-h-9 !px-0 underline underline-offset-2" onClick={() => void api.openExternalLink(url).catch(() => undefined)}>
        <ExternalLink className="size-4" aria-hidden="true" />
        {text}
      </Button>
      <code className="break-all text-[0.8125rem] text-text-muted">{url}</code>
    </span>
  );
}
