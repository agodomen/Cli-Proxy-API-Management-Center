import type { AccountImportItem } from '@/external/features/requestMonitor/accountImport/accountImportConverter';
import type { APIKey, AuthInfo, ProtocolKey } from './types';
import { computeApiType, parseApiType } from './utils';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
};

const SENSITIVE_INFO_KEYS = new Set([
  'api_key',
  'apikey',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'id_token',
  'idtoken',
  'session_token',
  'sessiontoken',
  'private_key',
  'privatekey',
  'authorization',
  'cookie',
  'cookies',
]);

const sanitizeAuthInfo = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeAuthInfo);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_INFO_KEYS.has(key.toLowerCase()))
      .map(([key, item]) => [key, sanitizeAuthInfo(item)])
  );
};

export const stableAuthJSON = (value: unknown) => JSON.stringify(stableValue(value));

export function parseAuthInfo(raw?: string, fallbackApiType = 1): AuthInfo {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    if (isRecord(parsed)) {
      const apiType = Number(parsed.api_type) || fallbackApiType;
      return {
        ...parsed,
        schema_version: 1,
        credential_type:
          typeof parsed.credential_type === 'string' ? parsed.credential_type : 'api_key',
        api_type: apiType,
        protocols: Array.isArray(parsed.protocols)
          ? parsed.protocols.filter((value): value is ProtocolKey => typeof value === 'string')
          : parseApiType(apiType),
      } as AuthInfo;
    }
  } catch {
    const legacy = Number(raw);
    if (Number.isFinite(legacy) && legacy > 0) fallbackApiType = legacy;
  }
  return {
    schema_version: 1,
    credential_type: 'api_key',
    api_type: fallbackApiType,
    protocols: parseApiType(fallbackApiType),
  };
}

export function buildAuthInfo(
  authType: number,
  protocols: ProtocolKey[],
  existing?: string,
  extra: Record<string, unknown> = {}
) {
  const credentialTypes: Record<number, AuthInfo['credential_type']> = {
    1: 'api_key',
    2: 'service_account',
    3: 'oauth2',
    4: 'oidc',
    5: 'api_key_set',
  };
  return stableAuthJSON(sanitizeAuthInfo({
    ...parseAuthInfo(existing, computeApiType(protocols)),
    ...extra,
    schema_version: 1,
    credential_type: credentialTypes[authType] ?? 'api_key',
    api_type: computeApiType(protocols),
    protocols,
  }));
}

const inferProtocols = (authJSON: Record<string, unknown>): ProtocolKey[] => {
  const type = firstString(authJSON.type, authJSON.provider).toLowerCase();
  if (type === 'claude' || type === 'anthropic') return ['anthropic'];
  if (type === 'gemini' || type === 'vertex' || type === 'aistudio') return ['gemini'];
  if (type === 'openai_responses' || type === 'responses') return ['openai_responses'];
  return ['openai'];
};

const inferAuthType = (authJSON: Record<string, unknown>) => {
  const explicit = firstString(authJSON.auth_kind, authJSON.authKind, authJSON.type).toLowerCase();
  if (
    explicit === 'service_account' ||
    firstString(authJSON.private_key, authJSON.privateKey, authJSON.client_email)
  ) {
    return 2;
  }
  if (Array.isArray(authJSON.api_keys) || Array.isArray(authJSON.keys)) return 5;
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
  if (firstString(authJSON.id_token, authJSON.idToken)) return 4;
  return firstString(authJSON.api_key, authJSON.apiKey, authJSON.key) ? 1 : 3;
};

const parseExpiry = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e11 ? value : value * 1000;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
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

export function buildImportedAuthDetail(
  item: AccountImportItem,
  existing?: Pick<APIKey, 'auth_index' | 'param' | 'probe_policy' | 'remark' | 'provider_id' | 'auth_info'> | null
): Partial<APIKey> {
  const authJSON = item.authJson;
  const authType = inferAuthType(authJSON);
  const protocols = inferProtocols(authJSON);
  const apiKey = firstString(authJSON.api_key, authJSON.apiKey, authJSON.key);
  const authValue = authType === 1 && apiKey ? apiKey : stableAuthJSON(authJSON);
  const priority = Number(authJSON.priority);
  const disabled = asBoolean(authJSON.disabled);
  // Import defaults to unknown (0) unless the payload explicitly carries disabled.
  const status = disabled === undefined ? 0 : disabled ? 0 : 1;
  const existingParam = existing?.param && existing.param !== '{}' ? existing.param : '';
  const existingProbe = existing?.probe_policy && existing.probe_policy !== '{}' ? existing.probe_policy : '';

  return {
    auth_index: existing?.auth_index || undefined,
    auth_type: authType,
    auth_value: authValue,
    auth_info: buildAuthInfo(authType, protocols, existing?.auth_info, {
      source: 'account_import',
      source_format: item.source,
      provider_type: firstString(authJSON.type, authJSON.provider),
      file_name: item.fileName,
      label: item.label,
      email: item.email,
      account_id: item.accountId,
      credential_hash: item.credentialHash,
    }),
    api_type: computeApiType(protocols),
    content: `Imported from ${item.source}: ${item.fileName}`,
    status,
    priority: Number.isFinite(priority) ? priority : 0,
    expires_at_ms: parseExpiry(authJSON.expired ?? authJSON.expires_at),
    probe_policy: existingProbe || '{}',
    param: existingParam || '{}',
    provider_id: existing?.provider_id ?? null,
    remark: existing?.remark || item.label,
  };
}
