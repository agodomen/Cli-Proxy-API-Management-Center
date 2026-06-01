import { batchToggleKeys, formatCharitableApiError, listKeys } from './api';
import { isAuthFileCredential } from './authFilePush';
import { runAuthFileAvailabilityProbe } from './authFileProbe';
import { tryParseParamObject } from './components/ParamEditor/paramUtils';
import { getProbeStatusAfterResult } from './probeStatus';
import type { APIKey, ListParams, Provider } from './types';
import { primaryProviderProtocol } from './types';

export interface ProbeModel {
  name: string;
  alias?: string;
  image?: boolean;
  thinkingJson?: string;
}

export interface KeyProbeResult {
  ok: boolean;
  valid: boolean;
  skipped?: boolean;
  message?: string;
  statusCode?: number;
}

export type ProbeStrategy =
  | 'all'
  | 'unknown_invalid'
  | 'enabled_only'
  | 'disabled_only'
  | 'valid_only';

export type BatchProbePhase = 'preparing' | 'probing' | 'persisting' | 'done' | 'cancelled';

export interface BatchProbeLogItem {
  keyId: number;
  name: string;
  result: 'success' | 'failed' | 'skipped';
  message?: string;
  statusCode?: number;
}

export interface BatchProbeProgress {
  phase: BatchProbePhase;
  total: number;
  current: number;
  currentName: string;
  success: number;
  failed: number;
  skipped: number;
  statusChanged: boolean;
  /** Number of status writes that could not be persisted after probing. */
  statusWriteFailed: number;
  logs: BatchProbeLogItem[];
}

export interface BatchProbeResult extends BatchProbeProgress {
  phase: 'done' | 'cancelled';
}

export type ProbeAutoActionMode = 'none' | 'status_only' | 'enable_disable';

export interface ProbeKeysOptions {
  baseUrl: string;
  managementKey?: string;
  keys: APIKey[];
  providers: Provider[];
  concurrency?: number;
  strategy?: ProbeStrategy;
  /** Per-request timeout for probes (ms). 0 disables client timeout. */
  timeoutMs?: number;
  /** Optional User-Agent override (auth-file probes / provider header merge). */
  userAgent?: string;
  /**
   * Auto action after probing:
   * - none: do not persist status
   * - status_only: write probe-derived status codes (default)
   * - enable_disable: also force disabled(-2)/enabled(1) from fail/success
   */
  autoAction?: ProbeAutoActionMode;
  signal?: AbortSignal;
  onProgress?: (progress: BatchProbeProgress) => void;
}

const keyLabel = (key: APIKey) => {
  const index = String(key.auth_index || '').trim();
  if (index) return index;
  const value = String(key.auth_value || key.api_key || '').trim();
  if (!value) return `#${key.id}`;
  return value.length > 28 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
};

const BATCH_STATUS_WRITE_LIMIT = 500;

function chunkIds(ids: number[], size = BATCH_STATUS_WRITE_LIMIT): number[][] {
  const chunks: number[][] = [];
  for (let start = 0; start < ids.length; start += size) {
    chunks.push(ids.slice(start, start + size));
  }
  return chunks;
}

export function filterKeysByProbeStrategy(keys: APIKey[], strategy: ProbeStrategy = 'all'): APIKey[] {
  switch (strategy) {
    case 'unknown_invalid':
      return keys.filter((key) => Number(key.status) <= 0);
    case 'enabled_only':
      return keys.filter((key) => Number(key.status) !== -2);
    case 'disabled_only':
      return keys.filter((key) => Number(key.status) === -2);
    case 'valid_only':
      return keys.filter((key) => Number(key.status) > 0);
    case 'all':
    default:
      return keys;
  }
}

export function randomMathPrompt(): string {
  const randomInt = (min: number, max: number) => {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const value = new Uint32Array(1);
      crypto.getRandomValues(value);
      return min + (value[0] % (max - min + 1));
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  };
  const first = randomInt(100, 99999);
  const second = randomInt(100, 99999);
  return `Compute ${first}+${second} and reply with only the number.`;
}

function isProbeResponseValid(text: string): boolean {
  const body = (text || '').trim();
  if (!body) return false;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) return parsed.length > 0;
    return parsed !== null && typeof parsed === 'object' && Object.keys(parsed).length > 0;
  } catch {
    return false;
  }
}

export async function runKeyAvailabilityProbe(
  key: APIKey,
  providers: Provider[],
  models?: ProbeModel[],
  prompt?: string,
  extraHeaders?: Record<string, string>,
  options?: { timeoutMs?: number; userAgent?: string; signal?: AbortSignal }
): Promise<KeyProbeResult> {
  // Auth-file credentials use CPA /api-call inspection endpoints (same as /monitor/inspection).
  if (isAuthFileCredential(key) || Number(key.auth_type) > 1) {
    return runAuthFileAvailabilityProbe(key, {
      timeoutMs: options?.timeoutMs,
      userAgent: options?.userAgent,
      signal: options?.signal,
    });
  }

  const provider = providers.find((item) => item.provider_id === key.provider_id);
  const baseUrl = (provider?.base_url || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    return { ok: false, valid: false, skipped: true, message: 'Provider base_url missing' };
  }
  const apiKey = (key.auth_value || key.api_key || '').trim();
  if (!apiKey) {
    return { ok: false, valid: false, skipped: true, message: 'API key is empty' };
  }
  // Structured JSON values that are not marked as auth-file still cannot use Bearer probe.
  if (apiKey.startsWith('{') && apiKey.endsWith('}')) {
    return runAuthFileAvailabilityProbe(key, {
      timeoutMs: options?.timeoutMs,
      userAgent: options?.userAgent,
      signal: options?.signal,
    });
  }

  const providerParam = tryParseParamObject(provider?.param || '{}') ?? {};
  const providerModels = Array.isArray(providerParam.models)
    ? (providerParam.models as Array<Record<string, unknown>>)
        .map((model) => String(model.name ?? '').trim())
        .filter(Boolean)
    : [];
  const testModel =
    models?.find((model) => model.name.trim())?.name.trim() || providerModels[0] || 'gpt-3.5-turbo';

  const protocol = primaryProviderProtocol(provider?.protocol_type);
  const question = (prompt || '').trim() || randomMathPrompt();
  const customHeaders: Record<string, string> = {};
  const rawHeaders = providerParam.headers;
  if (rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
    for (const [headerName, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
      const headerKey = String(headerName || '').trim();
      const headerValue = String(value ?? '').trim();
      if (headerKey && headerValue) customHeaders[headerKey] = headerValue;
    }
  }
  if (extraHeaders) {
    for (const [headerName, value] of Object.entries(extraHeaders)) {
      const headerKey = String(headerName || '').trim();
      const headerValue = String(value ?? '').trim();
      if (headerKey && headerValue) customHeaders[headerKey] = headerValue;
    }
  }
  const userAgent = String(options?.userAgent || '').trim();
  if (userAgent) customHeaders['User-Agent'] = userAgent;
  let endpoint = `${baseUrl}/v1/chat/completions`;
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...customHeaders,
  };
  let body: unknown = {
    model: testModel,
    messages: [{ role: 'user', content: question }],
    stream: false,
    max_tokens: 16,
  };
  if (protocol === 'anthropic') {
    endpoint = `${baseUrl}/v1/messages`;
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...customHeaders,
    };
    body = { model: testModel, max_tokens: 16, messages: [{ role: 'user', content: question }] };
  } else if (protocol === 'gemini') {
    endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(testModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    headers = { 'Content-Type': 'application/json', ...customHeaders };
    body = { contents: [{ parts: [{ text: question }] }], generationConfig: { maxOutputTokens: 16 } };
  } else if (protocol === 'vertex') {
    return {
      ok: false,
      valid: false,
      skipped: true,
      message: 'Vertex service-account probing is not supported by API-key probe',
    };
  }

  try {
    const timeoutMs = options?.timeoutMs ?? 0;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options?.signal?.addEventListener('abort', onAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onAbort);
    }
    const text = await response.text().catch(() => '');
    if (response.status >= 200 && response.status < 300) {
      const valid = isProbeResponseValid(text);
      return valid
        ? { ok: true, valid: true, statusCode: response.status }
        : {
            ok: false,
            valid: false,
            statusCode: response.status,
            message: text.slice(0, 300) || 'HTTP 200 but empty/non-JSON body',
          };
    }
    return {
      ok: false,
      valid: false,
      statusCode: response.status,
      message: text.slice(0, 300) || `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      valid: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function listAllFilteredKeys(
  baseUrl: string,
  filters: Omit<ListParams, 'page' | 'page_size'>,
  managementKey?: string
) {
  const items: APIKey[] = [];
  let page = 1;
  while (true) {
    const result = await listKeys(baseUrl, { ...filters, page, page_size: 500 }, managementKey);
    items.push(...(result.items || []));
    if (items.length >= result.total_items || result.items.length === 0) return items;
    page += 1;
  }
}

export async function probeKeysAndPersist(
  baseUrl: string,
  managementKey: string | undefined,
  keys: APIKey[],
  providers: Provider[],
  concurrency = 3,
  options?: Omit<ProbeKeysOptions, 'baseUrl' | 'managementKey' | 'keys' | 'providers' | 'concurrency'>
): Promise<BatchProbeResult> {
  return probeKeysAndPersistWithOptions({
    baseUrl,
    managementKey,
    keys,
    providers,
    concurrency,
    ...options,
  });
}

export async function probeKeysAndPersistWithOptions(
  options: ProbeKeysOptions
): Promise<BatchProbeResult> {
  const {
    baseUrl,
    managementKey,
    providers,
    concurrency = 3,
    strategy = 'all',
    timeoutMs = 15000,
    userAgent = '',
    autoAction = 'status_only',
    signal,
    onProgress,
  } = options;

  const targets = filterKeysByProbeStrategy(options.keys, strategy);
  const progress: BatchProbeProgress = {
    phase: signal?.aborted ? 'cancelled' : 'probing',
    total: targets.length,
    current: 0,
    currentName: '',
    success: 0,
    failed: 0,
    skipped: 0,
    statusChanged: false,
    statusWriteFailed: 0,
    logs: [],
  };

  const emit = () => onProgress?.({ ...progress, logs: [...progress.logs] });
  emit();

  if (signal?.aborted) {
    return { ...progress, phase: 'cancelled', logs: [...progress.logs] };
  }
  if (targets.length === 0) {
    const done: BatchProbeResult = { ...progress, phase: 'done', logs: [...progress.logs] };
    onProgress?.(done);
    return done;
  }

  let cursor = 0;
  const statusUpdates = new Map<number, number[]>();
  const appendStatusUpdate = (status: number, keyId: number) => {
    const ids = statusUpdates.get(status) ?? [];
    ids.push(keyId);
    statusUpdates.set(status, ids);
  };

  const worker = async () => {
    while (cursor < targets.length) {
      if (signal?.aborted) return;
      const index = cursor;
      cursor += 1;
      const key = targets[index];
      progress.currentName = keyLabel(key);
      emit();

      const result = await runKeyAvailabilityProbe(
        key,
        providers,
        undefined,
        randomMathPrompt(),
        undefined,
        { timeoutMs, userAgent, signal }
      );
      let logResult: BatchProbeLogItem['result'] = 'failed';
      if (result.skipped) {
        progress.skipped += 1;
        logResult = 'skipped';
      } else if (result.ok && result.valid) {
        progress.success += 1;
        logResult = 'success';
      } else {
        progress.failed += 1;
        logResult = 'failed';
      }

      if (autoAction !== 'none') {
        let nextStatus = getProbeStatusAfterResult(key.status, result);
        if (autoAction === 'enable_disable' && !result.skipped) {
          if (result.ok && result.valid) {
            if (Number(key.status) === -2) nextStatus = nextStatus && nextStatus >= 1 ? nextStatus : 1;
            else if (nextStatus === null && Number(key.status) < 1) nextStatus = 1;
          } else {
            nextStatus = -2;
          }
        }
        if (nextStatus !== null && nextStatus !== key.status) {
          appendStatusUpdate(nextStatus, key.id);
        }
      }

      progress.logs.push({
        keyId: key.id,
        name: progress.currentName,
        result: logResult,
        message: result.message,
        statusCode: result.statusCode,
      });
      if (progress.logs.length > 300) {
        progress.logs.splice(0, progress.logs.length - 300);
      }
      progress.current += 1;
      emit();
    }
  };

  progress.phase = 'probing';
  emit();
  const workers = Math.max(1, Math.min(concurrency, targets.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  if (signal?.aborted) {
    const cancelled: BatchProbeResult = { ...progress, phase: 'cancelled', logs: [...progress.logs] };
    onProgress?.(cancelled);
    return cancelled;
  }

  progress.phase = 'persisting';
  progress.currentName = '';
  emit();

  if (autoAction !== 'none') {
    const updates = Array.from(statusUpdates, ([status, ids]) => ({ status, ids }));
    // The backend deliberately caps each bulk update at 500 IDs. A filtered
    // probe can produce thousands of IDs with the same status, so persist each
    // chunk independently instead of silently losing the whole status group.
    for (const update of updates) {
      for (const ids of chunkIds(update.ids)) {
        try {
          await batchToggleKeys(baseUrl, ids, update.status, managementKey);
          progress.statusChanged = true;
        } catch (error) {
          progress.statusWriteFailed += ids.length;
          progress.logs.push({
            keyId: 0,
            name: `status ${update.status}`,
            result: 'failed',
            message: `Failed to persist ${ids.length} status updates: ${formatCharitableApiError(error)}`,
          });
          if (progress.logs.length > 300) {
            progress.logs.splice(0, progress.logs.length - 300);
          }
          emit();
        }
      }
    }
  }

  const done: BatchProbeResult = { ...progress, phase: 'done', logs: [...progress.logs] };
  onProgress?.(done);
  return done;
}
