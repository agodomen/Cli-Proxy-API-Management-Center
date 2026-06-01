import type { AxiosRequestConfig } from 'axios';
import { apiCallApi } from '@/services/api/apiCall';
import { requestCodexUsageRaw } from '@/external/services/api/codexQuota';
import {
  ANTIGRAVITY_QUOTA_URLS,
  ANTIGRAVITY_REQUEST_HEADERS,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_URL,
  KIMI_REQUEST_HEADERS,
  KIMI_USAGE_URL,
  XAI_BILLING_URL,
  XAI_REQUEST_HEADERS,
} from '@/utils/quota/constants';
import {
  GEMINI_CLI_QUOTA_URL,
  GEMINI_CLI_REQUEST_HEADERS,
} from '@/external/utils/quota/constants/geminiCli';
import { parseGeminiCliQuotaPayload, resolveGeminiCliProjectId } from '@/external/utils/quota/adapters/geminiCli';
import { normalizeAuthIndex } from '@/external/utils/usage';
import { parseAuthInfo } from './authInfo';
import { isAuthFileCredential } from './authFilePush';
import type { APIKey } from './types';

export interface AuthFileProbeResult {
  ok: boolean;
  valid: boolean;
  skipped?: boolean;
  message?: string;
  statusCode?: number;
}

export type AuthFileProbeProvider =
  | 'codex'
  | 'claude'
  | 'xai'
  | 'kimi'
  | 'antigravity'
  | 'gemini-cli'
  | 'gemini'
  | 'unknown';

export interface AuthFileProbeOptions {
  timeoutMs?: number;
  userAgent?: string;
  signal?: AbortSignal;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const normalizeProvider = (value: string): AuthFileProbeProvider => {
  const key = value.trim().toLowerCase().replace(/_/g, '-');
  if (!key) return 'unknown';
  if (key === 'x-ai' || key === 'grok') return 'xai';
  if (key === 'anthropic') return 'claude';
  if (key === 'gemini' || key === 'aistudio' || key === 'vertex') return 'gemini';
  if (key === 'gemini-cli') return 'gemini-cli';
  if (key === 'codex' || key === 'openai' || key === 'chatgpt') return 'codex';
  if (key === 'claude') return 'claude';
  if (key === 'xai') return 'xai';
  if (key === 'kimi') return 'kimi';
  if (key === 'antigravity') return 'antigravity';
  return 'unknown';
};

export function resolveAuthFileProbeProvider(key: Pick<APIKey, 'auth_info' | 'auth_value' | 'api_key'>): AuthFileProbeProvider {
  const info = parseAuthInfo(key.auth_info);
  const fromInfo = firstString(info.provider_type, (info as { type?: unknown }).type);
  if (fromInfo) return normalizeProvider(fromInfo);

  const raw = firstString(key.auth_value, key.api_key);
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isRecord(parsed)) {
        return normalizeProvider(firstString(parsed.type, parsed.provider));
      }
    } catch {
      // ignore invalid JSON
    }
  }
  return 'unknown';
}

const XAI_CHAT_COMPLETIONS_URL = 'https://cli-chat-proxy.grok.com/v1/chat/completions';
const XAI_PROBE_HEADERS = {
  ...XAI_REQUEST_HEADERS,
  'X-XAI-Token-Auth': 'xai-grok-cli',
  'x-grok-client-version': '0.2.93',
  'x-grok-client-identifier': 'grok-shell',
  'User-Agent': 'grok-shell/0.2.93 (linux; x86_64)',
} as const;

const withUserAgent = (headers: Record<string, string>, userAgent?: string) => {
  const ua = String(userAgent || '').trim();
  if (!ua) return headers;
  return { ...headers, 'User-Agent': ua };
};

const requestConfig = (timeoutMs?: number, signal?: AbortSignal): AxiosRequestConfig => {
  const config: AxiosRequestConfig = {};
  if (timeoutMs && timeoutMs > 0) config.timeout = timeoutMs;
  if (signal) config.signal = signal;
  return config;
};

const toProbeResult = (statusCode: number | null, bodyText: string): AuthFileProbeResult => {
  const code = statusCode && statusCode > 0 ? statusCode : undefined;
  const message = bodyText.slice(0, 300) || (code ? `HTTP ${code}` : 'Probe failed');
  if (code && code >= 200 && code < 300) {
    return { ok: true, valid: true, statusCode: code, message };
  }
  return {
    ok: false,
    valid: false,
    statusCode: code,
    message,
  };
};

async function probeCodex(
  authIndex: string,
  options: AuthFileProbeOptions,
  accountId?: string
): Promise<AuthFileProbeResult> {
  const { result } = await requestCodexUsageRaw({
    authIndex,
    accountId,
    userAgent: options.userAgent || 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal',
    requestConfig: requestConfig(options.timeoutMs, options.signal),
  });
  return toProbeResult(result.statusCode ?? null, String(result.bodyText || result.body || ''));
}

async function probeClaude(authIndex: string, options: AuthFileProbeOptions): Promise<AuthFileProbeResult> {
  const result = await apiCallApi.request(
    {
      authIndex,
      method: 'GET',
      url: CLAUDE_USAGE_URL,
      header: withUserAgent({ ...CLAUDE_REQUEST_HEADERS }, options.userAgent),
    },
    requestConfig(options.timeoutMs, options.signal)
  );
  return toProbeResult(result.statusCode ?? null, String(result.bodyText || result.body || ''));
}

async function probeXai(
  authIndex: string,
  options: AuthFileProbeOptions,
  raw?: Record<string, unknown> | null
): Promise<AuthFileProbeResult> {
  const metadata =
    raw && isRecord(raw.metadata) ? (raw.metadata as Record<string, unknown>) : null;
  const baseUrl = firstString(raw?.base_url, raw?.baseUrl, metadata?.base_url, metadata?.baseUrl).replace(
    /\/+$/,
    ''
  );
  let chatUrl = XAI_CHAT_COMPLETIONS_URL;
  if (baseUrl) {
    if (baseUrl.endsWith('/chat/completions')) chatUrl = baseUrl;
    else if (baseUrl.endsWith('/v1')) chatUrl = `${baseUrl}/chat/completions`;
    else chatUrl = `${baseUrl}/v1/chat/completions`;
  }

  const headers = withUserAgent({ ...XAI_PROBE_HEADERS }, options.userAgent);
  const cfg = requestConfig(options.timeoutMs, options.signal);
  const [billingResult, chatResult] = await Promise.allSettled([
    apiCallApi.request(
      { authIndex, method: 'GET', url: XAI_BILLING_URL, header: headers },
      cfg
    ),
    apiCallApi.request(
      {
        authIndex,
        method: 'POST',
        url: chatUrl,
        header: { ...headers, 'Content-Type': 'application/json' },
        data: JSON.stringify({
          model: 'grok-4.5',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      },
      cfg
    ),
  ]);

  const billing = billingResult.status === 'fulfilled' ? billingResult.value : null;
  const chat = chatResult.status === 'fulfilled' ? chatResult.value : null;
  const chatError =
    chatResult.status === 'rejected'
      ? String(
          chatResult.reason instanceof Error
            ? chatResult.reason.message
            : chatResult.reason || ''
        )
      : '';

  const chatStatus = chat?.statusCode ?? null;
  const billingStatus = billing?.statusCode ?? null;
  const preferred =
    chatStatus && chatStatus !== 0
      ? chatStatus
      : billingStatus && billingStatus !== 0
        ? billingStatus
        : chatStatus ?? billingStatus ?? null;
  const bodyText = [
    String(chat?.bodyText || chat?.body || ''),
    chatError,
    String(billing?.bodyText || billing?.body || ''),
  ]
    .filter(Boolean)
    .join('\n');

  if (!preferred && chatError) {
    return { ok: false, valid: false, message: chatError.slice(0, 300) };
  }
  return toProbeResult(preferred, bodyText);
}

async function probeKimi(authIndex: string, options: AuthFileProbeOptions): Promise<AuthFileProbeResult> {
  const result = await apiCallApi.request(
    {
      authIndex,
      method: 'GET',
      url: KIMI_USAGE_URL,
      header: withUserAgent({ ...KIMI_REQUEST_HEADERS }, options.userAgent),
    },
    requestConfig(options.timeoutMs, options.signal)
  );
  return toProbeResult(result.statusCode ?? null, String(result.bodyText || result.body || ''));
}

async function probeAntigravity(authIndex: string, options: AuthFileProbeOptions): Promise<AuthFileProbeResult> {
  let lastStatus: number | null = null;
  let lastBody = '';
  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    const result = await apiCallApi.request(
      {
        authIndex,
        method: 'POST',
        url,
        header: withUserAgent({ ...ANTIGRAVITY_REQUEST_HEADERS }, options.userAgent),
        data: '{}',
      },
      requestConfig(options.timeoutMs, options.signal)
    );
    lastStatus = result.statusCode ?? null;
    lastBody = String(result.bodyText || result.body || '');
    if (result.statusCode >= 200 && result.statusCode < 300) break;
  }
  return toProbeResult(lastStatus, lastBody);
}

async function probeGeminiCli(
  authIndex: string,
  options: AuthFileProbeOptions,
  raw?: Record<string, unknown> | null
): Promise<AuthFileProbeResult> {
  const projectId = resolveGeminiCliProjectId(raw as never) || '';
  const result = await apiCallApi.request(
    {
      authIndex,
      method: 'POST',
      url: GEMINI_CLI_QUOTA_URL,
      header: withUserAgent({ ...GEMINI_CLI_REQUEST_HEADERS }, options.userAgent),
      data: JSON.stringify(projectId ? { project: projectId } : {}),
    },
    requestConfig(options.timeoutMs, options.signal)
  );
  // parse only for side-effect validation of payload shape
  parseGeminiCliQuotaPayload(result.body ?? result.bodyText);
  return toProbeResult(result.statusCode ?? null, String(result.bodyText || result.body || ''));
}

/**
 * Probe an auth-file credential through CPA /api-call, reusing monitor inspection endpoints.
 * Requires the auth file to exist on CPA under the same auth_index.
 */
export async function runAuthFileAvailabilityProbe(
  key: APIKey,
  options: AuthFileProbeOptions = {}
): Promise<AuthFileProbeResult> {
  if (!isAuthFileCredential(key)) {
    return {
      ok: false,
      valid: false,
      skipped: true,
      message: 'Not an auth-file credential',
    };
  }

  const authIndex = normalizeAuthIndex(key.auth_index);
  if (!authIndex) {
    return {
      ok: false,
      valid: false,
      skipped: true,
      message: 'Auth-file probe requires auth_index (push to CPA first)',
    };
  }

  if (options.signal?.aborted) {
    return { ok: false, valid: false, skipped: true, message: 'Cancelled' };
  }

  let raw: Record<string, unknown> | null = null;
  const rawText = firstString(key.auth_value, key.api_key);
  if (rawText.startsWith('{') && rawText.endsWith('}')) {
    try {
      const parsed = JSON.parse(rawText) as unknown;
      if (isRecord(parsed)) raw = parsed;
    } catch {
      raw = null;
    }
  }

  const provider = resolveAuthFileProbeProvider(key);
  try {
    switch (provider) {
      case 'claude':
        return await probeClaude(authIndex, options);
      case 'xai':
        return await probeXai(authIndex, options, raw);
      case 'kimi':
        return await probeKimi(authIndex, options);
      case 'antigravity':
        return await probeAntigravity(authIndex, options);
      case 'gemini':
      case 'gemini-cli':
        return await probeGeminiCli(authIndex, options, raw);
      case 'codex':
        return await probeCodex(
          authIndex,
          options,
          firstString(raw?.account_id, raw?.accountId, parseAuthInfo(key.auth_info).account_id) ||
            undefined
        );
      default:
        // Unknown provider types: try codex-style usage first, then Claude as secondary fallback is avoided.
        return await probeCodex(authIndex, options);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Probe failed');
    const statusMatch = message.match(/\b([1-5]\d\d)\b/);
    return {
      ok: false,
      valid: false,
      statusCode: statusMatch ? Number(statusMatch[1]) : undefined,
      message: message.slice(0, 300),
    };
  }
}
