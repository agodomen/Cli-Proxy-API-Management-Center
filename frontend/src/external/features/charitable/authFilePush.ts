import { authFilesApi } from '@/services/api/authFiles';
import { parseAuthInfo, stableAuthJSON } from './authInfo';
import { tryParseParamObject } from './components/ParamEditor/paramUtils';
import type { APIKey, Provider } from './types';

export type AuthFilePushPhase = 'preparing' | 'pushing' | 'done' | 'cancelled';

export interface AuthFilePushProgress {
  phase: AuthFilePushPhase;
  total: number;
  current: number;
  currentName: string;
  success: number;
  failed: number;
  skipped: number;
  failures: Array<{ name: string; error: string }>;
}

export interface AuthFilePushResult extends AuthFilePushProgress {
  phase: 'done' | 'cancelled';
}

export interface AuthFilePushMetadata {
  key: APIKey;
  fileName: string;
  managedHeaderKeys: string[];
  managedFields: string[];
  sourceModified?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const asHeaders = (value: unknown) => {
  if (!isRecord(value)) return {} as Record<string, string>;
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key.trim(), firstString(item)] as const)
      .filter(([key]) => Boolean(key))
  );
};

const headerKey = (value: string) => value.trim().toLowerCase();

const findHeaderName = (headers: Record<string, string>, name: string) => {
  const normalized = headerKey(name);
  return Object.keys(headers).find((key) => headerKey(key) === normalized);
};

const deleteHeader = (headers: Record<string, string>, name: string) => {
  const existing = findHeaderName(headers, name);
  if (existing) delete headers[existing];
};

const setHeader = (headers: Record<string, string>, name: string, value: string) => {
  const trimmedName = name.trim();
  if (!trimmedName) return;
  const existing = findHeaderName(headers, trimmedName);
  const targetName = existing || trimmedName;
  if (!value) {
    if (existing) delete headers[existing];
    return;
  }
  headers[targetName] = value;
};

const uniqueHeaderNames = (...groups: string[][]) => {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const group of groups) {
    for (const rawName of group) {
      const name = rawName.trim();
      const normalized = headerKey(name);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      names.push(name);
    }
  }
  return names;
};

const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => firstString(item)).filter(Boolean)
    : [];

const hasOwn = (value: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

const mergeHeaders = (
  base: Record<string, string>,
  providerHeaders: Record<string, string>,
  keyHeaders: Record<string, string>
) => {
  const merged: Record<string, string> = { ...base };
  for (const [key, value] of Object.entries(providerHeaders)) {
    setHeader(merged, key, value);
  }
  for (const [key, value] of Object.entries(keyHeaders)) {
    setHeader(merged, key, value);
  }
  return merged;
};

const buildHeadersPatch = (
  currentHeaders: Record<string, string>,
  nextHeaders: Record<string, string>
) => {
  const patch: Record<string, string> = {};
  for (const [name] of Object.entries(currentHeaders)) {
    if (!findHeaderName(nextHeaders, name)) patch[name] = '';
  }
  for (const [name, value] of Object.entries(nextHeaders)) {
    const currentName = findHeaderName(currentHeaders, name);
    const targetName = currentName || name;
    if (!currentName || currentHeaders[currentName] !== value) patch[targetName] = value;
  }
  return patch;
};

const safeFileName = (value: string) => {
  const base = value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) return '';
  return base.toLowerCase().endsWith('.json') ? base : `${base}.json`;
};

export function isAuthFileCredential(key: Pick<APIKey, 'auth_type' | 'auth_info'>) {
  const info = parseAuthInfo(key.auth_info);
  if (firstString(info.file_name)) return true;
  if (info.credential_type === 'oauth2' || info.credential_type === 'oidc' || info.credential_type === 'service_account') {
    return true;
  }
  return Number(key.auth_type) > 1;
}

export function resolveAuthFileName(key: Pick<APIKey, 'auth_index' | 'auth_info'>) {
  const info = parseAuthInfo(key.auth_info);
  const fromInfo = safeFileName(firstString(info.file_name));
  if (fromInfo) return fromInfo;
  const fromIndex = safeFileName(firstString(key.auth_index));
  return fromIndex;
}

export function buildAuthFilePushPayload(options: {
  key: APIKey;
  provider?: Provider | null;
}): { fileName: string; payload: Record<string, unknown>; disabled: boolean } {
  const { key, provider } = options;
  const fileName = resolveAuthFileName(key);
  if (!fileName) {
    throw new Error('auth_file_name_required');
  }

  const rawValue = firstString(key.auth_value, key.api_key);
  let base: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawValue || '{}') as unknown;
    if (!isRecord(parsed)) throw new Error('invalid');
    base = { ...parsed };
  } catch {
    throw new Error('auth_value_invalid_json');
  }

  const keyParam = tryParseParamObject(key.param || '{}') ?? {};
  const providerParam = tryParseParamObject(provider?.param || '{}') ?? {};
  const baseHeaders = asHeaders(base.headers);
  const providerHeaders = asHeaders(providerParam.headers);
  const keyHeaders = asHeaders(keyParam.headers);
  const headers = mergeHeaders(baseHeaders, providerHeaders, keyHeaders);

  if (Object.keys(headers).length > 0) base.headers = headers;
  else delete base.headers;

  const proxyUrl =
    firstString(keyParam.proxy_url, keyParam.proxyUrl) ||
    firstString(providerParam.proxy_url, providerParam.proxyUrl) ||
    firstString(base.proxy_url, base.proxyUrl);
  if (proxyUrl) {
    base.proxy_url = proxyUrl;
  } else {
    delete base.proxy_url;
    delete base.proxyUrl;
  }

  const prefix =
    firstString(keyParam.prefix) ||
    firstString(providerParam.prefix) ||
    firstString(base.prefix);
  if (prefix) base.prefix = prefix;
  else delete base.prefix;

  base.priority = Number.isFinite(key.priority) ? key.priority : 0;
  const disabled = !(Number(key.status) >= 1);
  base.disabled = disabled;

  const info = parseAuthInfo(key.auth_info);
  if (!firstString(base.type) && firstString(info.provider_type)) {
    base.type = info.provider_type;
  }

  return {
    fileName,
    payload: base,
    disabled,
  };
}

export function buildAuthFileFieldsPatch(options: {
  key: APIKey;
  provider?: Provider | null;
  currentAuthJSON: Record<string, unknown>;
}): {
  fields: {
    headers?: Record<string, string>;
    proxy_url?: string;
    prefix?: string;
    priority: number;
  };
  managedHeaderKeys: string[];
  managedFields: string[];
} {
  const { key, provider, currentAuthJSON } = options;
  const info = parseAuthInfo(key.auth_info);
  const previousManagedHeaderKeys = stringArray(
    info.managed_header_keys ?? info.managedHeaderKeys
  );
  const previousManagedFields = new Set(
    stringArray(info.managed_auth_file_fields ?? info.managedAuthFileFields)
  );
  const keyParam = tryParseParamObject(key.param || '{}') ?? {};
  const providerParam = tryParseParamObject(provider?.param || '{}') ?? {};

  const currentHeaders = asHeaders(currentAuthJSON.headers);
  const baselineHeaders = { ...currentHeaders };
  previousManagedHeaderKeys.forEach((name) => deleteHeader(baselineHeaders, name));

  const providerHeaders = asHeaders(providerParam.headers);
  const keyHeaders = asHeaders(keyParam.headers);
  const nextHeaders = mergeHeaders(baselineHeaders, providerHeaders, keyHeaders);
  const headersPatch = buildHeadersPatch(currentHeaders, nextHeaders);
  const managedHeaderKeys = uniqueHeaderNames(
    Object.keys(providerHeaders),
    Object.keys(keyHeaders)
  );

  const fields: {
    headers?: Record<string, string>;
    proxy_url?: string;
    prefix?: string;
    priority: number;
  } = {
    priority: Number.isFinite(key.priority) ? key.priority : 0,
  };
  if (Object.keys(headersPatch).length > 0) fields.headers = headersPatch;

  const managedFields: string[] = [];
  const keyHasProxy = hasOwn(keyParam, 'proxy_url') || hasOwn(keyParam, 'proxyUrl');
  const providerHasProxy = hasOwn(providerParam, 'proxy_url') || hasOwn(providerParam, 'proxyUrl');
  if (keyHasProxy || providerHasProxy) {
    fields.proxy_url =
      firstString(keyParam.proxy_url, keyParam.proxyUrl) ||
      firstString(providerParam.proxy_url, providerParam.proxyUrl);
    managedFields.push('proxy_url');
  } else if (previousManagedFields.has('proxy_url')) {
    fields.proxy_url = '';
  }

  const keyHasPrefix = hasOwn(keyParam, 'prefix');
  const providerHasPrefix = hasOwn(providerParam, 'prefix');
  if (keyHasPrefix || providerHasPrefix) {
    fields.prefix = firstString(keyParam.prefix) || firstString(providerParam.prefix);
    managedFields.push('prefix');
  } else if (previousManagedFields.has('prefix')) {
    fields.prefix = '';
  }

  return { fields, managedHeaderKeys, managedFields };
}

const getStatusCode = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : undefined;
};

const readAuthFileModified = async (fileName: string) => {
  try {
    const listed = await authFilesApi.list();
    const file = (listed.files || []).find((item) => firstString(item.name) === fileName);
    const candidates = [file?.modified, file?.modtime, file?.updated_at];
    for (const value of candidates) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim()) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  } catch {
    // Source timestamp is diagnostic metadata only.
  }
  return undefined;
};

export async function pushAuthDetailToAuthFile(options: {
  key: APIKey;
  provider?: Provider | null;
  sourceModified?: number;
  onPushed?: (payload: AuthFilePushMetadata) => Promise<void> | void;
}): Promise<{ fileName: string }> {
  const fileName = resolveAuthFileName(options.key);
  if (!fileName) throw new Error('auth_file_name_required');

  let managedHeaderKeys: string[] = [];
  let managedFields: string[] = [];
  let sourceModified = options.sourceModified;
  try {
    const currentAuthJSON = await authFilesApi.downloadJsonObject(fileName);
    const built = buildAuthFileFieldsPatch({
      key: options.key,
      provider: options.provider,
      currentAuthJSON,
    });
    managedHeaderKeys = built.managedHeaderKeys;
    managedFields = built.managedFields;
    await authFilesApi.patchFields(fileName, built.fields);
    sourceModified ??= await readAuthFileModified(fileName);
  } catch (error) {
    if (getStatusCode(error) !== 404) throw error;
    const built = buildAuthFilePushPayload(options);
    managedHeaderKeys = uniqueHeaderNames(
      Object.keys(asHeaders((tryParseParamObject(options.provider?.param || '{}') ?? {}).headers)),
      Object.keys(asHeaders((tryParseParamObject(options.key.param || '{}') ?? {}).headers))
    );
    const keyParam = tryParseParamObject(options.key.param || '{}') ?? {};
    const providerParam = tryParseParamObject(options.provider?.param || '{}') ?? {};
    if (hasOwn(keyParam, 'proxy_url') || hasOwn(keyParam, 'proxyUrl') || hasOwn(providerParam, 'proxy_url') || hasOwn(providerParam, 'proxyUrl')) {
      managedFields.push('proxy_url');
    }
    if (hasOwn(keyParam, 'prefix') || hasOwn(providerParam, 'prefix')) managedFields.push('prefix');
    await authFilesApi.saveJsonObject(built.fileName, built.payload);
  }

  const disabled = !(Number(options.key.status) >= 1);
  try {
    await authFilesApi.setStatus(fileName, disabled);
  } catch {
    // Some backends only honor disabled in file content; ignore status patch failure.
  }
  if (options.onPushed) {
    await options.onPushed({
      key: options.key,
      fileName,
      managedHeaderKeys,
      managedFields,
      sourceModified,
    });
  }
  return { fileName };
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

export async function pushAuthDetailsToAuthFiles(options: {
  keys: APIKey[];
  providers: Provider[];
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: AuthFilePushProgress) => void;
  onPushed?: (payload: AuthFilePushMetadata) => Promise<void> | void;
}): Promise<AuthFilePushResult> {
  const { keys, providers, concurrency = 3, signal, onProgress, onPushed } = options;
  const providerMap = new Map(providers.map((item) => [item.provider_id, item]));

  const emit = (progress: AuthFilePushProgress) => onProgress?.(progress);
  const progress: AuthFilePushProgress = {
    phase: 'preparing',
    total: keys.length,
    current: 0,
    currentName: '',
    success: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  };
  emit({ ...progress });

  if (signal?.aborted) {
    return { ...progress, phase: 'cancelled' };
  }

  progress.phase = 'pushing';
  emit({ ...progress });

  await mapWithConcurrency(keys, concurrency, async (key) => {
    if (signal?.aborted) return;
    const info = parseAuthInfo(key.auth_info);
    const nameHint = firstString(info.file_name, key.auth_index) || `#${key.id}`;
    progress.currentName = nameHint;
    emit({ ...progress, failures: [...progress.failures] });

    try {
      if (!isAuthFileCredential(key)) {
        progress.skipped += 1;
        return;
      }
      const provider = key.provider_id ? providerMap.get(key.provider_id) : undefined;
      const result = await pushAuthDetailToAuthFile({ key, provider, onPushed });
      progress.currentName = result.fileName;
      progress.success += 1;
    } catch (error) {
      progress.failed += 1;
      progress.failures.push({
        name: nameHint,
        error: error instanceof Error ? error.message : String(error || 'push_failed'),
      });
    } finally {
      progress.current += 1;
      emit({ ...progress, failures: [...progress.failures] });
    }
  });

  const result: AuthFilePushResult = {
    ...progress,
    phase: signal?.aborted ? 'cancelled' : 'done',
    failures: [...progress.failures],
  };
  emit(result);
  return result;
}


export interface AuthFileRequestConfigPreview {
  fileName: string;
  accountLabel: string;
  managedHeaderKeys: string[];
  headerChanges: Array<{ name: string; from: string; to: string }>;
  proxyUrl?: string;
  prefix?: string;
  priority: number;
  disabled: boolean;
  mode: 'patch' | 'create';
}

/** Preview field-level request-config changes without writing tokens. */
export function previewAuthFileRequestConfig(options: {
  key: APIKey;
  provider?: Provider | null;
  currentAuthJSON?: Record<string, unknown> | null;
}): AuthFileRequestConfigPreview {
  const fileName = resolveAuthFileName(options.key);
  const info = parseAuthInfo(options.key.auth_info);
  const accountLabel =
    firstString(info.label, info.email, info.file_name, options.key.auth_index, options.key.remark) ||
    fileName ||
    `#${options.key.id}`;
  const disabled = !(Number(options.key.status) >= 1);

  // When live CPA JSON is unavailable, synthesize a baseline that only includes
  // previously managed headers so preview still shows removals/additions.
  const currentAuthJSON =
    options.currentAuthJSON && isRecord(options.currentAuthJSON)
      ? options.currentAuthJSON
      : {
          headers: Object.fromEntries(
            stringArray(info.managed_header_keys ?? info.managedHeaderKeys).map((name) => [
              name,
              '(managed)',
            ])
          ),
        };

  const built = buildAuthFileFieldsPatch({
    key: options.key,
    provider: options.provider,
    currentAuthJSON,
  });
  const currentHeaders = asHeaders(currentAuthJSON.headers);
  const headerChanges: AuthFileRequestConfigPreview['headerChanges'] = [];
  for (const [name, value] of Object.entries(built.fields.headers || {})) {
    const currentName = findHeaderName(currentHeaders, name);
    const from = currentName ? currentHeaders[currentName] : '';
    headerChanges.push({ name, from, to: value });
  }

  return {
    fileName,
    accountLabel,
    managedHeaderKeys: built.managedHeaderKeys,
    headerChanges,
    proxyUrl: built.fields.proxy_url,
    prefix: built.fields.prefix,
    priority: built.fields.priority,
    disabled,
    mode: 'patch',
  };
}

export function summarizeAuthFilePushSelection(keys: APIKey[]) {
  const authFiles = keys.filter((key) => isAuthFileCredential(key));
  return {
    total: keys.length,
    pushable: authFiles.length,
    skipped: Math.max(0, keys.length - authFiles.length),
  };
}

// Keep helper exported for diagnostics/tests.

export function stampAuthInfoPushedAt(
  authInfoRaw: string | undefined,
  fileName?: string,
  metadata?: Pick<AuthFilePushMetadata, 'managedHeaderKeys' | 'managedFields' | 'sourceModified'>
) {
  const info = parseAuthInfo(authInfoRaw);
  // Prefer managed_header_keys / last_pushed_at / source_modtime metadata.
  // source_modified is retained as a legacy alias for older rows.
  const previousManagedHeaders = stringArray(
    info.managed_header_keys ?? info.managedHeaderKeys
  );
  const previousManagedFields = stringArray(
    info.managed_auth_file_fields ?? info.managedAuthFileFields
  );
  const next = {
    ...info,
    schema_version: 1 as const,
    last_pushed_at: Date.now(),
    managed_header_keys: metadata?.managedHeaderKeys ?? previousManagedHeaders,
    managed_auth_file_fields: metadata?.managedFields ?? previousManagedFields,
  };
  if (fileName) next.file_name = fileName;
  if (metadata?.sourceModified != null) {
    next.source_modtime = metadata.sourceModified;
    next.source_modified = metadata.sourceModified;
  }
  return stableAuthJSON(next);
}

export function getAuthFileDisplayMeta(key: Pick<APIKey, 'auth_type' | 'auth_info'>) {
  const info = parseAuthInfo(key.auth_info);
  const fileName = firstString(info.file_name);
  const providerType = firstString(info.provider_type);
  const isAuthFile = isAuthFileCredential(key);
  const lastPushedAt = Number(info.last_pushed_at);
  return {
    isAuthFile,
    fileName,
    providerType,
    credentialType: info.credential_type,
    lastPushedAt: Number.isFinite(lastPushedAt) && lastPushedAt > 0 ? lastPushedAt : null,
  };
}

export const __test__ = {
  mergeHeaders,
  buildHeadersPatch,
  stableAuthJSON,
  asHeaders,
};
