import axios from 'axios';
import { normalizeApiBase } from '@/utils/connection';
import type {
  Channel,
  Provider,
  APIKey,
  ProxyDetail,
  ClashSubscription,
  PageResult,
  ListParams,
  KeyStatusCount,
} from './types';

/** Extract backend error code/message from charitable API failures for UI logs. */
export function formatCharitableApiError(error: unknown, fallback = 'request_failed'): string {
  const pickFromData = (data: unknown, status?: number) => {
    if (data && typeof data === 'object') {
      const record = data as { error?: unknown; code?: unknown; message?: unknown };
      const nested =
        record.error && typeof record.error === 'object'
          ? (record.error as { message?: unknown; code?: unknown })
          : null;
      const code = [
        record.code,
        typeof record.error === 'string' ? record.error : undefined,
        nested?.code,
        nested?.message,
        record.message,
      ]
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .find(Boolean);
      if (code) return status ? `${code} (HTTP ${status})` : code;
    }
    if (typeof data === 'string' && data.trim()) return data.trim();
    return '';
  };

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const fromData = pickFromData(error.response?.data, status);
    if (fromData) return fromData;
    if (error.message) return status ? `${error.message} (HTTP ${status})` : error.message;
  }

  // apiClient wraps failures as ApiError { status, details/data, message }.
  if (error && typeof error === 'object') {
    const apiError = error as {
      message?: unknown;
      status?: unknown;
      details?: unknown;
      data?: unknown;
      name?: unknown;
    };
    const status = typeof apiError.status === 'number' ? apiError.status : undefined;
    const fromDetails = pickFromData(apiError.details ?? apiError.data, status);
    if (fromDetails) return fromDetails;
    if (typeof apiError.message === 'string' && apiError.message.trim()) {
      return status ? `${apiError.message.trim()} (HTTP ${status})` : apiError.message.trim();
    }
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}


// Compute the charitable API base URL from the usage service base
function buildCharitableBase(base: string): string {
  const normalized = normalizeApiBase(base).replace(/\/+$/, '');
  return `${normalized}/v0/cpamc/charitable`;
}

const authConfig = (managementKey?: string) =>
  managementKey ? { headers: { Authorization: `Bearer ${managementKey}` } } : undefined;

const listConfig = (params: ListParams, managementKey?: string) => {
  const next: Record<string, string | number | undefined> = { ...params } as Record<
    string,
    string | number | undefined
  >;
  // Backend expects provider_ids as a comma-separated string, not provider_ids[].
  if (Array.isArray(params.provider_ids)) {
    next.provider_ids = params.provider_ids.join(',');
  }
  return {
    params: next,
    ...(authConfig(managementKey) ?? {}),
  };
};

// ── Channels ──

export async function listChannels(
  base: string,
  params: ListParams,
  managementKey?: string
): Promise<PageResult<Channel>> {
  const { data } = await axios.get<PageResult<Channel>>(
    `${buildCharitableBase(base)}/channels`,
    listConfig(params, managementKey)
  );
  return data;
}

export async function getChannel(
  base: string,
  id: number,
  managementKey?: string
): Promise<Channel> {
  const { data } = await axios.get<Channel>(
    `${buildCharitableBase(base)}/channels/${id}`,
    authConfig(managementKey)
  );
  return data;
}

export async function createChannel(
  base: string,
  input: Partial<Channel>,
  managementKey?: string
): Promise<Channel> {
  const { data } = await axios.post<Channel>(
    `${buildCharitableBase(base)}/channels`,
    input,
    authConfig(managementKey)
  );
  return data;
}

export async function updateChannel(
  base: string,
  id: number,
  input: Partial<Channel>,
  managementKey?: string
): Promise<Channel> {
  const { data } = await axios.put<Channel>(
    `${buildCharitableBase(base)}/channels/${id}`,
    input,
    authConfig(managementKey)
  );
  return data;
}

export async function deleteChannel(
  base: string,
  id: number,
  managementKey?: string
): Promise<void> {
  await axios.delete(`${buildCharitableBase(base)}/channels/${id}`, authConfig(managementKey));
}

// ── Providers ──

export async function listProviders(
  base: string,
  params: ListParams,
  managementKey?: string
): Promise<PageResult<Provider>> {
  const { data } = await axios.get<PageResult<Provider>>(
    `${buildCharitableBase(base)}/providers`,
    listConfig(params, managementKey)
  );
  return data;
}

export async function getProvider(
  base: string,
  id: number,
  managementKey?: string
): Promise<Provider> {
  const { data } = await axios.get<Provider>(
    `${buildCharitableBase(base)}/providers/${id}`,
    authConfig(managementKey)
  );
  return data;
}

export async function createProvider(
  base: string,
  input: Partial<Provider>,
  managementKey?: string
): Promise<Provider> {
  const { data } = await axios.post<Provider>(
    `${buildCharitableBase(base)}/providers`,
    input,
    authConfig(managementKey)
  );
  return data;
}

export async function updateProvider(
  base: string,
  id: number,
  input: Partial<Provider>,
  managementKey?: string
): Promise<Provider> {
  const { data } = await axios.put<Provider>(
    `${buildCharitableBase(base)}/providers/${id}`,
    input,
    authConfig(managementKey)
  );
  return data;
}

export async function deleteProvider(
  base: string,
  id: number,
  managementKey?: string
): Promise<void> {
  await axios.delete(`${buildCharitableBase(base)}/providers/${id}`, authConfig(managementKey));
}

// ── Keys ──

export async function listKeys(
  base: string,
  params: ListParams,
  managementKey?: string
): Promise<PageResult<APIKey>> {
  const { data } = await axios.get<PageResult<APIKey>>(
    `${buildCharitableBase(base)}/keys`,
    listConfig(params, managementKey)
  );
  return data;
}

/** Lists concrete key status codes for the current non-status filters. */
export async function listKeyStatusCounts(
  base: string,
  params: Omit<ListParams, 'page' | 'page_size' | 'status' | 'status_domain'>,
  managementKey?: string
): Promise<KeyStatusCount[]> {
  const { data } = await axios.get<KeyStatusCount[]>(
    `${buildCharitableBase(base)}/keys/statuses`,
    listConfig(params, managementKey)
  );
  return data;
}

export async function getKey(base: string, id: number, managementKey?: string): Promise<APIKey> {
  const { data } = await axios.get<APIKey>(
    `${buildCharitableBase(base)}/keys/${id}`,
    authConfig(managementKey)
  );
  return data;
}

export async function createKey(
  base: string,
  input: Partial<APIKey>,
  managementKey?: string
): Promise<APIKey> {
  const { data } = await axios.post<APIKey>(
    `${buildCharitableBase(base)}/keys`,
    input,
    authConfig(managementKey)
  );
  return data;
}

export async function updateKey(
  base: string,
  id: number,
  input: Partial<APIKey>,
  managementKey?: string
): Promise<APIKey> {
  const { data } = await axios.put<APIKey>(
    `${buildCharitableBase(base)}/keys/${id}`,
    input,
    authConfig(managementKey)
  );
  return data;
}

export async function queryKeyByIndex(
  base: string,
  authIndex: string,
  managementKey?: string
): Promise<APIKey> {
  const { data } = await axios.post<APIKey>(
    `${buildCharitableBase(base)}/keys/query`,
    { auth_index: authIndex },
    authConfig(managementKey)
  );
  return data;
}

export async function queryKeyByFileName(
  base: string,
  fileName: string,
  managementKey?: string
): Promise<APIKey> {
  const { data } = await axios.post<APIKey>(
    `${buildCharitableBase(base)}/keys/query`,
    { file_name: fileName },
    authConfig(managementKey)
  );
  return data;
}

export async function upsertKey(
  base: string,
  input: Partial<APIKey>,
  managementKey?: string
): Promise<{ operation: "created" | "updated"; item: APIKey }> {
  const { data } = await axios.post<{ operation: "created" | "updated"; item: APIKey }>(
    `${buildCharitableBase(base)}/keys/upsert`,
    input,
    authConfig(managementKey)
  );
  return data;
}


export async function deleteKey(base: string, id: number, managementKey?: string): Promise<void> {
  await axios.delete(`${buildCharitableBase(base)}/keys/${id}`, authConfig(managementKey));
}

// ── Key special endpoints ──

export async function getKeyFullParam(
  base: string,
  id: number,
  managementKey?: string
): Promise<Record<string, unknown>> {
  const { data } = await axios.get<Record<string, unknown>>(
    `${buildCharitableBase(base)}/keys/${id}/full_param`,
    authConfig(managementKey)
  );
  return data;
}

export async function getKeyParam(
  base: string,
  id: number,
  managementKey?: string
): Promise<Record<string, unknown>> {
  const { data } = await axios.get<Record<string, unknown>>(
    `${buildCharitableBase(base)}/keys/${id}/param`,
    authConfig(managementKey)
  );
  return data;
}

export async function updateKeyParam(
  base: string,
  id: number,
  param: Record<string, unknown>,
  managementKey?: string
): Promise<void> {
  await axios.put(
    `${buildCharitableBase(base)}/keys/${id}/param`,
    param,
    authConfig(managementKey)
  );
}

export async function batchDeleteKeys(
  base: string,
  ids: number[],
  managementKey?: string
): Promise<void> {
  await axios.post(
    `${buildCharitableBase(base)}/keys/batch/delete`,
    { ids },
    authConfig(managementKey)
  );
}

export async function batchToggleKeys(
  base: string,
  ids: number[],
  status: number,
  managementKey?: string
): Promise<void> {
  await axios.post(
    `${buildCharitableBase(base)}/keys/batch/disable`,
    { ids, status },
    authConfig(managementKey)
  );
}

export interface CharitableDebugRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  managementKey?: string;
}

export interface SyncServiceProviderModel {
  name: string;
  alias?: string;
}

export interface SyncServiceProvidersPayload {
  base_url: string;
  api_key: string;
  protocols?: string[];
  provider_name?: string;
  models?: SyncServiceProviderModel[];
  test_model?: string;
}

export interface SyncServiceProvidersResult {
  synced: number;
  skipped: number;
  total: number;
  updated?: number;
  updated_keys?: number;
}

export async function syncServiceProvidersToKeys(
  base: string,
  payload: SyncServiceProvidersPayload[],
  managementKey?: string
): Promise<SyncServiceProvidersResult> {
  const { data } = await axios.post<SyncServiceProvidersResult>(
    `${buildCharitableBase(base)}/sync/service-providers?update_models=1`,
    payload,
    authConfig(managementKey)
  );
  return data;
}

export interface CharitableDebugResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

export async function debugCharitableRequest(
  base: string,
  request: CharitableDebugRequest
): Promise<CharitableDebugResponse> {
  const response = await axios.request({
    url: `${buildCharitableBase(base)}${request.path.startsWith('/') ? request.path : `/${request.path}`}`,
    method: request.method,
    params: request.query,
    data: request.body,
    validateStatus: () => true,
    ...(authConfig(request.managementKey) ?? {}),
  });

  const headers: Record<string, string> = {};
  Object.entries(response.headers ?? {}).forEach(([key, value]) => {
    headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
  });

  return {
    status: response.status,
    data: response.data,
    headers,
  };
}

// ── Proxies ──

export async function listProxies(
  base: string,
  params: ListParams,
  managementKey?: string
): Promise<PageResult<ProxyDetail>> {
  const { data } = await axios.get<PageResult<ProxyDetail>>(
    `${buildCharitableBase(base)}/proxies`,
    listConfig(params, managementKey)
  );
  return data;
}

export async function getProxy(
  base: string,
  id: number,
  managementKey?: string
): Promise<ProxyDetail> {
  const { data } = await axios.get<ProxyDetail>(
    `${buildCharitableBase(base)}/proxies/${id}`,
    authConfig(managementKey)
  );
  return data;
}

export async function createProxy(
  base: string,
  input: Partial<ProxyDetail>,
  managementKey?: string
): Promise<ProxyDetail> {
  const { data } = await axios.post<ProxyDetail>(
    `${buildCharitableBase(base)}/proxies`,
    input,
    authConfig(managementKey)
  );
  return data;
}

export async function updateProxy(
  base: string,
  id: number,
  input: Partial<ProxyDetail>,
  managementKey?: string
): Promise<ProxyDetail> {
  const { data } = await axios.put<ProxyDetail>(
    `${buildCharitableBase(base)}/proxies/${id}`,
    input,
    authConfig(managementKey)
  );
  return data;
}

export async function deleteProxy(base: string, id: number, managementKey?: string): Promise<void> {
  await axios.delete(`${buildCharitableBase(base)}/proxies/${id}`, authConfig(managementKey));
}

export interface ProxyProbeResult {
  id: number;
  ok: boolean;
  target?: string;
  latency_ms: number;
  error?: string;
}

export async function probeProxies(
  base: string,
  ids: number[],
  managementKey?: string
): Promise<ProxyProbeResult[]> {
  const { data } = await axios.post<{ results: ProxyProbeResult[] }>(
    `${buildCharitableBase(base)}/proxies/probe`,
    { ids },
    authConfig(managementKey)
  );
  return data.results ?? [];
}

export interface ProxySiteTestResult {
  key: string;
  name: string;
  category: 'global_ai' | 'global_web' | 'mainland_china';
  url: string;
  ok: boolean;
  status_code?: number;
  latency_ms: number;
  error?: string;
}

export interface ProxyConnectivityTestResult {
  id: number;
  proxy_info?: string;
  proxy_type: number;
  supported: boolean;
  error?: string;
  sites: ProxySiteTestResult[];
}

export async function testProxySites(
  base: string,
  ids: number[],
  managementKey?: string
): Promise<ProxyConnectivityTestResult[]> {
  const { data } = await axios.post<{ results: ProxyConnectivityTestResult[] }>(
    `${buildCharitableBase(base)}/proxies/site-test`,
    { ids },
    authConfig(managementKey)
  );
  return data.results ?? [];
}

export async function batchDeleteProxies(
  base: string,
  ids: number[],
  managementKey?: string
): Promise<void> {
  await axios.post(
    `${buildCharitableBase(base)}/proxies/batch/delete`,
    { ids },
    authConfig(managementKey)
  );
}

export interface ProxyImportIssue {
  index: number;
  message: string;
}

export interface ProxyImportResult {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  issues: ProxyImportIssue[];
  items: ProxyDetail[];
}

export interface ProxyURLResolveIssue {
  url: string;
  message: string;
}

export interface ProxyURLResolveResult {
  urls: string[];
  items: ProxyDetail[];
  created: number;
  skipped: number;
  failed: number;
  issues: ProxyURLResolveIssue[];
}

export async function importProxies(
  base: string,
  content: string,
  privacy: 'local' | 'public' | 'personal',
  managementKey?: string
): Promise<ProxyImportResult> {
  const { data } = await axios.post<ProxyImportResult>(
    `${buildCharitableBase(base)}/proxies/batch/import`,
    { content, privacy },
    authConfig(managementKey)
  );
  return data;
}

export interface ProxyURLBatchDeleteResult {
  total: number;
  matched: number;
  deleted: number;
  missing: string[];
}

export async function batchDeleteProxiesByURLs(
  base: string,
  content: string,
  managementKey?: string
): Promise<ProxyURLBatchDeleteResult> {
  const { data } = await axios.post<ProxyURLBatchDeleteResult>(
    `${buildCharitableBase(base)}/proxies/batch/delete-by-urls`,
    { content },
    authConfig(managementKey)
  );
  return data;
}

export async function listClashSubscriptions(
  base: string,
  params: ListParams,
  managementKey?: string
): Promise<PageResult<ClashSubscription>> {
  const { data } = await axios.get<PageResult<ClashSubscription>>(
    `${buildCharitableBase(base)}/proxies/subscriptions`,
    listConfig(params, managementKey)
  );
  return data;
}

export async function resolveClashSubscriptionURLs(
  base: string,
  urls: string[],
  managementKey?: string
): Promise<ProxyURLResolveResult> {
  const { data } = await axios.post<ProxyURLResolveResult>(
    `${buildCharitableBase(base)}/proxies/subscriptions/resolve-urls`,
    { urls, privacy: 'public' },
    authConfig(managementKey)
  );
  return data;
}

export async function createClashSubscription(
  base: string,
  input: Pick<ClashSubscription, 'subscription_type' | 'proxy_ids' | 'proxy_urls' | 'effective_at' | 'expires_at'>,
  managementKey?: string
): Promise<ClashSubscription> {
  const { data } = await axios.post<ClashSubscription>(
    `${buildCharitableBase(base)}/proxies/subscriptions`,
    input,
    authConfig(managementKey)
  );
  return data;
}

export async function updateClashSubscription(
  base: string,
  id: number,
  input: Pick<ClashSubscription, 'subscription_type' | 'proxy_ids' | 'proxy_urls' | 'effective_at' | 'expires_at'>,
  managementKey?: string
): Promise<ClashSubscription> {
  const { data } = await axios.put<ClashSubscription>(
    `${buildCharitableBase(base)}/proxies/subscriptions/${id}`,
    input,
    authConfig(managementKey)
  );
  return data;
}

export async function deleteClashSubscription(
  base: string,
  id: number,
  managementKey?: string
): Promise<void> {
  await axios.delete(
    `${buildCharitableBase(base)}/proxies/subscriptions/${id}`,
    authConfig(managementKey)
  );
}

export function buildClashSubscriptionURL(base: string, token: string): string {
  return `${buildCharitableBase(base)}/subscriptions/${encodeURIComponent(token)}/clash`;
}
