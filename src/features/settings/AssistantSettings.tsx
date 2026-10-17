import { useCallback, useEffect, useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { Button } from "@/design-system/Button";
import { HelpTip } from "@/design-system/HelpTip";
import { useLoad } from "@/hooks/useLoad";
import { toApiError } from "@/lib/api";
import { useApi } from "@/lib/ApiContext";
import { isLocalAddress } from "@/lib/localAddress";
import { IMAGE_SERVICES, type AssistantConfig, type AssistantSettings as Settings, type ImageCapability, type ImageService, type ProviderKind, type SearchKind } from "@/types/teaching";

interface Service {
  /** The company or program, as it names itself (used in the help texts). */
  name: string;
  /** A suggested model to start with; the person can type any other. */
  model: string;
  /** The official page where a key is made (services on the internet). */
  keyPage?: string;
  /** The service's own, current list of its models. Model names change often, so
   * Abiding Word links to the official list rather than keeping one itself. */
  modelsPage?: string;
  /** The official download page (programs on this computer). */
  download?: string;
}

/** What the setup needs to know about each service. No service is preferred. Official pages only. */
const SERVICES: Record<ProviderKind, Service> = {
  openai: { name: "OpenAI", model: "gpt-4.1", keyPage: "https://platform.openai.com/api-keys", modelsPage: "https://platform.openai.com/docs/models" },
  anthropic: { name: "Anthropic", model: "claude-sonnet-5-5", keyPage: "https://console.anthropic.com/settings/keys", modelsPage: "https://docs.anthropic.com/en/docs/about-claude/models" },
  google: { name: "Google", model: "gemini-2.5-flash", keyPage: "https://aistudio.google.com/apikey", modelsPage: "https://ai.google.dev/gemini-api/docs/models" },
  xai: { name: "xAI", model: "grok-4", keyPage: "https://console.x.ai", modelsPage: "https://docs.x.ai/docs/models" },
  perplexity: { name: "Perplexity", model: "sonar-pro", keyPage: "https://www.perplexity.ai/settings/api", modelsPage: "https://docs.perplexity.ai/getting-started/models" },
  deepseek: { name: "DeepSeek", model: "deepseek-chat", keyPage: "https://platform.deepseek.com/api_keys", modelsPage: "https://api-docs.deepseek.com/quick_start/pricing" },
  qwen: { name: "Alibaba Cloud", model: "qwen-plus", keyPage: "https://www.alibabacloud.com/help/en/model-studio/get-api-key", modelsPage: "https://www.alibabacloud.com/help/en/model-studio/models" },
  // Programs on this computer: their own lists of models to download, not a cloud catalogue.
  ollama: { name: "Ollama", model: "llama3.1", download: "https://ollama.com/download", modelsPage: "https://ollama.com/library" },
  lmstudio: { name: "LM Studio", model: "", download: "https://lmstudio.ai", modelsPage: "https://lmstudio.ai/models" },
  // Another compatible service: Abiding Word cannot know its models, so no link is invented.
  openai_compatible: { name: "", model: "" },
};

type SearchService = Exclude<SearchKind, "none">;

/** Each search service's own page for its keys (SearXNG: its documentation). Official pages only. */
const SEARCH_PAGES: Record<SearchService, string> = {
  brave: "https://brave.com/search/api/",
  tavily: "https://app.tavily.com",
  exa: "https://dashboard.exa.ai/api-keys",
  searxng: "https://docs.searxng.org",
  serpapi: "https://serpapi.com/manage-api-key",
};
const SEARCH_NEEDS_KEY = new Set<SearchKind>(["brave", "tavily", "exa", "serpapi"]);
/** The plain choices first; self-hosted and specialist ones apart. */
const SEARCH_GROUPS = [
  { name: "recommended", kinds: ["brave", "tavily", "exa"] },
  { name: "advanced", kinds: ["searxng", "serpapi"] },
] as const satisfies readonly { name: string; kinds: readonly SearchService[] }[];
const SEARCH_STEPS = [1, 2, 3, 4] as const;
const KEY_STEPS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** The choices, grouped as a person thinks of them: on the internet, on this computer, anything else. */
const GROUPS = [
  { name: "internet", kinds: ["anthropic", "deepseek", "google", "openai", "perplexity", "qwen", "xai"] },
  { name: "local", kinds: ["ollama", "lmstudio"] },
  { name: "other", kinds: ["openai_compatible"] },
] as const satisfies readonly { name: string; kinds: readonly ProviderKind[] }[];

const PERSPECTIVE_EXAMPLES = ["reformed", "lutheran", "catholic", "pentecostal", "none"] as const;

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
  const [searchCheck, setSearchCheck] = useState<Message>(null);
  const [busy, setBusy] = useState<"save" | "check" | "searchCheck" | null>(null);

  const set = <K extends keyof AssistantConfig>(name: K, value: AssistantConfig[K]) => {
    setConfig((c) => ({ ...c, [name]: value }));
    setConnection(null);
    if (name === "search" || name === "searchUrl") setSearchCheck(null);
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
  /**
   * Saves only the search part of the set-up (the service and its address),
   * so unsaved changes to the AI service stay in the form and an invalid one
   * cannot make the search save fail.
   */
  const saveSearch = (search: AssistantConfig["search"], searchUrl: string) =>
    api.assistantSettingsSet({ ...settings.config, search, searchUrl });
  /** After a search-only save: take the saved settings, keep the rest of the form as typed. */
  const savedSearch = (next: Settings) => {
    setSettings(next);
    setConfig((c) => ({ ...c, search: next.config.search, searchUrl: next.config.searchUrl }));
    onStatus?.(next);
  };
  const keepSearchKey = async () => {
    if (busy || !searchKey.trim()) return;
    setBusy("save");
    setMessage(null);
    try {
      savedSearch(await saveSearch(config.search, config.searchUrl));
      savedSearch(await api.assistantKeySet("search", searchKey));
      setSearchKey("");
      setSearchCheck(null);
      setMessage({ tone: "ok", text: t("settings.assistant.keySaved") });
    } catch (e) {
      setMessage({ tone: "error", text: toApiError(e).message });
    } finally {
      setBusy(null);
    }
  };
  const [imageKey, setImageKey] = useState("");
  const keepImageKey = () => {
    if (busy || !imageKey.trim()) return;
    void run(async () => {
      await api.assistantSettingsSet(config);
      const next = await api.assistantKeySet("image", imageKey);
      setImageKey("");
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

  const search = config.search;
  const searchName = search === "none" ? "" : t(`settings.assistant.searchKinds.${search}`);
  // As for the AI key: the status shown is the saved service's.
  const searchKeyShown = settings.hasSearchKey && settings.config.search === search;
  const searchBlocker = SEARCH_NEEDS_KEY.has(search) && !searchKeyShown ? "noKey" : search === "searxng" && !config.searchUrl.trim() ? "noAddress" : null;
  const checkSearch = async () => {
    setBusy("searchCheck");
    setMessage(null);
    setSearchCheck(null);
    try {
      savedSearch(await saveSearch(config.search, config.searchUrl));
      const found = await api.assistantSearchTest();
      setSearchCheck({ tone: "ok", text: found > 0 ? t("settings.assistant.searchTestOk") : t("settings.assistant.searchTestEmpty") });
    } catch (e) {
      setSearchCheck({ tone: "error", text: toApiError(e).message });
    } finally {
      setBusy(null);
    }
  };

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
  const about = (topic: string) => t("settings.help.about", { topic });
  const imageProvider: ProviderKind = config.imageService === "openai" ? "openai" : provider;
  // The capability shown is the core's for the saved set-up; for an unsaved choice it is worked out the same way.
  const imageCapability = config.imageService === settings.config.imageService && provider === settings.config.provider ? settings.imageCapability : capabilityOf(imageProvider);
  const needsImageKey = config.imageService === "openai" && provider !== "openai";

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api.assistantSettingsSet(config), t("settings.assistant.saved"));
      }}
      className="flex flex-col gap-5"
      noValidate
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
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
          <HelpTip name={about(t("settings.sections.assistant"))}>{t("settings.assistant.intro")}</HelpTip>
        </div>
      </div>

      {config.enabled && (
        <>
          <Step
            title={t("settings.assistant.provider")}
            htmlFor={`${id}-provider`}
            help={<HelpTip name={about(t("settings.assistant.provider"))}>{remote ? t("settings.assistant.remote") : t("settings.assistant.local")}</HelpTip>}
          >
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
            {service.download && (
              <Help summary={t("settings.assistant.localHelp.title", { service: label })}>
                <p className="m-0">{t("settings.assistant.localHelp.what", { service: label })}</p>
                <p className="m-0">{t("settings.assistant.localHelp.steps", { service: label })}</p>
                <OfficialLink url={service.download} text={t("settings.assistant.localHelp.open", { service: label })} />
              </Help>
            )}
          </Step>

          {provider === "openai_compatible" && (
            <Step title={t("settings.assistant.address")} htmlFor={`${id}-address`} help={<HelpTip name={about(t("settings.assistant.address"))}>{t("settings.assistant.otherHelp")}</HelpTip>}>
              <input id={`${id}-address`} value={config.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder={URL_START} className={field} />
            </Step>
          )}

          {(service.keyPage || provider === "openai_compatible") && (
            <Step
              title={service.keyPage ? t("settings.assistant.key") : t("settings.assistant.keyOptional")}
              htmlFor={`${id}-key`}
              help={<HelpTip name={about(t("settings.assistant.key"))}>{t("settings.assistant.keyHint")}</HelpTip>}
            >
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
              {service.keyPage && (
                <Help summary={t("settings.assistant.keyHelp.title")}>
                  <p className="m-0">{t("settings.assistant.keyHelp.whatA", { service: label })}</p>
                  <ol className="m-0 flex list-decimal flex-col gap-1 pl-5">
                    {KEY_STEPS.map((n) => (
                      <li key={n}>
                        {t(`settings.assistant.keyHelp.step${n}`, { service: label })}
                        {n === 1 && <OfficialLink url={service.keyPage!} text={t("settings.assistant.keyHelp.open", { service: label })} />}
                      </li>
                    ))}
                  </ol>
                  <p className="m-0 text-text-muted">{t("settings.assistant.keyHelp.costA", { service: label })}</p>
                </Help>
              )}
            </Step>
          )}

          <Step
            title={t("settings.assistant.model")}
            htmlFor={`${id}-model`}
            help={<HelpTip name={about(t("settings.assistant.model"))}>{service.model ? t("settings.assistant.modelHint") : t("settings.assistant.modelHintEmpty", { service: label })}</HelpTip>}
          >
            <div className="flex items-center gap-1">
              <input id={`${id}-model`} value={config.model} onChange={(e) => set("model", e.target.value)} placeholder={t("settings.assistant.modelPlaceholder")} className={field} />
              {service.modelsPage && (
                <button
                  type="button"
                  aria-label={t(service.download ? "settings.assistant.modelsLocal" : "settings.assistant.modelsLink", { service: label })}
                  title={t(service.download ? "settings.assistant.modelsLocal" : "settings.assistant.modelsLink", { service: label })}
                  onClick={() => void api.openExternalLink(service.modelsPage!).catch(() => undefined)}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-aw text-text-muted hover:bg-bg-secondary hover:text-text-strong"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>
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
              {busy === "check" ? t("settings.assistant.checking") : connection ? connection.text : blocker ? t(`settings.assistant.why.${blocker}`) : ""}
            </p>
          </div>

          {provider !== "openai_compatible" && (
            <Help summary={t("settings.assistant.advanced")}>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  <label htmlFor={`${id}-address`} className={labelText}>
                    {t("settings.assistant.address")}
                  </label>
                  <HelpTip name={about(t("settings.assistant.address"))}>{t("settings.assistant.addressHint")}</HelpTip>
                </div>
                <input id={`${id}-address`} value={config.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder={t("settings.assistant.addressPlaceholder")} className={field} />
              </div>
            </Help>
          )}

          <div className="flex flex-col gap-4 border-t border-border-subtle pt-4">
            <h3 className="m-0 text-[1rem] font-semibold text-text-strong">{t("settings.assistant.extras")}</h3>

            <div role="group" aria-labelledby={`${id}-search-label`} className="flex flex-col gap-2">
              <div className="mb-1 flex items-center gap-1">
                <span id={`${id}-search-label`} className={labelText}>
                  {t("settings.assistant.search")}
                </span>
                <HelpTip name={about(t("settings.assistant.search"))}>{t("settings.assistant.searchHint")}</HelpTip>
              </div>
              <select
                aria-label={t("settings.assistant.search")}
                value={search}
                onChange={(e) => {
                  // Kept enabled (arrow keys change a closed select at once); a change while saving waits.
                  if (busy) return;
                  const next = e.target.value as SearchKind;
                  const before = config.search;
                  set("search", next);
                  setSearchKey("");
                  // Saved at once, as the AI service is: keys are kept per search service.
                  setBusy("save");
                  setMessage(null);
                  saveSearch(next, config.searchUrl)
                    .then(savedSearch, (err: unknown) => {
                      set("search", before);
                      setMessage({ tone: "error", text: toApiError(err).message });
                    })
                    .finally(() => setBusy(null));
                }}
                className={field}
              >
                <option value="none">{t("settings.assistant.searchKinds.none")}</option>
                {SEARCH_GROUPS.map((group) => (
                  <optgroup key={group.name} label={group.name === "recommended" ? t("settings.assistant.searchRecommended") : t("settings.assistant.searchAdvanced")}>
                    {group.kinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {t("settings.assistant.searchOption", { name: t(`settings.assistant.searchKinds.${kind}`), short: t(`settings.assistant.searchShort.${kind}`) })}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {search !== "none" && (
                <>
                  <Help summary={t("settings.assistant.searchSetup.title", { service: searchName })}>
                      <p className="m-0">{t(`settings.assistant.searchWhat.${search}`)}</p>
                      {search !== "searxng" && (
                        <>
                          <ol className="m-0 flex list-decimal flex-col gap-1 pl-5">
                            {SEARCH_STEPS.map((n) => (
                              <li key={n}>
                                {t(`settings.assistant.searchSetup.step${n}`, { service: searchName })}
                                {n === 1 && <OfficialLink url={SEARCH_PAGES[search]} text={t("settings.assistant.searchSetup.open", { service: searchName })} />}
                              </li>
                            ))}
                          </ol>
                          <p className="m-0 text-text-muted">{t("settings.assistant.searchSetup.cost")}</p>
                        </>
                      )}
                      {search === "searxng" && <OfficialLink url={SEARCH_PAGES.searxng} text={t("settings.assistant.searchSetup.open", { service: searchName })} />}
                  </Help>
                  {SEARCH_NEEDS_KEY.has(search) && (
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
                        onKeyDown={onEnter(() => void keepSearchKey())}
                        placeholder={searchKeyShown ? t("settings.assistant.keyKeptPlaceholder") : t("settings.assistant.searchKey")}
                        className={field}
                      />
                      <Button className="min-h-11" disabled={busy !== null || !searchKey.trim()} onClick={() => void keepSearchKey()}>
                        {t("settings.assistant.keySave")}
                      </Button>
                      {searchKeyShown && (
                        <Button className="min-h-11" disabled={busy !== null} onClick={() => {
                            setBusy("save");
                            setSearchCheck(null);
                            api
                              .assistantKeySet("search", "")
                              .then((next) => {
                                savedSearch(next);
                                setMessage({ tone: "ok", text: t("settings.assistant.keyRemoved") });
                              }, (err: unknown) => setMessage({ tone: "error", text: toApiError(err).message }))
                              .finally(() => setBusy(null));
                          }}>
                          {t("settings.assistant.keyRemove")}
                        </Button>
                      )}
                    </div>
                  )}
                  {search === "searxng" && (
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.9375rem] text-text-strong">{t("settings.assistant.searchAddress")}</span>
                      <input value={config.searchUrl} onChange={(e) => set("searchUrl", e.target.value)} placeholder={URL_START} className={field} />
                    </label>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Button className="min-h-11" disabled={busy !== null || searchBlocker !== null} aria-describedby={`${id}-search-check`} onClick={() => void checkSearch()}>
                      {t("settings.assistant.searchTest")}
                    </Button>
                    <p
                      id={`${id}-search-check`}
                      role="status"
                      className={`m-0 text-[0.9375rem] ${searchCheck?.tone === "error" ? "text-danger" : searchCheck || busy === "searchCheck" ? "text-text-strong" : "text-text-muted"}`}
                    >
                      {busy === "searchCheck" ? t("settings.assistant.searchTesting") : searchCheck ? searchCheck.text : searchBlocker ? t(`settings.assistant.searchWhy.${searchBlocker}`) : ""}
                    </p>
                  </div>
                </>
              )}
            </div>

            <div role="group" aria-labelledby={`${id}-images-label`} className="flex flex-col gap-2">
              <div className="mb-1 flex items-center gap-1">
                <span id={`${id}-images-label`} className={labelText}>
                  {t("settings.assistant.images")}
                </span>
                <HelpTip name={about(t("settings.assistant.images"))}>{t("settings.assistant.imagesHelp")}</HelpTip>
              </div>
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={config.findImages} onChange={(e) => set("findImages", e.target.checked)} className="size-5" />
                <span>{t("settings.assistant.findImages")}</span>
              </label>
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={config.generateImages} onChange={(e) => set("generateImages", e.target.checked)} className="size-5" />
                <span>{t("settings.assistant.generateImages")}</span>
              </label>
              {config.generateImages && (
                <div className="flex flex-col gap-2 pl-8">
                  <label className="flex flex-col gap-1">
                    <span className="text-[0.9375rem] text-text-strong">{t("settings.assistant.imageService")}</span>
                    <select value={config.imageService} onChange={(e) => set("imageService", e.target.value as ImageService)} className={field}>
                      {IMAGE_SERVICES.map((s) => (
                        <option key={s} value={s}>
                          {t(`settings.assistant.imageServices.${s}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {imageCapability !== "supported" && (
                    <p data-testid="image-capability" className={`m-0 text-[0.875rem] ${imageCapability === "unsupported" ? "text-danger" : "text-text-strong"}`}>
                      {t(`settings.assistant.imageCapability.${imageCapability}`, { service: t(`settings.assistant.providers.${imageProvider}`) })}
                    </p>
                  )}
                  {needsImageKey && remote === false && <p className={hint}>{t("settings.assistant.imagesLeave")}</p>}
                  {needsImageKey && !(settings.hasImageKey && settings.config.imageService === "openai") && (
                    <p className="m-0 text-[0.875rem] text-danger">{t("settings.assistant.imageKeyMissing")}</p>
                  )}
                  {needsImageKey && (
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={`${id}-ikey`} className="sr-only">
                        {t("settings.assistant.imageKey")}
                      </label>
                      <input
                        id={`${id}-ikey`}
                        type="password"
                        autoComplete="off"
                        value={imageKey}
                        onChange={(e) => setImageKey(e.target.value)}
                        onKeyDown={onEnter(keepImageKey)}
                        placeholder={settings.hasImageKey && settings.config.imageService === "openai" ? t("settings.assistant.keyKeptPlaceholder") : t("settings.assistant.imageKey")}
                        className={field}
                      />
                      <Button className="min-h-11" disabled={busy !== null || !imageKey.trim()} onClick={keepImageKey}>
                        {t("settings.assistant.keySave")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                <label htmlFor={`${id}-perspective`} className={labelText}>
                  {t("settings.assistant.perspective")} <span className="font-normal text-text-muted">{t("settings.assistant.optional")}</span>
                </label>
                <HelpTip name={about(t("settings.assistant.perspective"))} align="end">
                  {t("settings.assistant.perspectiveHint")}
                </HelpTip>
              </div>
              <textarea
                id={`${id}-perspective`}
                rows={2}
                value={config.perspective}
                onChange={(e) => set("perspective", e.target.value)}
                className="w-full max-w-xl rounded-aw border border-border bg-bg px-3 py-2 text-[0.9375rem]"
              />
              <div role="group" aria-label={t("settings.assistant.perspectiveExamples")} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[0.8125rem] text-text-muted">{t("settings.assistant.perspectiveExamples")}</span>
                {PERSPECTIVE_EXAMPLES.map((example) => {
                  const text = t(`settings.assistant.perspectiveExample.${example}`);
                  return (
                    <button
                      key={example}
                      type="button"
                      onClick={() => set("perspective", config.perspective.trim() ? `${config.perspective.trim()} ${text}` : text)}
                      className="min-h-8 rounded-full border border-border-subtle px-2.5 text-[0.8125rem] text-text hover:bg-bg-secondary"
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

/** As the core decides it (config.rs `image_capability`): from the service, never from a model's name. */
function capabilityOf(provider: ProviderKind): ImageCapability {
  if (provider === "openai") return "supported";
  if (provider === "openai_compatible") return "unknown";
  return "unsupported";
}

function Step({ title, htmlFor, help, children }: { title: string; htmlFor: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <label htmlFor={htmlFor} className="text-[0.9375rem] font-semibold text-text-strong">
          {title}
        </label>
        {help}
      </div>
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
