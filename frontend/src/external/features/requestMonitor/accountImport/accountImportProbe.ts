/**
 * Probe imported account credentials via management api-call before upload.
 * Status 0 means transport timeout / request failed without an HTTP status.
 */

import { apiCallApi, getApiCallErrorMessage } from '@/services/api/apiCall';
import {
  CLAUDE_USAGE_URL,
  CLAUDE_REQUEST_HEADERS,
  CODEX_USAGE_URL,
  CODEX_REQUEST_HEADERS,
  KIMI_USAGE_URL,
  KIMI_REQUEST_HEADERS,
  XAI_BILLING_URL,
  XAI_REQUEST_HEADERS,
} from '@/utils/quota/constants';
import type { AccountImportItem } from './accountImportConverter';

export type AccountImportProbeStatus = {
  statusCode: number;
  message?: string;
  probedAt: number;
};

export type AccountImportProbeResultMap = Record<string, AccountImportProbeStatus>;

type ProbeTarget = {
  method: string;
  url: string;
  header: Record<string, string>;
  data?: string;
};

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const joinBaseUrl = (baseUrl: string | undefined, path: string) => {
  const base = (baseUrl || '').replace(/\/+$/, '');
  if (!base) return path;
  if (/\/v\d+$/i.test(base)) return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};

const readAuthHeaders = (authJson: Record<string, unknown>): Record<string, string> => {
  const headers = isRecord(authJson.headers) ? authJson.headers : {};
  const out: Record<string, string> = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (typeof value === 'string' && value.trim()) {
      out[key] = value.trim();
    }
  });
  return out;
};

const resolveProbeTarget = (item: AccountImportItem): ProbeTarget => {
  const authJson = item.authJson;
  const type = (firstString(authJson.type) || 'codex').toLowerCase();
  const baseUrl = firstString(authJson.base_url, authJson.baseUrl);
  const customHeaders = readAuthHeaders(authJson);

  if (type === 'xai' || type === 'grok' || type === 'x-ai') {
    return {
      method: 'GET',
      url: XAI_BILLING_URL,
      header: {
        ...XAI_REQUEST_HEADERS,
        ...customHeaders,
      },
    };
  }

  if (type === 'claude' || type === 'anthropic') {
    return {
      method: 'GET',
      url: CLAUDE_USAGE_URL,
      header: {
        ...CLAUDE_REQUEST_HEADERS,
        ...customHeaders,
      },
    };
  }

  if (type === 'kimi' || type === 'moonshot') {
    return {
      method: 'GET',
      url: KIMI_USAGE_URL,
      header: {
        ...KIMI_REQUEST_HEADERS,
        ...customHeaders,
      },
    };
  }

  if (type === 'gemini' || type === 'aistudio' || type === 'vertex' || type === 'antigravity') {
    const url = baseUrl
      ? joinBaseUrl(baseUrl, '/models')
      : 'https://generativelanguage.googleapis.com/v1beta/models';
    return {
      method: 'GET',
      url,
      header: {
        Authorization: 'Bearer $TOKEN$',
        'Content-Type': 'application/json',
        ...customHeaders,
      },
    };
  }

  // Default: Codex / ChatGPT style usage endpoint.
  return {
    method: 'GET',
    url: CODEX_USAGE_URL,
    header: {
      ...CODEX_REQUEST_HEADERS,
      ...customHeaders,
    },
  };
};

export const getAccountImportItemKey = (item: AccountImportItem, index: number) =>
  item.credentialHash || `${item.fileName}::${index}`;

const extractInlineToken = (authJson: Record<string, unknown>) =>
  firstString(
    authJson.access_token,
    authJson.accessToken,
    authJson.session_token,
    authJson.sessionToken,
    authJson.api_key,
    authJson.apiKey,
    authJson.key,
    authJson.refresh_token,
    authJson.refreshToken
  );

const applyInlineToken = (headers: Record<string, string>, token: string | undefined) => {
  if (!token) return headers;
  const next: Record<string, string> = {};
  Object.entries(headers).forEach(([key, value]) => {
    next[key] = value.includes('$TOKEN$') ? value.split('$TOKEN$').join(token) : value;
  });
  if (!Object.keys(next).some((key) => key.toLowerCase() === 'authorization')) {
    next.Authorization = `Bearer ${token}`;
  }
  return next;
};

const isTimeoutError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const message =
    error instanceof Error
      ? error.message
      : 'message' in error
        ? String((error as { message?: string }).message || '')
        : String(error);
  return code === 'ECONNABORTED' || /timeout|timed out|network error|request failed/i.test(message);
};

export const probeAccountImportItem = async (
  item: AccountImportItem
): Promise<AccountImportProbeStatus> => {
  const target = resolveProbeTarget(item);
  const token = extractInlineToken(item.authJson);
  if (!token) {
    return {
      statusCode: 0,
      message: 'Missing access token',
      probedAt: Date.now(),
    };
  }

  const header = applyInlineToken(target.header, token);

  try {
    // authIndex is intentionally omitted: credentials are not uploaded yet.
    // Token is injected client-side into Authorization / custom headers.
    const result = await apiCallApi.request(
      {
        method: target.method,
        url: target.url,
        header,
        data: target.data,
      },
      { timeout: 20_000 }
    );

    return {
      statusCode: Number.isFinite(result.statusCode) ? result.statusCode : 0,
      message: result.statusCode >= 200 && result.statusCode < 300
        ? undefined
        : getApiCallErrorMessage(result),
      probedAt: Date.now(),
    };
  } catch (error) {
    return {
      statusCode: 0,
      message: isTimeoutError(error)
        ? 'Timeout'
        : error instanceof Error
          ? error.message
          : String(error),
      probedAt: Date.now(),
    };
  }
};

export const probeAccountImportItems = async (
  items: AccountImportItem[],
  options?: {
    concurrency?: number;
    onProgress?: (done: number, total: number, key: string, status: AccountImportProbeStatus) => void;
    signal?: { cancelled: boolean };
  }
): Promise<AccountImportProbeResultMap> => {
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 4, 8));
  const results: AccountImportProbeResultMap = {};
  let cursor = 0;
  let done = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      if (options?.signal?.cancelled) return;
      const index = cursor;
      cursor += 1;
      const item = items[index];
      const key = getAccountImportItemKey(item, index);
      const status = await probeAccountImportItem(item);
      results[key] = status;
      done += 1;
      options?.onProgress?.(done, items.length, key, status);
    }
  });

  await Promise.all(workers);
  return results;
};

export const collectProbeStatusCodes = (
  items: AccountImportItem[],
  probeResults: AccountImportProbeResultMap
): number[] => {
  const codes = new Set<number>();
  items.forEach((item, index) => {
    const status = probeResults[getAccountImportItemKey(item, index)];
    if (!status) return;
    codes.add(status.statusCode);
  });
  return Array.from(codes).sort((a, b) => a - b);
};

export const formatProbeStatusCode = (statusCode: number) =>
  statusCode === 0 ? '0 (timeout)' : String(statusCode);
