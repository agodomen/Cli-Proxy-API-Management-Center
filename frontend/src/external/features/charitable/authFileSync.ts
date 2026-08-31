import { authFilesApi } from '@/external/services/api/authFiles';
import type { AuthFileItem } from '@/types/authFile';
import { createProvider, formatCharitableApiError, queryKeyByFileName, queryKeyByIndex, upsertKey } from './api';
import { buildAuthInfo, parseAuthInfo, stableAuthJSON } from './authInfo';
import {
  ensureProviderForCredential,
  findLatestProviderByBaseUrl,
  matchProviderForCredential,
  normalizeProviderBaseUrl,
  resolveImportedProvider,
  type ImportedProviderDescriptor,
} from './providerCatalog';
import type { APIKey, Provider, ProtocolKey } from './types';
import { computeApiType } from './utils';

export type AuthFileSyncPhase = 'listing' | 'syncing' | 'done' | 'cancelled';

export interface AuthFileSyncProgress {
  phase: AuthFileSyncPhase;
  total: number;
  current: number;
  currentName: string;
  created: number;
  updated: number;
  failed: number;
  skipped: number;
  unmatchedProvider: number;
  providersCreated: number;
  failures: Array<{ name: string; error: string }>;
}

export interface AuthFileSyncResult extends AuthFileSyncProgress {
  phase: 'done' | 'cancelled';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
};

const firstNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
};

const asBoolean = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return undefined;
};

const safeFileName = (value: string) => {
  const base = value
    .replace(/[\\/:*?\"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) return '';
  return base.toLowerCase().endsWith('.json') ? base : `${base}.json`;
};

const inferAuthType = (authJSON: Record<string, unknown>, providerType: string) => {
  const explicit = firstString(authJSON.auth_kind, authJSON.authKind, authJSON.type, providerType).toLowerCase();
  if (
    explicit === 'service_account' ||
    firstString(authJSON.private_key, authJSON.privateKey, authJSON.client_email)
  ) {
    return 2;
  }
  if (Array.isArray(authJSON.api_keys) || Array.isArray(authJSON.keys)) return 5;
  if (firstString(authJSON.id_token, authJSON.idToken) && !firstString(authJSON.access_token, authJSON.accessToken)) {
    return 4;
  }
  if (
    firstString(
      authJSON.access_token,
      authJSON.accessToken,
      authJSON.refresh_token,
      authJSON.refreshToken,
      authJSON.session_token,
      authJSON.sessionToken,
      authJSON.cookie
    )
  ) {
    return 3;
  }
  if (firstString(authJSON.api_key, authJSON.apiKey, authJSON.key)) return 1;
  return 3;
};

const inferProtocols = (providerType: string): ProtocolKey[] => {
  const type = providerType.toLowerCase();
  if (type === 'claude' || type === 'anthropic') return ['anthropic'];
  if (type === 'gemini' || type === 'vertex' || type === 'aistudio' || type === 'antigravity') {
    return ['gemini'];
  }
  if (type === 'openai_responses' || type === 'responses') return ['openai_responses'];
  return ['openai'];
};

const extractOperationalParam = (authJSON: Record<string, unknown>) => {
  const param: Record<string, unknown> = {};
  const headers = authJSON.headers;
  if (isRecord(headers)) {
    const normalized = Object.fromEntries(
      Object.entries(headers)
        .map(([key, value]) => [key.trim(), firstString(value)] as const)
        .filter(([key, value]) => key && value)
    );
    if (Object.keys(normalized).length > 0) param.headers = normalized;
  }
  const proxyUrl = firstString(authJSON.proxy_url, authJSON.proxyUrl);
  if (proxyUrl) param.proxy_url = proxyUrl;
  const prefix = firstString(authJSON.prefix);
  if (prefix) param.prefix = prefix;
  return param;
};

const mapDisabledToStatus = (disabled: boolean | undefined) => (disabled ? 0 : 1);

export function resolveAuthFileProviderContext(options: {
  file: AuthFileItem;
  authJSON: Record<string, unknown>;
}): {
  fileName: string;
  providerType: string;
  descriptor: ImportedProviderDescriptor;
  baseUrl: string;
  fileRecord: AuthFileItem & {
    email?: string;
    account?: string;
    auth_index?: string | number | null;
    priority?: number;
    note?: string;
  };
} {
  const { file, authJSON } = options;
  const fileName = safeFileName(firstString(file.name, authJSON.name) || 'auth-file.json');
  const providerType = firstString(authJSON.type, authJSON.provider, file.type, file.provider, 'unknown').toLowerCase();
  const fileRecord = file as AuthFileItem & {
    email?: string;
    account?: string;
    auth_index?: string | number | null;
    priority?: number;
    note?: string;
  };
  const descriptor = resolveImportedProvider(
    {
      fileName,
      authJson: {
        ...authJSON,
        type: providerType || authJSON.type,
        provider: providerType || authJSON.provider,
      },
      source: 'cpa',
      label: firstString(file.label, authJSON.label, authJSON.email, fileName),
      email: firstString(fileRecord.email, authJSON.email) || undefined,
      accountId: firstString(fileRecord.account, authJSON.account_id, authJSON.accountId) || undefined,
      credentialHash: '',
    },
    'auto'
  );
  const baseUrl =
    firstString(authJSON.base_url, authJSON.baseUrl, authJSON.api_base, authJSON.apiBase) ||
    descriptor.baseUrl ||
    '';
  return { fileName, providerType, descriptor, baseUrl, fileRecord };
}

export function buildAuthFileSyncDetail(options: {
  file: AuthFileItem;
  authJSON: Record<string, unknown>;
  providers: Provider[];
  existing?: APIKey | null;
  /** When set (after ensure), bind this provider instead of re-matching. */
  provider?: Provider | null;
}): { detail: Partial<APIKey>; unmatchedProvider: boolean; descriptor: ImportedProviderDescriptor; baseUrl: string } {
  const { file, authJSON, providers, existing, provider } = options;
  const { fileName, providerType, descriptor, baseUrl, fileRecord } = resolveAuthFileProviderContext({
    file,
    authJSON,
  });
  const matchedProvider =
    provider ||
    matchProviderForCredential(providers, descriptor, baseUrl) ||
    findLatestProviderByBaseUrl(providers, baseUrl);

  const authType = inferAuthType(authJSON, providerType);
  const protocols = inferProtocols(providerType || descriptor.type);
  const authIndex =
    firstString(file.authIndex, fileRecord.auth_index, authJSON.auth_index, authJSON.authIndex) ||
    existing?.auth_index ||
    '';

  const existingInfo = parseAuthInfo(existing?.auth_info);
  const authInfo = buildAuthInfo(authType, protocols, existing?.auth_info, {
    source: 'auth_file_sync',
    provider_type: providerType || descriptor.type,
    file_name: fileName,
    label: firstString(file.label, authJSON.label, authJSON.email, existingInfo.label),
    email: firstString(fileRecord.email, authJSON.email, existingInfo.email),
    account_id: firstString(fileRecord.account, authJSON.account_id, authJSON.accountId, existingInfo.account_id),
    base_url: baseUrl || existingInfo.base_url,
    last_synced_at: Date.now(),
  });

  const disabled = asBoolean(file.disabled) ?? asBoolean(authJSON.disabled) ?? false;
  const priority = firstNumber(fileRecord.priority, authJSON.priority, existing?.priority) ?? 0;
  const extractedParam = extractOperationalParam(authJSON);
  const existingParamRaw = existing?.param && existing.param !== '{}' ? existing.param : '';
  const param = existingParamRaw || stableAuthJSON(extractedParam);

  return {
    unmatchedProvider: !matchedProvider && Boolean(normalizeProviderBaseUrl(baseUrl) || descriptor.baseUrl),
    descriptor,
    baseUrl,
    detail: {
      auth_index: authIndex || undefined,
      auth_type: authType,
      auth_value: stableAuthJSON(authJSON),
      auth_info: authInfo,
      api_type: computeApiType(protocols),
      content: `Synced from auth file: ${fileName}`,
      status: mapDisabledToStatus(disabled),
      priority,
      probe_policy: existing?.probe_policy || '{}',
      param,
      provider_id: matchedProvider?.provider_id ?? existing?.provider_id ?? null,
      remark: existing?.remark || firstString(fileRecord.note, authJSON.note) || undefined,
    },
  };
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      await worker(items[current], current);
    }
  };
  await Promise.all(Array.from({ length: limit }, () => run()));
}

export async function syncAuthFilesToKeys(options: {
  serviceBase: string;
  managementKey?: string;
  providers: Provider[];
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: AuthFileSyncProgress) => void;
}): Promise<AuthFileSyncResult> {
  const {
    serviceBase,
    managementKey,
    providers,
    concurrency = 1,
    signal,
    onProgress,
  } = options;

  const emit = (progress: AuthFileSyncProgress) => {
    onProgress?.(progress);
  };

  const empty: AuthFileSyncProgress = {
    phase: 'listing',
    total: 0,
    current: 0,
    currentName: '',
    created: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    unmatchedProvider: 0,
    providersCreated: 0,
    failures: [],
  };
  emit(empty);

  if (signal?.aborted) {
    return { ...empty, phase: 'cancelled' };
  }

  const listed = await authFilesApi.list();
  const files = (listed.files || []).filter((file) => firstString(file.name));
  const progress: AuthFileSyncProgress = {
    phase: 'syncing',
    total: files.length,
    current: 0,
    currentName: '',
    created: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    unmatchedProvider: 0,
    providersCreated: 0,
    failures: [],
  };
  const providerPool = [...providers];
  const providerCreateLocks = new Map<string, Promise<Provider | undefined>>();
  emit({ ...progress });

  if (files.length === 0) {
    const done: AuthFileSyncResult = { ...progress, phase: 'done' };
    emit(done);
    return done;
  }

  await mapWithConcurrency(files, concurrency, async (file) => {
    if (signal?.aborted) return;
    const name = firstString(file.name);
    progress.currentName = name;
    emit({ ...progress, failures: [...progress.failures] });

    try {
      if (!name) {
        progress.skipped += 1;
        return;
      }

      let authJSON: Record<string, unknown>;
      try {
        const downloaded = await authFilesApi.downloadJsonObject(name);
        if (!isRecord(downloaded)) {
          throw new Error('auth_file_invalid_json');
        }
        authJSON = downloaded;
      } catch (error) {
        throw new Error(`download: ${formatCharitableApiError(error, 'auth_file_download_failed')}`);
      }

      let existing: APIKey | null = null;
      const authIndex = firstString(
        file.authIndex,
        (file as { auth_index?: string }).auth_index,
        authJSON.auth_index,
        authJSON.authIndex
      );
      if (authIndex) {
        try {
          existing = await queryKeyByIndex(serviceBase, authIndex, managementKey);
        } catch {
          existing = null;
        }
      }
      // When auth_index is absent or not found, fall back to auth_info.file_name so
      // re-syncing the same CPA file updates the center row instead of inserting a
      // new MD5-based identity after token refresh.
      if (!existing) {
        try {
          existing = await queryKeyByFileName(serviceBase, name, managementKey);
        } catch {
          existing = null;
        }
      }

      const providerContext = resolveAuthFileProviderContext({ file, authJSON });
      let providerCreateError = '';
      const ensured = await ensureProviderForCredential(
        providerPool,
        providerContext.descriptor,
        {
          // Only force URL match for credential-provided base_url; profile defaults
          // are used for create + name alias reuse, not cross-type host matching.
          preferredBaseUrl: providerContext.descriptor.hasExplicitBaseUrl
            ? providerContext.baseUrl
            : undefined,
          createLocks: providerCreateLocks,
          createProvider: async (input) => {
            try {
              return await createProvider(serviceBase, input, managementKey);
            } catch (error) {
              // Soft-fail: still import the credential without a provider binding.
              providerCreateError = formatCharitableApiError(error, 'provider_create_failed');
              throw error;
            }
          },
        }
      );
      if (ensured.created) progress.providersCreated += 1;
      if (!ensured.provider && !providerCreateError) {
        // No base_url or no match/create path — still importable, just unmatched.
      }

      const built = buildAuthFileSyncDetail({
        file,
        authJSON,
        providers: providerPool,
        existing,
        provider: ensured.provider,
      });
      // Preserve the center business key when the file did not carry auth_index.
      if (!firstString(built.detail.auth_index) && existing?.auth_index) {
        built.detail.auth_index = existing.auth_index;
      }
      const upsertWithRetry = async (payload: Partial<APIKey>) => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            return await upsertKey(serviceBase, payload, managementKey);
          } catch (error) {
            lastError = error;
            const message = formatCharitableApiError(error, 'upsert_failed').toLowerCase();
            const retriable =
              message.includes('locked') ||
              message.includes('busy') ||
              message.includes('request_failed') ||
              message.includes('status code 500') ||
              message.includes('http 500');
            if (!retriable || attempt === 3) throw error;
            await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
          }
        }
        throw lastError;
      };

      try {
        const result = await upsertWithRetry(built.detail);
        if (result.operation === 'created') progress.created += 1;
        else progress.updated += 1;
        if (built.unmatchedProvider || !ensured.provider) progress.unmatchedProvider += 1;
        // Soft warning: credential imported, but provider auto-create failed.
        if (providerCreateError) {
          progress.failures.push({
            name,
            error: `imported_without_provider: ${providerCreateError}`,
          });
        }
      } catch (error) {
        // Retry once without provider_id if FK/provider binding caused the write to fail.
        const message = formatCharitableApiError(error, 'upsert_failed');
        if (built.detail.provider_id != null) {
          try {
            const retry = await upsertWithRetry({ ...built.detail, provider_id: null });
            if (retry.operation === 'created') progress.created += 1;
            else progress.updated += 1;
            progress.unmatchedProvider += 1;
            progress.failures.push({
              name,
              error: `imported_without_provider: ${message}`,
            });
          } catch (retryError) {
            throw new Error(`upsert: ${formatCharitableApiError(retryError, message)}`);
          }
        } else {
          throw new Error(`upsert: ${message}`);
        }
      }
    } catch (error) {
      progress.failed += 1;
      progress.failures.push({
        name,
        error: formatCharitableApiError(error, 'sync_failed'),
      });
    } finally {
      progress.current += 1;
      emit({ ...progress, failures: [...progress.failures] });
    }
  });

  const result: AuthFileSyncResult = {
    ...progress,
    phase: signal?.aborted ? 'cancelled' : 'done',
    failures: [...progress.failures],
  };
  emit(result);
  return result;
}

