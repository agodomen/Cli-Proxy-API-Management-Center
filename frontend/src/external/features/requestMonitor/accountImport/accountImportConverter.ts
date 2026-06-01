import {
  convertAuthJsonInput,
  getDefaultSessionAuthFileName,
  type AuthJsonInputType,
} from '@/external/features/authFiles/sessionAuthConverter';
import { sha256Hex } from '@/external/utils/apiKeyHash';

export type AccountImportFormat = 'auto' | 'sub2api' | 'cpa-single' | 'cpa-multi' | 'session';

export type AccountImportSource = 'sub2api' | 'cpa' | 'cpa-multi' | 'session' | 'mixed';

export type AccountImportTargetType =
  | 'auto'
  | 'codex'
  | 'xai'
  | 'claude'
  | 'gemini'
  | 'antigravity'
  | 'kimi'
  | 'qwen'
  | 'iflow'
  | 'vertex'
  | 'aistudio';

export const ACCOUNT_IMPORT_TARGET_TYPES: AccountImportTargetType[] = [
  'auto',
  'codex',
  'xai',
  'claude',
  'gemini',
  'antigravity',
  'kimi',
  'qwen',
  'iflow',
  'vertex',
  'aistudio',
];

export type AccountImportItem = {
  fileName: string;
  authJson: Record<string, unknown>;
  source: AccountImportSource;
  label: string;
  email?: string;
  accountId?: string;
  credentialHash: string;
};

export type InputMode =
  | 'single-file'
  | 'single-object'
  | 'multi-file'
  | 'multi-object-array'
  | 'mixed';

export type AccountImportPreviewMeta = {
  detectedFormat: AccountImportSource;
  targetFormat: AccountImportTargetType;
  fileCount: number;
  accountCount: number;
  inputMode: InputMode;
  sourceFormat: AccountImportFormat;
};

export type AccountImportResult = {
  detectedFormat: AccountImportSource;
  items: AccountImportItem[];
  warnings: string[];
  meta: AccountImportPreviewMeta;
};

type JsonRecord = Record<string, unknown>;

const MAX_IMPORT_JSON_CHARS = 50_000_000;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
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

const parseJson = (text: string): unknown => {
  if (text.length > MAX_IMPORT_JSON_CHARS) {
    throw new Error('Import JSON input exceeds 50MB size limit');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Invalid JSON');
  }
};

const normalizeTimestamp = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();

  const numberValue = firstNumber(value);
  if (numberValue !== undefined) {
    const date = new Date(numberValue > 1e11 ? numberValue : numberValue * 1000);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  const stringValue = firstString(value);
  if (!stringValue) return undefined;
  const date = new Date(stringValue);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const decodeBase64UrlJson = (value: string): JsonRecord | undefined => {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as unknown;
    return isRecord(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
};

const isUnsafeJwt = (token: unknown) => {
  if (typeof token !== 'string' || !token.trim()) return false;
  const segments = token.split('.');
  if (segments.length !== 3) return false;
  const header = decodeBase64UrlJson(segments[0]);
  const unsigned = typeof header?.alg === 'string' && header.alg.toLowerCase() === 'none';
  const emptySignature =
    segments[0].trim() !== '' && segments[1].trim() !== '' && segments[2].trim() === '';
  return unsigned || emptySignature;
};

const sanitizeUnsupportedIdTokens = (value: unknown): { value: unknown; removedCount: number } => {
  if (Array.isArray(value)) {
    let removedCount = 0;
    const next = value.map((item) => {
      const sanitized = sanitizeUnsupportedIdTokens(item);
      removedCount += sanitized.removedCount;
      return sanitized.value;
    });
    return { value: next, removedCount };
  }

  if (!isRecord(value)) {
    return { value, removedCount: 0 };
  }

  let removedCount = 0;
  const nextEntries = Object.entries(value).flatMap(([key, item]) => {
    const normalizedKey = key.toLowerCase();
    if ((normalizedKey === 'id_token' || normalizedKey === 'idtoken') && isUnsafeJwt(item)) {
      removedCount += 1;
      return [];
    }

    const sanitized = sanitizeUnsupportedIdTokens(item);
    removedCount += sanitized.removedCount;
    return [[key, sanitized.value] as const];
  });

  return {
    value: Object.fromEntries(nextEntries),
    removedCount,
  };
};

const safeFileBase = (value: string) => {
  const safe = value
    .replace(/\.json$/iu, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[^a-z0-9._@+-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 96);
  return safe || 'codex-account';
};

const buildStableFileName = (authJson: JsonRecord, fallback = 'codex-account') => {
  const identity =
    firstString(
      authJson.email,
      authJson.name,
      authJson.chatgpt_account_id,
      authJson.account_id,
      fallback
    ) ?? fallback;
  const accountId = firstString(authJson.chatgpt_account_id, authJson.account_id);
  const suffix = accountId ? `-${accountId.slice(0, 12)}` : '';
  const type = firstString(authJson.type)?.toLowerCase() || 'codex';
  return `${safeFileBase(`${identity}${suffix}`)}.${type}.json`;
};

const buildCredentialHash = (authJson: JsonRecord) =>
  sha256Hex(
    [
      firstString(authJson.type),
      firstString(authJson.chatgpt_account_id, authJson.account_id),
      firstString(authJson.email),
      firstString(authJson.access_token),
      firstString(authJson.api_key, authJson.key),
      firstString(authJson.session_token),
    ]
      .filter(Boolean)
      .join('::')
  );

const buildItem = (
  authJson: JsonRecord,
  source: AccountImportSource,
  fallbackFileName?: string
): AccountImportItem => {
  const fileName = fallbackFileName ?? buildStableFileName(authJson);
  const email = firstString(authJson.email);
  const accountId = firstString(authJson.chatgpt_account_id, authJson.account_id);
  const label = firstString(email, authJson.name, accountId, fileName) ?? fileName;

  return {
    fileName,
    authJson: { ...authJson, disabled: false },
    source,
    label,
    email,
    accountId,
    credentialHash: buildCredentialHash(authJson),
  };
};

const applyImportOverrides = (
  authJson: JsonRecord,
  headers?: Record<string, string> | null,
  proxyUrl?: string | null,
  priority?: number | null
): JsonRecord => {
  const next = { ...authJson };

  if (headers && Object.keys(headers).length > 0) {
    const existing = isRecord(next.headers) ? (next.headers as Record<string, unknown>) : {};
    const merged = { ...existing };
    Object.entries(headers).forEach(([key, value]) => {
      if (typeof value === 'string' && value.trim() === '') {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    });
    next.headers = merged;
  }

  if (proxyUrl && proxyUrl.trim()) {
    next.proxy_url = proxyUrl.trim();
  }

  if (priority !== null && priority !== undefined) {
    next.priority = priority;
  }

  return next;
};

const isSupportedTargetType = (
  value: string | undefined
): value is Exclude<AccountImportTargetType, 'auto'> =>
  Boolean(value) &&
  ACCOUNT_IMPORT_TARGET_TYPES.includes(value as AccountImportTargetType) &&
  value !== 'auto';

const detectAuthTypeFromRecord = (record: JsonRecord): Exclude<AccountImportTargetType, 'auto'> => {
  const explicitType = firstString(record.type, record.provider, record.auth_type)?.toLowerCase();
  if (isSupportedTargetType(explicitType)) {
    return explicitType;
  }

  const authKind = firstString(record.auth_kind, record.authKind)?.toLowerCase();
  const baseUrl =
    firstString(
      record.base_url,
      record.baseUrl,
      record.token_endpoint,
      record.tokenEndpoint
    )?.toLowerCase() || '';
  const headers = isRecord(record.headers) ? record.headers : {};
  const headerBlob = Object.entries(headers)
    .map(([key, value]) => `${key}:${String(value ?? '')}`)
    .join(' ')
    .toLowerCase();

  if (
    explicitType === 'xai' ||
    authKind === 'xai' ||
    baseUrl.includes('x.ai') ||
    baseUrl.includes('grok.com') ||
    headerBlob.includes('x-xai-token-auth') ||
    headerBlob.includes('x-grok-')
  ) {
    return 'xai';
  }

  if (baseUrl.includes('anthropic') || explicitType === 'claude') return 'claude';
  if (baseUrl.includes('generativelanguage.googleapis.com') || baseUrl.includes('gemini'))
    return 'gemini';
  if (baseUrl.includes('antigravity')) return 'antigravity';
  if (baseUrl.includes('moonshot') || baseUrl.includes('kimi')) return 'kimi';
  if (baseUrl.includes('dashscope') || baseUrl.includes('qwen')) return 'qwen';
  if (baseUrl.includes('iflow')) return 'iflow';
  if (baseUrl.includes('vertex') || baseUrl.includes('aiplatform.googleapis.com')) return 'vertex';
  if (baseUrl.includes('aistudio') || baseUrl.includes('makersuite')) return 'aistudio';

  return 'codex';
};

const resolveTargetAuthType = (
  record: JsonRecord,
  targetType: AccountImportTargetType = 'auto'
): Exclude<AccountImportTargetType, 'auto'> => {
  if (targetType !== 'auto' && isSupportedTargetType(targetType)) {
    return targetType;
  }
  return detectAuthTypeFromRecord(record);
};

const normalizeCpaAuthJson = (
  value: unknown,
  targetType: AccountImportTargetType = 'auto'
): JsonRecord => {
  const sanitized = sanitizeUnsupportedIdTokens(value).value;
  if (!isRecord(sanitized)) {
    throw new Error('CPA auth JSON must be an object');
  }

  const resolvedType = resolveTargetAuthType(sanitized, targetType);
  const normalized: JsonRecord = {
    ...sanitized,
    type: resolvedType,
  };

  const accountId = firstString(normalized.account_id, normalized.chatgpt_account_id);
  if (accountId) {
    normalized.account_id = accountId;
    normalized.chatgpt_account_id = accountId;
  }

  const planType = firstString(normalized.plan_type, normalized.chatgpt_plan_type);
  if (planType) {
    normalized.plan_type = planType;
    normalized.chatgpt_plan_type = planType;
  }

  return normalized;
};

const dedupeImportItems = (items: AccountImportItem[]) => {
  const byCredential = new Map<string, AccountImportItem>();

  items.forEach((item) => {
    const key = item.credentialHash || item.fileName;
    byCredential.set(key, item);
  });

  const usedNames = new Set<string>();
  return Array.from(byCredential.values()).map((item) => {
    if (!usedNames.has(item.fileName)) {
      usedNames.add(item.fileName);
      return item;
    }

    const base = item.fileName.replace(/\.json$/iu, '');
    const suffix = item.accountId ?? item.credentialHash.slice(0, 10) ?? 'account';
    const nextFileName = `${safeFileBase(`${base}-${suffix}`)}.json`;
    usedNames.add(nextFileName);
    return { ...item, fileName: nextFileName };
  });
};

const convertCpaRecord = (
  record: unknown,
  now: Date,
  targetType: AccountImportTargetType = 'auto'
) =>
  normalizeCpaAuthJson(
    convertAuthJsonInput(JSON.stringify(normalizeCpaAuthJson(record, targetType)), 'cpa', now),
    targetType
  );

const SUB2API_PLATFORM_TYPE_MAP: Record<string, Exclude<AccountImportTargetType, 'auto'>> = {
  openai: 'codex',
  chatgpt: 'codex',
  codex: 'codex',
  grok: 'xai',
  xai: 'xai',
  'x-ai': 'xai',
  claude: 'claude',
  anthropic: 'claude',
  gemini: 'gemini',
  antigravity: 'antigravity',
  kimi: 'kimi',
  moonshot: 'kimi',
  qwen: 'qwen',
  dashscope: 'qwen',
  iflow: 'iflow',
  vertex: 'vertex',
  aistudio: 'aistudio',
  'ai-studio': 'aistudio',
};

const mapSub2ApiPlatformToTargetType = (
  platform: string | undefined
): Exclude<AccountImportTargetType, 'auto'> | undefined => {
  if (!platform) return undefined;
  return (
    SUB2API_PLATFORM_TYPE_MAP[platform] ?? SUB2API_PLATFORM_TYPE_MAP[platform.replace(/_/g, '-')]
  );
};

const looksLikeSub2ApiTaskExportAccount = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  // Avoid treating already-normalized CPA auth objects as task exports.
  if (
    firstString(value.access_token, value.refresh_token, value.session_token) &&
    firstString(value.type) &&
    !isRecord(value.payload)
  ) {
    return false;
  }
  const payload = isRecord(value.payload) ? value.payload : undefined;
  if (!payload || !isRecord(payload.result)) return false;
  return Boolean(
    firstString(
      value.account_id,
      value.task_id,
      value.platform_id,
      value.credential_ref,
      value.username,
      value.email_address
    ) || isRecord(payload.task)
  );
};

const extractSub2ApiTaskExportCredentials = (account: JsonRecord): JsonRecord | undefined => {
  const payload = isRecord(account.payload) ? account.payload : undefined;
  const result = payload && isRecord(payload.result) ? payload.result : undefined;
  if (!result) return undefined;

  const accessToken = firstString(
    result.access_token,
    result.accessToken,
    result.sso_token,
    result.sso
  );
  const refreshToken = firstString(result.refresh_token, result.refreshToken);
  const idToken = firstString(result.id_token, result.idToken);
  const sessionToken = firstString(result.session_token, result.sessionToken);
  const apiKey = firstString(result.api_key, result.apiKey, result.key);
  if (!accessToken && !refreshToken && !idToken && !sessionToken && !apiKey) {
    return undefined;
  }

  const headers = isRecord(result.headers) ? result.headers : undefined;
  const platform = firstString(
    account.platform_id,
    account.platform,
    result.platform_id,
    result.platform
  )?.toLowerCase();
  const explicitType = firstString(
    result.type,
    result.provider,
    result.auth_type,
    result.auth_kind
  )?.toLowerCase();
  const email = firstString(result.email, account.email_address, account.email);
  const username = firstString(result.username, account.username);
  const accountId = firstString(
    account.account_id,
    result.account_id,
    result.account,
    result.sub,
    result.chatgpt_account_id
  );

  const credentials: JsonRecord = {
    ...result,
    type: explicitType || platform,
    platform,
    email,
    name: firstString(result.name, username, email, accountId),
    username,
    account_id: accountId,
    chatgpt_account_id: firstString(result.chatgpt_account_id, accountId),
    access_token: accessToken,
    refresh_token: refreshToken,
    id_token: idToken,
    session_token: sessionToken,
    api_key: apiKey,
    auth_kind:
      firstString(result.auth_kind, result.authKind) ||
      (accessToken || refreshToken ? 'oauth' : undefined),
    base_url: firstString(result.base_url, result.baseUrl),
    token_endpoint: firstString(result.token_endpoint, result.tokenEndpoint),
    redirect_uri: firstString(result.redirect_uri, result.redirectUri),
    client_id: firstString(result.client_id, result.clientId),
    token_type: firstString(result.token_type, result.tokenType),
    expires_in: firstNumber(result.expires_in, result.expiresIn),
    last_refresh: result.last_refresh ?? result.lastRefresh,
    expired: result.expired ?? result.expires_at ?? result.expiresAt,
    credential_ref: firstString(result.credential_ref, account.credential_ref),
    password: firstString(result.password),
    disabled: typeof result.disabled === 'boolean' ? result.disabled : undefined,
    source: 'sub2api',
  };

  if (headers) {
    credentials.headers = headers;
  }

  return credentials;
};

const looksLikeSub2ApiAccount = (value: unknown): value is JsonRecord => {
  if (looksLikeSub2ApiTaskExportAccount(value)) return true;
  if (!isRecord(value)) return false;
  const platform = firstString(value.platform)?.toLowerCase();
  const type = firstString(value.type)?.toLowerCase();
  // CPA auth files may use auth_kind=oauth with a concrete provider type (e.g. xai).
  // Only treat as sub2api when platform/credentials clearly indicate sub2api shape.
  if (isSupportedTargetType(type) && type !== 'codex') {
    return false;
  }
  if (isRecord(value.credentials)) return true;
  if (platform && mapSub2ApiPlatformToTargetType(platform)) return true;
  return platform === 'openai' || platform === 'chatgpt' || platform === 'codex';
};

const sub2ApiAccounts = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.filter(looksLikeSub2ApiAccount);
  if (!isRecord(value)) return [];
  if (Array.isArray(value.accounts)) return value.accounts.filter(looksLikeSub2ApiAccount);
  return looksLikeSub2ApiAccount(value) ? [value] : [];
};

const isSub2ApiPayload = (value: unknown) => sub2ApiAccounts(value).length > 0;

const convertSub2ApiTaskExportAccount = (
  account: JsonRecord,
  now: Date,
  targetType: AccountImportTargetType = 'auto'
) => {
  const credentials = extractSub2ApiTaskExportCredentials(account);
  if (!credentials) {
    throw new Error('sub2api task export item has no usable credentials in payload.result');
  }

  const platform = firstString(credentials.platform)?.toLowerCase();
  const platformType = mapSub2ApiPlatformToTargetType(platform);
  const credentialsTypeRaw = firstString(
    credentials.type,
    credentials.provider,
    credentials.auth_type
  )?.toLowerCase();
  const credentialsType = isSupportedTargetType(credentialsTypeRaw)
    ? credentialsTypeRaw
    : mapSub2ApiPlatformToTargetType(credentialsTypeRaw);

  const resolvedHintType =
    (targetType !== 'auto' && isSupportedTargetType(targetType) ? targetType : undefined) ||
    credentialsType ||
    platformType ||
    detectAuthTypeFromRecord(credentials);

  const email = firstString(credentials.email);
  const accountId = firstString(
    credentials.account_id,
    credentials.chatgpt_account_id,
    credentials.sub
  );
  const authJson: JsonRecord = {
    ...credentials,
    type: resolvedHintType,
    email,
    name: firstString(
      credentials.name,
      credentials.username,
      email,
      accountId,
      `${resolvedHintType} Account`
    ),
    account_id: accountId,
    chatgpt_account_id: firstString(credentials.chatgpt_account_id, accountId),
    id_token: isUnsafeJwt(credentials.id_token) ? undefined : firstString(credentials.id_token),
    last_refresh: normalizeTimestamp(credentials.last_refresh) ?? normalizeTimestamp(now),
    expired: normalizeTimestamp(credentials.expired) ?? normalizeTimestamp(credentials.expires_at),
    disabled: false,
    source: 'sub2api',
  };

  return convertCpaRecord(authJson, now, targetType);
};

const convertSub2ApiAccount = (
  account: unknown,
  now: Date,
  targetType: AccountImportTargetType = 'auto'
) => {
  if (!isRecord(account)) throw new Error('sub2api account item must be an object');
  if (looksLikeSub2ApiTaskExportAccount(account)) {
    return convertSub2ApiTaskExportAccount(account, now, targetType);
  }
  const credentials = isRecord(account.credentials) ? account.credentials : {};
  const extra = isRecord(account.extra) ? account.extra : {};
  const platform = firstString(account.platform)?.toLowerCase();
  const platformType = mapSub2ApiPlatformToTargetType(platform);
  const credentialsTypeRaw = firstString(
    credentials.type,
    credentials.provider,
    credentials.auth_type
  )?.toLowerCase();
  const credentialsType = isSupportedTargetType(credentialsTypeRaw)
    ? credentialsTypeRaw
    : mapSub2ApiPlatformToTargetType(credentialsTypeRaw);

  if (platform && !platformType && !credentialsType) {
    throw new Error(`Unsupported sub2api platform: ${platform}`);
  }

  const email = firstString(credentials.email, extra.email, account.name);
  const accountId = firstString(
    credentials.chatgpt_account_id,
    credentials.account_id,
    credentials.sub,
    account.id
  );
  const resolvedHintType =
    (targetType !== 'auto' && isSupportedTargetType(targetType) ? targetType : undefined) ||
    credentialsType ||
    platformType ||
    detectAuthTypeFromRecord({ ...credentials, platform, type: credentialsTypeRaw || platform });

  // ChatGPT / Codex sub2api exports keep the historical field remapping.
  if (resolvedHintType === 'codex') {
    const authJson: JsonRecord = {
      type: 'codex',
      account_id: accountId,
      chatgpt_account_id: accountId,
      chatgpt_user_id: firstString(credentials.chatgpt_user_id),
      email,
      name: firstString(account.name, email, accountId, 'ChatGPT Account'),
      plan_type: firstString(credentials.plan_type),
      chatgpt_plan_type: firstString(credentials.plan_type),
      access_token: firstString(credentials.access_token),
      id_token: isUnsafeJwt(credentials.id_token) ? undefined : firstString(credentials.id_token),
      refresh_token: firstString(credentials.refresh_token),
      session_token: firstString(credentials.session_token),
      client_id: firstString(credentials.client_id),
      organization_id: firstString(credentials.organization_id),
      last_refresh: normalizeTimestamp(credentials.last_refresh) ?? normalizeTimestamp(now),
      expired:
        normalizeTimestamp(credentials.expired) ?? normalizeTimestamp(credentials.expires_at),
      priority: firstNumber(account.priority),
      concurrency: firstNumber(account.concurrency),
      disabled: false,
      source: 'sub2api',
    };

    return convertCpaRecord(authJson, now, targetType);
  }

  // Non-Codex sub2api platforms (e.g. grok/xai) usually already store CPA-compatible credentials.
  const authJson: JsonRecord = {
    ...credentials,
    type: resolvedHintType,
    email,
    name: firstString(
      account.name,
      email,
      accountId,
      credentials.name,
      `${resolvedHintType} Account`
    ),
    account_id: accountId,
    chatgpt_account_id: firstString(credentials.chatgpt_account_id, accountId),
    id_token: isUnsafeJwt(credentials.id_token) ? undefined : firstString(credentials.id_token),
    last_refresh: normalizeTimestamp(credentials.last_refresh) ?? normalizeTimestamp(now),
    expired: normalizeTimestamp(credentials.expired) ?? normalizeTimestamp(credentials.expires_at),
    priority: firstNumber(account.priority, credentials.priority),
    concurrency: firstNumber(account.concurrency, credentials.concurrency),
    disabled: false,
    source: 'sub2api',
  };

  return convertCpaRecord(authJson, now, targetType);
};

const resolveResultTargetFormat = (
  items: AccountImportItem[],
  targetType: AccountImportTargetType
): AccountImportTargetType => {
  if (targetType !== 'auto') return targetType;
  const types = Array.from(
    new Set(
      items
        .map((item) => firstString(item.authJson.type)?.toLowerCase())
        .filter((value): value is string => Boolean(value))
    )
  );
  if (types.length === 1 && isSupportedTargetType(types[0])) {
    return types[0];
  }
  return 'auto';
};

const convertSub2Api = (
  value: unknown,
  now: Date,
  targetType: AccountImportTargetType = 'auto'
): AccountImportResult => {
  const accounts = sub2ApiAccounts(value);
  if (accounts.length === 0) throw new Error('sub2api JSON must contain accounts[]');

  const items: AccountImportItem[] = [];
  const warnings: string[] = [];
  accounts.forEach((account, index) => {
    try {
      items.push(buildItem(convertSub2ApiAccount(account, now, targetType), 'sub2api', undefined));
    } catch (error) {
      const identity = isRecord(account)
        ? firstString(
            account.email_address,
            account.username,
            account.account_id,
            account.task_id,
            account.credential_ref
          )
        : undefined;
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(identity ? `${identity}: ${message}` : `item[${index}]: ${message}`);
    }
  });

  if (items.length === 0) {
    throw new Error(warnings[0] || 'No sub2api accounts found');
  }

  const dedupedItems = dedupeImportItems(items);
  return {
    detectedFormat: 'sub2api',
    items: dedupedItems,
    warnings,
    meta: {
      detectedFormat: 'sub2api',
      targetFormat: resolveResultTargetFormat(dedupedItems, targetType),
      fileCount: 1,
      accountCount: dedupedItems.length,
      inputMode: 'multi-object-array',
      sourceFormat: 'sub2api',
    },
  };
};

const collectArrayCandidates = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];

  const candidates = [value.accounts, value.authFiles, value.auth_files, value.files, value.items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
};

const isCpaAuthRecord = (value: unknown): value is JsonRecord => {
  if (!isRecord(value)) return false;
  return Boolean(
    firstString(
      value.access_token,
      value.refresh_token,
      value.session_token,
      value.id_token,
      value.api_key,
      value.key
    )
  );
};

const isCpaMultiPayload = (value: unknown) => {
  const candidates = collectArrayCandidates(value);
  return candidates.length > 0 && candidates.every((candidate) => isRecord(candidate));
};

const isMixedSub2ApiAndCpaArray = (value: unknown) => {
  const candidates = collectArrayCandidates(value);
  if (candidates.length === 0) return false;
  return candidates.some(looksLikeSub2ApiAccount) && candidates.some(isCpaAuthRecord);
};

const convertCpaMulti = (
  value: unknown,
  now: Date,
  targetType: AccountImportTargetType = 'auto'
): AccountImportResult => {
  const candidates = collectArrayCandidates(value);
  if (candidates.length === 0)
    throw new Error('CPA multi-account JSON must contain an account array');

  const items = candidates.map((candidate) =>
    buildItem(convertCpaRecord(candidate, now, targetType), 'cpa-multi')
  );
  const dedupedItems = dedupeImportItems(items);
  return {
    detectedFormat: 'cpa-multi',
    items: dedupedItems,
    warnings: [],
    meta: {
      detectedFormat: 'cpa-multi',
      targetFormat: resolveResultTargetFormat(dedupedItems, targetType),
      fileCount: 1,
      accountCount: dedupedItems.length,
      inputMode: 'multi-object-array',
      sourceFormat: 'cpa-multi',
    },
  };
};

const convertSingle = (
  text: string,
  type: AuthJsonInputType,
  source: AccountImportSource,
  now: Date,
  targetType: AccountImportTargetType = 'auto'
): AccountImportResult => {
  const authJson = normalizeCpaAuthJson(convertAuthJsonInput(text, type, now), targetType);
  const fallbackFileName = type === 'session' ? getDefaultSessionAuthFileName(authJson) : undefined;
  const items = [buildItem(authJson, source, fallbackFileName)];
  return {
    detectedFormat: source,
    items,
    warnings: [],
    meta: {
      detectedFormat: source,
      targetFormat: resolveResultTargetFormat(items, targetType),
      fileCount: 1,
      accountCount: 1,
      inputMode: 'single-object',
      sourceFormat: source === 'session' ? 'session' : 'cpa-single',
    },
  };
};

const convertCpaSingle = (
  value: unknown,
  now: Date,
  targetType: AccountImportTargetType = 'auto'
): AccountImportResult => {
  const authJson = convertCpaRecord(value, now, targetType);
  const items = [buildItem(authJson, 'cpa')];
  return {
    detectedFormat: 'cpa',
    items,
    warnings: [],
    meta: {
      detectedFormat: 'cpa',
      targetFormat: resolveResultTargetFormat(items, targetType),
      fileCount: 1,
      accountCount: 1,
      inputMode: 'single-object',
      sourceFormat: 'cpa-single',
    },
  };
};

export type BuildAccountImportPreviewOptions = {
  now?: Date;
  targetType?: AccountImportTargetType;
  /** When true, imported accounts start as disabled. Defaults to true. */
  defaultDisabled?: boolean;
  /** Custom headers to merge into each account's headers field. */
  headers?: Record<string, string>;
  /** Custom proxy URL to apply to each account. */
  proxyUrl?: string;
  /** Custom priority to apply to each account. */
  priority?: number;
};

const applyImportDefaultDisabled = (
  result: AccountImportResult,
  defaultDisabled: boolean
): AccountImportResult => ({
  ...result,
  items: result.items.map((item) => ({
    ...item,
    authJson: {
      ...item.authJson,
      disabled: defaultDisabled,
    },
  })),
});

const applyImportOverridesToResult = (
  result: AccountImportResult,
  headers?: Record<string, string> | null,
  proxyUrl?: string | null,
  priority?: number | null
): AccountImportResult => ({
  ...result,
  items: result.items.map((item) => ({
    ...item,
    authJson: applyImportOverrides(item.authJson, headers, proxyUrl, priority),
  })),
});

export const buildAccountImportPreview = (
  text: string,
  format: AccountImportFormat,
  options?: BuildAccountImportPreviewOptions
): AccountImportResult => {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Import JSON is required');

  const now = options?.now ?? new Date();
  const targetType = options?.targetType ?? 'auto';
  const defaultDisabled = options?.defaultDisabled !== false;
  const parsed = parseJson(trimmed);

  const headers = options?.headers;
  const proxyUrl = options?.proxyUrl;
  const priority = options?.priority;
  const hasOverrides =
    Boolean(headers && Object.keys(headers).length > 0) ||
    Boolean(proxyUrl?.trim()) ||
    (priority !== null && priority !== undefined);

  const convertAndMaybeOverride = (result: AccountImportResult) => {
    const base = applyImportDefaultDisabled(result, defaultDisabled);
    return hasOverrides ? applyImportOverridesToResult(base, headers, proxyUrl, priority) : base;
  };

  if (format === 'sub2api') return convertAndMaybeOverride(convertSub2Api(parsed, now, targetType));
  if (format === 'cpa-multi')
    return convertAndMaybeOverride(convertCpaMulti(parsed, now, targetType));
  if (format === 'cpa-single')
    return convertAndMaybeOverride(convertCpaSingle(parsed, now, targetType));
  if (format === 'session')
    return convertAndMaybeOverride(convertSingle(trimmed, 'session', 'session', now, targetType));

  if (format === 'auto') {
    if (isMixedSub2ApiAndCpaArray(parsed)) {
      throw new Error('Mixed sub2api and CPA account arrays are not supported in one JSON payload');
    }

    // Prefer explicit CPA auth type over sub2api heuristics.
    // Example: xai oauth credentials include auth_kind=oauth and would otherwise be mis-routed.
    if (isRecord(parsed) && firstString(parsed.type) && isCpaAuthRecord(parsed)) {
      return convertAndMaybeOverride(convertCpaSingle(parsed, now, targetType));
    }

    if (isSub2ApiPayload(parsed) || looksLikeSub2ApiAccount(parsed)) {
      return convertAndMaybeOverride(convertSub2Api(parsed, now, targetType));
    }

    if (isCpaMultiPayload(parsed)) {
      const candidates = collectArrayCandidates(parsed);
      if (candidates.every((candidate) => isCpaAuthRecord(candidate))) {
        return convertAndMaybeOverride(convertCpaMulti(parsed, now, targetType));
      }
    }

    if (isCpaAuthRecord(parsed)) {
      return convertAndMaybeOverride(convertCpaSingle(parsed, now, targetType));
    }
  }

  const attempts: Array<() => AccountImportResult> = [
    () => convertSub2Api(parsed, now, targetType),
    () => convertCpaMulti(parsed, now, targetType),
    () => convertCpaSingle(parsed, now, targetType),
    () => convertSingle(trimmed, 'session', 'session', now, targetType),
  ];

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return convertAndMaybeOverride(attempt());
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors[0] || 'Unsupported account import JSON');
};

export const mergeAccountImportResults = (
  results: AccountImportResult[],
  targetType: AccountImportTargetType = 'auto'
): AccountImportResult => {
  if (results.length === 0) {
    return {
      detectedFormat: 'mixed',
      items: [],
      warnings: [],
      meta: {
        detectedFormat: 'mixed',
        targetFormat: targetType,
        fileCount: 0,
        accountCount: 0,
        inputMode: 'mixed',
        sourceFormat: 'auto',
      },
    };
  }

  const detectedFormat = results.every(
    (result) => result.detectedFormat === results[0].detectedFormat
  )
    ? results[0].detectedFormat
    : 'mixed';

  const mergedItems = dedupeImportItems(results.flatMap((result) => result.items));
  const inputMode: InputMode =
    results.length > 1 ? 'multi-file' : (results[0]?.meta.inputMode ?? 'single-file');
  return {
    detectedFormat,
    items: mergedItems,
    warnings: Array.from(new Set(results.flatMap((result) => result.warnings))),
    meta: {
      detectedFormat,
      targetFormat: resolveResultTargetFormat(mergedItems, targetType),
      fileCount: results.length,
      accountCount: mergedItems.length,
      inputMode,
      sourceFormat: detectedFormat === 'mixed' ? 'auto' : (results[0]?.meta.sourceFormat ?? 'auto'),
    },
  };
};
