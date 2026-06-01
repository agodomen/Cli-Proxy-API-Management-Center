import { providersApi } from '@/services/api/providers';
import type { ApiKeyEntry, GeminiKeyConfig, ModelAlias, OpenAIProviderConfig, ProviderKeyConfig } from '@/types/provider';
import { listAllFilteredKeys } from './keyProbeService';
import type { APIKey, Provider } from './types';
import { tryParseParamObject } from './components/ParamEditor/paramUtils';

export interface ProviderCpaSyncResult {
  name: string;
  created: boolean;
  keyCount: number;
  skippedKeyCount: number;
  target: string;
}

const asString = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const asBoolean = (value: unknown) => typeof value === 'boolean' ? value : undefined;
const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const asHeaders = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const headers = Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key.trim(), asString(item)] as const)
      .filter(([key, item]) => key && item)
  );
  return Object.keys(headers).length > 0 ? headers : undefined;
};

const asModels = (value: unknown): ModelAlias[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const models = value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const name = asString(record.name);
      if (!name) return null;
      const alias = asString(record.alias);
      return { name, ...(alias ? { alias } : {}) };
    })
    .filter((item): item is ModelAlias => item !== null);
  return models.length > 0 ? models : undefined;
};

const getProxyUrl = (param: Record<string, unknown>) =>
  asString(param.proxy_url) || asString(param.proxyUrl);

const eligibleProviderKeys = (provider: Provider, keys: APIKey[]) => keys
  .filter((key) => key.provider_id === provider.provider_id)
  .filter((key) => key.auth_type === 1 && key.status > 0 && asString(key.auth_value || key.api_key))
  .sort((left, right) => right.priority - left.priority || left.id - right.id);

export function buildProviderCpaConfig(
  provider: Provider,
  keys: APIKey[],
  current?: OpenAIProviderConfig
): OpenAIProviderConfig {
  const providerParam = tryParseParamObject(provider.param || '{}') ?? {};
  const providerProxyUrl = getProxyUrl(providerParam);
  const eligibleKeys = eligibleProviderKeys(provider, keys);
  const seen = new Set<string>();
  const apiKeyEntries = eligibleKeys.reduce<ApiKeyEntry[]>((items, key) => {
    const apiKey = asString(key.auth_value || key.api_key);
    if (!apiKey || seen.has(apiKey)) return items;
    seen.add(apiKey);
    const keyParam = tryParseParamObject(key.param || '{}') ?? {};
    const proxyUrl = getProxyUrl(keyParam) || providerProxyUrl;
    items.push({
      apiKey,
      ...(proxyUrl ? { proxyUrl } : {}),
      ...(key.auth_index ? { authIndex: key.auth_index } : {}),
    });
    return items;
  }, []);
  const models = asModels(providerParam.models);
  const testModel = asString(providerParam.test_model)
    || asString(providerParam.testModel)
    || models?.[0]?.name;
  const priority = asNumber(providerParam.priority)
    ?? eligibleKeys.reduce((highest, key) => Math.max(highest, key.priority), 0);
  const prefix = asString(providerParam.prefix);
  const headers = asHeaders(providerParam.headers);
  const disableCooling = asBoolean(providerParam.disable_cooling)
    ?? asBoolean(providerParam.disableCooling);

  return {
    ...(current ?? {}),
    name: provider.provider_name.trim(),
    baseUrl: provider.base_url.trim().replace(/\/+$/, ''),
    apiKeyEntries,
    disabled: provider.status < 1 || apiKeyEntries.length === 0,
    priority,
    prefix: prefix || undefined,
    headers,
    models,
    testModel: testModel || undefined,
    disableCooling,
  };
}

function buildNativeKeyConfigs(provider: Provider, keys: APIKey[]): ProviderKeyConfig[] {
  const providerParam = tryParseParamObject(provider.param || '{}') ?? {};
  const providerProxyUrl = getProxyUrl(providerParam);
  const models = asModels(providerParam.models);
  const headers = asHeaders(providerParam.headers);
  const prefix = asString(providerParam.prefix);
  const disableCooling = asBoolean(providerParam.disable_cooling) ?? asBoolean(providerParam.disableCooling);
  return eligibleProviderKeys(provider, keys).map((key) => {
    const keyParam = tryParseParamObject(key.param || '{}') ?? {};
    return {
      apiKey: asString(key.auth_value || key.api_key),
      priority: key.priority,
      baseUrl: provider.base_url.trim().replace(/\/+$/, ''),
      proxyUrl: getProxyUrl(keyParam) || providerProxyUrl || undefined,
      prefix: prefix || undefined,
      headers,
      models,
      disableCooling,
      authIndex: key.auth_index || undefined,
    };
  });
}

const providerKeyValues = (provider: Provider, keys: APIKey[]) => new Set(
  keys.filter((key) => key.provider_id === provider.provider_id)
    .map((key) => asString(key.auth_value || key.api_key))
    .filter(Boolean)
);

async function syncNativeProvider(provider: Provider, keys: APIKey[]) {
  const target = provider.cpa_config_type || 'openai-compatibility';
  const configs = buildNativeKeyConfigs(provider, keys);
  const managedValues = providerKeyValues(provider, keys);
  const merge = <T extends ProviderKeyConfig>(current: T[], incoming: T[]) => [
    ...current.filter((item) => !managedValues.has(asString(item.apiKey))),
    ...incoming,
  ];

  if (target === 'gemini-api-key') {
    const current = await providersApi.getGeminiKeys();
    await providersApi.saveGeminiKeys(merge(current, configs as GeminiKeyConfig[]));
    return current.some((item) => managedValues.has(asString(item.apiKey)));
  }
  if (target === 'claude-api-key') {
    const current = await providersApi.getClaudeConfigs();
    await providersApi.saveClaudeConfigs(merge(current, configs));
    return current.some((item) => managedValues.has(asString(item.apiKey)));
  }
  if (target === 'codex-api-key') {
    const current = await providersApi.getCodexConfigs();
    await providersApi.saveCodexConfigs(merge(current, configs));
    return current.some((item) => managedValues.has(asString(item.apiKey)));
  }
  if (target === 'vertex-api-key') {
    const current = await providersApi.getVertexConfigs();
    await providersApi.saveVertexConfigs(merge(current, configs));
    return current.some((item) => managedValues.has(asString(item.apiKey)));
  }
  throw new Error('unsupported_cpa_config_type');
}

export async function syncProviderToCpa(
  serviceBase: string,
  managementKey: string | undefined,
  provider: Provider,
  keys?: APIKey[]
): Promise<ProviderCpaSyncResult> {
  const name = provider.provider_name.trim();
  if (!name) throw new Error('provider_name_required');
  if (!provider.base_url.trim()) throw new Error('provider_base_url_required');

  const providerKeys = keys ?? await listAllFilteredKeys(
    serviceBase,
    { provider_id: provider.provider_id, status: 'all' },
    managementKey
  );
  const target = provider.cpa_config_type || 'openai-compatibility';
  let created = false;
  let keyCount = eligibleProviderKeys(provider, providerKeys).length;
  if (target === 'openai-compatibility') {
    const providers = await providersApi.getOpenAIProviders();
    const existingIndex = providers.findIndex(
      (item) => item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    const current = existingIndex >= 0 ? providers[existingIndex] : undefined;
    const config = buildProviderCpaConfig(provider, providerKeys, current);
    const next = [...providers];
    if (existingIndex >= 0) next[existingIndex] = config;
    else next.push(config);
    await providersApi.saveOpenAIProviders(next);
    created = existingIndex < 0;
    keyCount = config.apiKeyEntries.length;
  } else {
    const existed = await syncNativeProvider(provider, providerKeys);
    created = !existed;
  }

  return {
    name,
    created,
    keyCount,
    skippedKeyCount: Math.max(0, providerKeys.length - keyCount),
    target,
  };
}
