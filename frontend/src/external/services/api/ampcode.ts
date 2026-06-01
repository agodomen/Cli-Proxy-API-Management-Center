/**
 * Amp CLI Integration (ampcode) 相关 API
 * 从社区旧版本隔离重建，因为上游已删除相关代码
 */

import { apiClient } from '@/services/api/client';
import { isRecord } from '@/utils/helpers';
import type {
  AmpcodeConfig,
  AmpcodeModelMapping,
  AmpcodeUpstreamApiKeyMapping,
} from '@/external/types/ampcode';

// ---- 内部 normalization 函数（原位于社区 transformers.ts，已从上游删除） ----

const normalizeBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(trimmed)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(trimmed)) return false;
  }
  return Boolean(value);
};

const normalizeAmpcodeModelMappings = (input: unknown): AmpcodeModelMapping[] => {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const mappings: AmpcodeModelMapping[] = [];

  input.forEach((entry) => {
    if (!isRecord(entry)) return;
    const from = String(entry.from ?? '').trim();
    const to = String(entry.to ?? '').trim();
    if (!from || !to) return;
    const key = from.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    mappings.push({ from, to });
  });

  return mappings;
};

const normalizeAmpcodeUpstreamApiKeys = (input: unknown): AmpcodeUpstreamApiKeyMapping[] => {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const mappings: AmpcodeUpstreamApiKeyMapping[] = [];

  input.forEach((entry) => {
    if (!isRecord(entry)) return;

    const upstreamApiKey = String(
      entry['upstream-api-key'] ?? entry.upstreamApiKey ?? entry['upstream_api_key'] ?? ''
    ).trim();
    if (!upstreamApiKey || seen.has(upstreamApiKey)) return;

    const rawApiKeys = entry['api-keys'] ?? entry.apiKeys ?? entry['api_keys'] ?? [];
    const apiKeys = Array.isArray(rawApiKeys)
      ? Array.from(new Set(rawApiKeys.map((item) => String(item ?? '').trim()).filter(Boolean)))
      : [];
    if (!apiKeys.length) return;

    seen.add(upstreamApiKey);
    mappings.push({ upstreamApiKey, apiKeys });
  });

  return mappings;
};

const normalizeAmpcodeConfig = (payload: unknown): AmpcodeConfig | undefined => {
  const sourceRaw = isRecord(payload) ? (payload.ampcode ?? payload) : payload;
  if (!isRecord(sourceRaw)) return undefined;
  const source = sourceRaw;

  const config: AmpcodeConfig = {};
  const upstreamUrl = source['upstream-url'] ?? source.upstreamUrl ?? source['upstream_url'];
  if (upstreamUrl) config.upstreamUrl = String(upstreamUrl);
  const upstreamApiKey = source['upstream-api-key'] ?? source.upstreamApiKey ?? source['upstream_api_key'];
  if (upstreamApiKey) config.upstreamApiKey = String(upstreamApiKey);

  const upstreamApiKeys = normalizeAmpcodeUpstreamApiKeys(
    source['upstream-api-keys'] ?? source.upstreamApiKeys ?? source['upstream_api_keys']
  );
  if (upstreamApiKeys.length) {
    config.upstreamApiKeys = upstreamApiKeys;
  }

  const forceModelMappings = normalizeBoolean(
    source['force-model-mappings'] ?? source.forceModelMappings ?? source['force_model_mappings']
  );
  if (forceModelMappings !== undefined) {
    config.forceModelMappings = forceModelMappings;
  }

  const modelMappings = normalizeAmpcodeModelMappings(
    source['model-mappings'] ?? source.modelMappings ?? source['model_mappings']
  );
  if (modelMappings.length) {
    config.modelMappings = modelMappings;
  }

  return config;
};

// ---- 序列化辅助 ----

const serializeUpstreamApiKeyMappings = (mappings: AmpcodeUpstreamApiKeyMapping[]) =>
  mappings.map((mapping) => ({
    'upstream-api-key': mapping.upstreamApiKey,
    'api-keys': mapping.apiKeys,
  }));

// ---- ampcodeApi ----

export const ampcodeApi = {
  async getAmpcode(): Promise<AmpcodeConfig> {
    const data = await apiClient.get('/ampcode');
    return normalizeAmpcodeConfig(data) ?? {};
  },

  updateUpstreamUrl: (url: string) => apiClient.put('/ampcode/upstream-url', { value: url }),
  clearUpstreamUrl: () => apiClient.delete('/ampcode/upstream-url'),

  updateUpstreamApiKey: (apiKey: string) => apiClient.put('/ampcode/upstream-api-key', { value: apiKey }),
  clearUpstreamApiKey: () => apiClient.delete('/ampcode/upstream-api-key'),

  async getUpstreamApiKeys(): Promise<AmpcodeUpstreamApiKeyMapping[]> {
    const data = await apiClient.get<Record<string, unknown>>('/ampcode/upstream-api-keys');
    const list = data?.['upstream-api-keys'] ?? data?.upstreamApiKeys ?? data?.items ?? data;
    return normalizeAmpcodeUpstreamApiKeys(list);
  },

  saveUpstreamApiKeys: (mappings: AmpcodeUpstreamApiKeyMapping[]) =>
    apiClient.put('/ampcode/upstream-api-keys', { value: serializeUpstreamApiKeyMappings(mappings) }),
  patchUpstreamApiKeys: (mappings: AmpcodeUpstreamApiKeyMapping[]) =>
    apiClient.patch('/ampcode/upstream-api-keys', { value: serializeUpstreamApiKeyMappings(mappings) }),
  deleteUpstreamApiKeys: (upstreamApiKeys: string[]) =>
    apiClient.delete('/ampcode/upstream-api-keys', { data: { value: upstreamApiKeys } }),

  async getModelMappings(): Promise<AmpcodeModelMapping[]> {
    const data = await apiClient.get<Record<string, unknown>>('/ampcode/model-mappings');
    const list = data?.['model-mappings'] ?? data?.modelMappings ?? data?.items ?? data;
    return normalizeAmpcodeModelMappings(list);
  },

  saveModelMappings: (mappings: AmpcodeModelMapping[]) =>
    apiClient.put('/ampcode/model-mappings', { value: mappings }),
  patchModelMappings: (mappings: AmpcodeModelMapping[]) =>
    apiClient.patch('/ampcode/model-mappings', { value: mappings }),
  clearModelMappings: () => apiClient.delete('/ampcode/model-mappings'),
  deleteModelMappings: (fromList: string[]) =>
    apiClient.delete('/ampcode/model-mappings', { data: { value: fromList } }),

  updateForceModelMappings: (enabled: boolean) => apiClient.put('/ampcode/force-model-mappings', { value: enabled }),
};
