import axios from 'axios';
import { normalizeApiBase } from '@/utils/connection';
import type { Channel, Provider, APIKey, ProtocolKey } from '../types';

function buildBase(base: string): string {
  const normalized = normalizeApiBase(base).replace(/\/+$/, '');
  return `${normalized}/api/charitable/debug/key`;
}

const authConfig = (managementKey?: string) =>
  managementKey ? { headers: { Authorization: `Bearer ${managementKey}` } } : undefined;

export interface APIKeyDebugSettings {
  systemPrompt: string;
  probePrompt: string;
  updatedAtMs?: number;
}

export interface ExtractedCredential {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  source: string;
}

export interface ProbeResult {
  protocol: ProtocolKey | string;
  model?: string;
  ok: boolean;
  statusCode?: number;
  latencyMs: number;
  endpoint?: string;
  requestBody?: string;
  responseBody?: string;
  snippet?: string;
  error?: string;
}

export interface ProbeResponse {
  baseUrl: string;
  model?: string;
  models?: string[];
  modelsFetched?: boolean;
  results: ProbeResult[];
}

export interface ListModelsResponse {
  baseUrl: string;
  models: string[];
}

export interface SaveCredentialResult {
  channel: Channel;
  provider: Provider;
  key: APIKey;
  created: {
    channel: boolean;
    provider: boolean;
    key: boolean;
  };
}

export async function getKeyDebugSettings(base: string, managementKey?: string) {
  const { data } = await axios.get<APIKeyDebugSettings>(`${buildBase(base)}/settings`, authConfig(managementKey));
  return data;
}

export async function saveKeyDebugSettings(
  base: string,
  settings: Partial<APIKeyDebugSettings>,
  managementKey?: string
) {
  const { data } = await axios.put<APIKeyDebugSettings>(
    `${buildBase(base)}/settings`,
    settings,
    authConfig(managementKey)
  );
  return data;
}

export async function extractKeyCredentials(base: string, text: string, managementKey?: string) {
  const { data } = await axios.post<{ items: ExtractedCredential[] }>(
    `${buildBase(base)}/extract`,
    { text },
    authConfig(managementKey)
  );
  return data.items ?? [];
}

export async function listKeyProviderModels(
  base: string,
  payload: {
    baseUrl: string;
    apiKey: string;
    protocol?: string;
    maxModels?: number;
  },
  managementKey?: string
) {
  const { data } = await axios.post<ListModelsResponse>(
    `${buildBase(base)}/models`,
    payload,
    authConfig(managementKey)
  );
  return data;
}

export interface ProbeKeyProtocolsPayload {
  baseUrl: string;
  apiKey: string;
  model?: string;
  models?: string[];
  protocols?: string[];
  protocolPaths?: Record<string, string>;
  probePrompt?: string;
  maxModels?: number;
}

export async function probeKeyProtocols(
  base: string,
  payload: ProbeKeyProtocolsPayload,
  managementKey?: string
) {
  const { data } = await axios.post<ProbeResponse>(
    `${buildBase(base)}/probe`,
    payload,
    authConfig(managementKey)
  );
  return data;
}

export async function saveKeyCredential(
  base: string,
  payload: {
    baseUrl: string;
    apiKey: string;
    model?: string;
    apiType?: number;
    providerName?: string;
    channelName?: string;
    remark?: string;
    content?: string;
  },
  managementKey?: string
) {
  const { data } = await axios.post<SaveCredentialResult>(
    `${buildBase(base)}/save`,
    payload,
    authConfig(managementKey)
  );
  return data;
}
