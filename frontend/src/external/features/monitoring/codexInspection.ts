import type { AxiosRequestConfig } from 'axios';
import { authFilesApi, deleteFileByName, setStatusWithFallback } from '@/external/services/api/authFiles';
import { apiCallApi, getApiCallErrorMessage, type ApiCallResult } from '@/services/api/apiCall';
import { requestCodexUsageRaw } from '@/external/services/api/codexQuota';
import type { AuthFileItem, CodexRateLimitInfo } from '@/types';
import type { Config } from '@/external/types/config';
import {  ANTIGRAVITY_QUOTA_URLS,
  ANTIGRAVITY_REQUEST_HEADERS,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_URL,
  KIMI_REQUEST_HEADERS,
  KIMI_USAGE_URL,
  XAI_REQUEST_HEADERS,} from '@/utils/quota/constants';
import { XAI_BILLING_URL } from '@/external/utils/quota/quotaExtension';
import {
  normalizeNumberValue,
  resolveAuthProvider,
  resolveCodexChatgptAccountId,
  isDisabledAuthFile,
  parseClaudeUsagePayload,
  parseKimiUsagePayload,
  parseXaiBillingPayload,
  parseAntigravityPayload,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/external/utils/usage';
import {
  classifyCodexRateLimitWindows,
  deriveCodexRateLimitUsedPercent,
  isCodexRateLimitReached,
  getCodexQuotaWindowUsedPercent,
} from '@/external/utils/quota';
import { buildXaiBillingSummary } from '@/external/utils/quota/providers/xai';
import {
  GEMINI_CLI_QUOTA_URL,
  GEMINI_CLI_REQUEST_HEADERS,
} from '@/external/utils/quota/constants/geminiCli';
import {
  parseGeminiCliQuotaPayload,
  resolveGeminiCliProjectId,
} from '@/external/utils/quota/adapters/geminiCli';

export type CodexInspectionLogLevel = 'info' | 'success' | 'warning' | 'error';
export type CodexInspectionAction = 'keep' | 'delete' | 'disable' | 'enable';
export type CodexInspectionExecutionAction = Exclude<CodexInspectionAction, 'keep'>;
export type CodexInspectionProgressStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'completed';
export type CodexInspectionAutoActionMode =
  | 'none'
  | 'disable'
  | 'delete'
  | 'strategy4'
  | 'strategy5'
  | 'strategy6';
export type CodexInspectionStoredActionFilter = 'all' | 'delete' | 'disable' | 'enable';

export const INSPECTION_ACCOUNT_SOURCES = ['oauth', 'api_key'] as const;
export type InspectionAccountSource = (typeof INSPECTION_ACCOUNT_SOURCES)[number];

export const isInspectionAccountSource = (value: unknown): value is InspectionAccountSource =>
  typeof value === 'string' && (INSPECTION_ACCOUNT_SOURCES as readonly string[]).includes(value);

export const normalizeInspectionAccountSource = (
  value: unknown,
  fallback: InspectionAccountSource = 'oauth'
): InspectionAccountSource => (isInspectionAccountSource(value) ? value : fallback);

export const INSPECTION_API_KEY_FAMILIES = [
  'all',
  'openai-compat',
  'gemini-apikey',
  'claude-apikey',
  'codex-apikey',
  'vertex-apikey',
] as const;
export type InspectionApiKeyFamily = (typeof INSPECTION_API_KEY_FAMILIES)[number];

export const isInspectionApiKeyFamily = (value: unknown): value is InspectionApiKeyFamily =>
  typeof value === 'string' && (INSPECTION_API_KEY_FAMILIES as readonly string[]).includes(value);

export const normalizeInspectionApiKeyFamily = (
  value: unknown,
  fallback: InspectionApiKeyFamily = 'all'
): InspectionApiKeyFamily => (isInspectionApiKeyFamily(value) ? value : fallback);


export const CODEX_INSPECTION_PROBE_PROMPT_MODES = ['fixed', 'math', 'random'] as const;
export type CodexInspectionProbePromptMode = (typeof CODEX_INSPECTION_PROBE_PROMPT_MODES)[number];

export const isCodexInspectionProbePromptMode = (
  value: unknown
): value is CodexInspectionProbePromptMode =>
  typeof value === 'string' &&
  (CODEX_INSPECTION_PROBE_PROMPT_MODES as readonly string[]).includes(value);

export const normalizeProbePromptMode = (
  value: unknown,
  fallback: CodexInspectionProbePromptMode = 'math'
): CodexInspectionProbePromptMode =>
  isCodexInspectionProbePromptMode(value) ? value : fallback;

const randomInspectionToken = (length: number) => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
};

/** Build a lightweight probe user prompt for chat-style health checks. */
export const buildInspectionProbePrompt = (
  mode: CodexInspectionProbePromptMode = 'math'
): string => {
  if (mode === 'fixed') {
    return 'ping';
  }
  if (mode === 'random') {
    const left = randomInspectionToken(6);
    const right = randomInspectionToken(4);
    return `Concatenate these two strings with no spaces and reply with the result only: ${left} + ${right}`;
  }
  // Default: simple random arithmetic.
  const left = 1 + Math.floor(Math.random() * 20);
  const right = 1 + Math.floor(Math.random() * 20);
  const ops = ['+', '-', '*'] as const;
  const op = ops[Math.floor(Math.random() * ops.length)];
  return `What is ${left} ${op} ${right}? Reply with the number only.`;
};

export interface CodexInspectionSettings {
  baseUrl: string;
  token: string;
  accountSource: InspectionAccountSource;
  targetType: string;
  workers: number;
  deleteWorkers: number;
  timeout: number;
  retries: number;
  userAgent: string;
  usedPercentThreshold: number;
  sampleSize: number;
  probePromptMode: CodexInspectionProbePromptMode;
  /** Optional model id for API Key chat fallback probes. */
  probeModel: string;
  providerFilter: string;
  autoActionMode: CodexInspectionAutoActionMode;
}

/** Which suggested actions may be applied while a run is still in progress. */
export interface CodexInspectionRealtimeAutoActions {
  disable: boolean;
  enable: boolean;
  delete: boolean;
}

export const DEFAULT_CODEX_INSPECTION_REALTIME_AUTO_ACTIONS: CodexInspectionRealtimeAutoActions = {
  disable: true,
  enable: true,
  delete: false,
};

export interface CodexInspectionConfigurableSettings {
  accountSource: InspectionAccountSource;
  targetType: string;
  workers: number;
  deleteWorkers: number;
  timeout: number;
  retries: number;
  userAgent: string;
  usedPercentThreshold: number;
  sampleSize: number;
  probePromptMode: CodexInspectionProbePromptMode;
  probeModel: string;
  /** Optional free-text filter for API Key provider/label/compat name. */
  providerFilter: string;
  autoActionMode: CodexInspectionAutoActionMode;
  /** Apply selected action types as soon as probe results arrive (not only at run end). */
  realtimeAutoActions: CodexInspectionRealtimeAutoActions;
}

export interface CodexInspectionAccount {
  key: string;
  fileName: string;
  displayAccount: string;
  authIndex: string | null;
  accountId: string | null;
  provider: string;
  disabled: boolean;
  status: string;
  state: string;
  accountSource: InspectionAccountSource;
  baseUrl?: string;
  /** OpenAI-compat provider display name when available. */
  compatName?: string;
  raw: AuthFileItem;
}

export interface CodexInspectionResultItem extends CodexInspectionAccount {
  action: CodexInspectionAction;
  actionReason: string;
  statusCode: number | null;
  usedPercent: number | null;
  isQuota: boolean;
  error: string;
}

export interface CodexInspectionSummary {
  totalFiles: number;
  probeSetCount: number;
  sampledCount: number;
  disabledCount: number;
  enabledCount: number;
  deleteCount: number;
  disableCount: number;
  enableCount: number;
  keepCount: number;
  usedPercentThreshold: number;
  sampled: boolean;
  plannedActionPreview: string[];
}

export interface CodexInspectionProgressSummary {
  totalFiles: number;
  probeSetCount: number;
  sampledCount: number;
  disabledCount: number;
  enabledCount: number;
  deleteCount: number;
  disableCount: number;
  enableCount: number;
  keepCount: number;
}

export interface CodexInspectionRunResult {
  settings: CodexInspectionSettings;
  files: AuthFileItem[];
  results: CodexInspectionResultItem[];
  summary: CodexInspectionSummary;
  startedAt: number;
  finishedAt: number;
}

export interface CodexInspectionProgressSnapshot {
  total: number;
  completed: number;
  inFlight: number;
  pending: number;
  percent: number;
  status: CodexInspectionProgressStatus;
  summary: CodexInspectionProgressSummary;
  startedAt: number;
  updatedAt: number;
}

export interface CodexInspectionExecutionOutcome {
  action: CodexInspectionExecutionAction;
  fileName: string;
  displayAccount: string;
  success: boolean;
  error: string;
}

export interface CodexInspectionExecutionResult {
  outcomes: CodexInspectionExecutionOutcome[];
  refreshedFiles: AuthFileItem[];
  refreshError: string;
}

export interface CodexInspectionStoredLogEntry {
  id: string;
  level: CodexInspectionLogLevel;
  message: string;
  timestamp: number;
}

export interface CodexInspectionLastRunState {
  result: CodexInspectionRunResult;
  logs: CodexInspectionStoredLogEntry[];
  logsCollapsed: boolean;
  actionFilter: CodexInspectionStoredActionFilter;
  connectionFingerprint: string | null;
  savedAt: number;
}

type LogHandler = (level: CodexInspectionLogLevel, message: string) => void;
type ProgressHandler = (progress: CodexInspectionProgressSnapshot) => void;
type ResultsChangeHandler = (result: CodexInspectionRunResult) => void;

type InspectCodexAccountsOptions = {
  config: Config | null;
  apiBase: string;
  managementKey: string;
  settings?: Partial<CodexInspectionConfigurableSettings> | null;
  onLog?: LogHandler;
  onProgress?: ProgressHandler;
  onResultsChange?: ResultsChangeHandler;
};

type ExecuteCodexInspectionActionsOptions = {
  settings: CodexInspectionSettings;
  items: CodexInspectionResultItem[];
  previousFiles: AuthFileItem[];
  onLog?: LogHandler;
};

type CreateCodexInspectionSessionOptions = InspectCodexAccountsOptions;

type CodexInspectionSessionPromiseState = {
  promise: Promise<CodexInspectionRunResult>;
  resolve: (value: CodexInspectionRunResult) => void;
  reject: (reason?: unknown) => void;
};

export interface CodexInspectionSession {
  id: string;
  start: () => Promise<CodexInspectionRunResult>;
  resume: () => void;
  pause: () => void;
  stop: () => void;
  /** Stop accepting new probes, then resolve with partial results for action execution. */
  finish: () => void;
  getProgress: () => CodexInspectionProgressSnapshot;
}

const QUOTA_BODY_PATTERNS = [
  'quota exhausted',
  'limit reached',
  'payment_required',
  'free-usage-exhausted',
  'free usage exhausted',
  'used all the included free usage',
  'subscription:free-usage-exhausted',
  'insufficient quota',
  'billing hard limit',
  'credit exhausted',
  'credits exhausted',
  'out of credits',
  'balance exhausted',
  'rate limit',
  'too many requests',
  'usage resets',
  '额度耗尽',
  '额度不足',
  '配额耗尽',
  '配额不足',
  '免费额度',
  '用完',
  '已用完',
  '耗尽',
];
const INVALID_ACCOUNT_BODY_PATTERNS = [
  'invalid_api_key',
  'invalid api key',
  'invalid authentication',
  'invalid auth',
  'invalid token',
  'expired token',
  'token expired',
  'revoked token',
  'token revoked',
  'unauthorized',
  'authentication failed',
  'invalid_grant',
  'account disabled',
  'account expired',
  'account invalid',
  'account unavailable',
  'account deactivated',
  'credential expired',
  'credential invalid',
  'key expired',
  'key revoked',
  'api key expired',
  'api key revoked',
  '账号已失效',
  '账号失效',
  '账号无效',
  '账号不可用',
  '账户已失效',
  '账户失效',
  '账户无效',
  '账户不可用',
  '凭证已失效',
  '凭证失效',
  '凭证无效',
  '密钥已失效',
  '密钥失效',
  '密钥无效',
  '令牌已失效',
  '令牌失效',
  '令牌无效',
  '认证失败',
  '鉴权失败',
  '认证失效',
  '鉴权失效',
];

export class CodexInspectionStoppedError extends Error {
  constructor(message: string = '巡检已停止') {
    super(message);
    this.name = 'CodexInspectionStoppedError';
  }
}

export const CODEX_INSPECTION_SETTINGS_STORAGE_KEY = 'cli-proxy-codex-inspection-settings-v1';
export const CODEX_INSPECTION_LAST_RUN_STORAGE_KEY = 'cli-proxy-codex-inspection-last-run-v1';

const CODEX_INSPECTION_LAST_RUN_STORAGE_VERSION = 1;
export const CODEX_INSPECTION_AUTO_ACTION_MODES: readonly CodexInspectionAutoActionMode[] = [
  'none',
  'disable',
  'delete',
  'strategy4',
  'strategy5',
  'strategy6',
];

export const DEFAULT_CODEX_INSPECTION_SETTINGS: CodexInspectionConfigurableSettings = {
  accountSource: 'oauth',
  targetType: 'codex',
  workers: 4,
  deleteWorkers: 4,
  timeout: 15000,
  retries: 0,
  userAgent: 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal',
  usedPercentThreshold: 100,
  sampleSize: 0,
  probePromptMode: 'math',
  probeModel: '',
  providerFilter: '',
  autoActionMode: 'none',
  realtimeAutoActions: { ...DEFAULT_CODEX_INSPECTION_REALTIME_AUTO_ACTIONS },
};

export const SUPPORTED_INSPECTION_TARGET_TYPES = [
  'codex',
  'claude',
  'xai',
  'kimi',
  'antigravity',
  'gemini-cli',
  'gemini',
] as const;

export type InspectionTargetType = (typeof SUPPORTED_INSPECTION_TARGET_TYPES)[number];

export const isSupportedInspectionTargetType = (value: string): value is InspectionTargetType =>
  SUPPORTED_INSPECTION_TARGET_TYPES.includes(value as InspectionTargetType);

const normalizeInspectionProvider = (value: string) => {
  const normalized = readString(value).toLowerCase().replace(/_/g, '-');
  if (normalized === 'x-ai' || normalized === 'grok') return 'xai';
  return normalized;
};

export const matchesInspectionTargetType = (provider: string, targetType: string) =>
  normalizeInspectionProvider(provider) === normalizeInspectionProvider(targetType);

export const isRuntimeOnlyAuthFileItem = (file: AuthFileItem): boolean => {
  const raw = file['runtime_only'] ?? file.runtimeOnly;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
};

export const resolveInspectionApiKeyFamily = (provider: string): InspectionApiKeyFamily | null => {
  const normalized = normalizeInspectionProvider(provider);
  if (!normalized) return null;
  if (normalized.startsWith('openai-compatible') || normalized === 'openai-compatibility') {
    return 'openai-compat';
  }
  if (normalized.includes('vertex')) return 'vertex-apikey';
  if (normalized.includes('gemini') || normalized.includes('aistudio')) return 'gemini-apikey';
  if (normalized.includes('claude') || normalized.includes('anthropic')) return 'claude-apikey';
  if (normalized.includes('codex') || normalized.includes('openai')) return 'codex-apikey';
  return null;
};

export const isApiKeyInspectionAccount = (file: AuthFileItem): boolean => {
  if (isRuntimeOnlyAuthFileItem(file)) return true;
  const provider = resolveAuthProvider(file);
  const family = resolveInspectionApiKeyFamily(provider);
  if (!family) return false;
  // File-based OAuth accounts for codex/claude/gemini should stay in oauth source.
  // Treat as API key only when filename/label/source hints apikey or provider is openai-compat.
  if (family === 'openai-compat') return true;
  const fileName = readString(file.name).toLowerCase();
  const label = readString(file.label).toLowerCase();
  const source = readString(file.source).toLowerCase();
  const blob = `${fileName} ${label} ${source} ${provider}`;
  return blob.includes('apikey') || blob.includes('api-key') || blob.includes('api_key');
};

export const matchesInspectionApiKeyFamily = (
  provider: string,
  family: InspectionApiKeyFamily
): boolean => {
  if (family === 'all') return true;
  return resolveInspectionApiKeyFamily(provider) === family;
};

export const resolveCompatName = (file: AuthFileItem): string => {
  const metadata =
    file && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  return firstNonEmptyString(
    file.label,
    file.compat_name,
    file.compatName,
    metadata?.compat_name,
    metadata?.compatName,
    file['compat-name']
  );
};

export const resolveAccountBaseUrl = (file: AuthFileItem): string => {
  const metadata =
    file && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  return firstNonEmptyString(
    file.base_url,
    file.baseUrl,
    metadata?.base_url,
    metadata?.baseUrl,
    file['base-url']
  );
};

const firstNonEmptyString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

export const buildApiKeyModelsUrl = (baseUrl: string): string => {
  const base = baseUrl.replace(/\/+$/, '');
  if (!base) return '';
  if (/\/models\/?$/i.test(base)) return base;
  if (/\/v\d+$/i.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
};


export const createCodexInspectionConnectionFingerprint = (
  apiBase: string,
  managementKey: string
) => {
  const normalizedApiBase = readString(apiBase).replace(/\/+$/, '');
  const normalizedManagementKey = readString(managementKey);
  if (!normalizedApiBase || !normalizedManagementKey) return null;

  const input = `${normalizedApiBase}\u0000${normalizedManagementKey}`;
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193);
    hashB = Math.imul(hashB ^ code, 0x85ebca6b);
  }

  return `v1:${(hashA >>> 0).toString(36)}${(hashB >>> 0).toString(36)}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const createDeferred = (): CodexInspectionSessionPromiseState => {
  let resolve: ((value: CodexInspectionRunResult) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;

  const promise = new Promise<CodexInspectionRunResult>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve: (value) => resolve?.(value),
    reject: (reason) => reject?.(reason),
  };
};

const clampPositiveInteger = (value: number | undefined, fallback: number) => {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
};

const normalizeThreshold = (value: unknown) => {
  const normalized = normalizeNumberValue(value);
  if (normalized === null || !Number.isFinite(normalized) || normalized < 0) return NaN;
  if (normalized > 0 && normalized <= 1) {
    return normalized * 100;
  }
  return normalized;
};

const readString = (value: unknown) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const readBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
};

const readNullableString = (value: unknown) => {
  const normalized = readString(value);
  return normalized || null;
};

const readNullableNumber = (value: unknown) => {
  const normalized = normalizeNumberValue(value);
  return normalized === null || !Number.isFinite(normalized) ? null : normalized;
};

export const isCodexInvalidAccountResponse = (statusCode: number, bodyText: string) => {
  // A successful HTTP response means the credential was accepted. Never treat 2xx as
  // "invalid account", even if the combined probe body still contains failure text
  // from another sub-request (e.g. xAI chat transport error + billing 200).
  if (statusCode >= 200 && statusCode < 300) return false;
  if (statusCode === 401) return true;
  const normalizedBody = bodyText.toLowerCase();
  return INVALID_ACCOUNT_BODY_PATTERNS.some((pattern) => normalizedBody.includes(pattern));
};

const isTimeoutErrorText = (value: unknown) => {
  const text = String(value || '').toLowerCase();
  if (!text) return false;
  return (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('etimedout') ||
    text.includes('econnaborted') ||
    (text.includes('exceeded') && text.includes('time'))
  );
};

const isTimeoutError = (error: unknown) => {
  if (!error) return false;
  if (typeof error === 'object') {
    const maybe = error as { code?: unknown; message?: unknown; name?: unknown };
    const code = String(maybe.code || '').toUpperCase();
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      return true;
    }
    if (isTimeoutErrorText(maybe.message) || isTimeoutErrorText(maybe.name)) {
      return true;
    }
  }
  return isTimeoutErrorText(error);
};

const readNonNegativeInteger = (value: unknown, fallback: number) => {
  const normalized = normalizeNumberValue(value);
  if (normalized === null || !Number.isFinite(normalized) || normalized < 0) return fallback;
  return Math.floor(normalized);
};

const isAutoActionMode = (value: string): value is CodexInspectionAutoActionMode =>
  CODEX_INSPECTION_AUTO_ACTION_MODES.includes(value as CodexInspectionAutoActionMode);

const isAdvancedAutoActionMode = (mode: CodexInspectionAutoActionMode) =>
  mode === 'strategy4' || mode === 'strategy5' || mode === 'strategy6';

const shouldInspectDisabledOnly = (mode: CodexInspectionAutoActionMode) => mode === 'strategy5';

const shouldInspectEnabledOnly = (mode: CodexInspectionAutoActionMode) => mode === 'strategy6';

const normalizeAutoActionMode = (
  value: unknown,
  legacyAutoExecuteActions?: unknown
): CodexInspectionAutoActionMode => {
  const normalized = readString(value).toLowerCase();
  if (isAutoActionMode(normalized)) return normalized;

  if (legacyAutoExecuteActions !== undefined) {
    return readBoolean(legacyAutoExecuteActions, false) ? 'disable' : 'none';
  }

  return DEFAULT_CODEX_INSPECTION_SETTINGS.autoActionMode;
};

export const normalizeRealtimeAutoActions = (
  value: unknown,
  accountSource?: InspectionAccountSource
): CodexInspectionRealtimeAutoActions => {
  const defaults = DEFAULT_CODEX_INSPECTION_REALTIME_AUTO_ACTIONS;
  const record = isRecord(value) ? value : {};
  const deleteAllowed =
    accountSource === 'api_key'
      ? false
      : readBoolean(record.delete, defaults.delete);
  return {
    disable: readBoolean(record.disable, defaults.disable),
    enable: readBoolean(record.enable, defaults.enable),
    delete: deleteAllowed,
  };
};

const normalizeInspectionAction = (
  value: unknown,
  fallback: CodexInspectionAction = 'keep'
): CodexInspectionAction => {
  const normalized = readString(value).toLowerCase();
  if (['keep', 'delete', 'disable', 'enable'].includes(normalized)) {
    return normalized as CodexInspectionAction;
  }
  return fallback;
};

const normalizeStoredActionFilter = (value: unknown): CodexInspectionStoredActionFilter => {
  const normalized = readString(value).toLowerCase();
  if (['all', 'delete', 'disable', 'enable'].includes(normalized)) {
    return normalized as CodexInspectionStoredActionFilter;
  }
  return 'all';
};

const normalizeLogLevel = (value: unknown): CodexInspectionLogLevel => {
  const normalized = readString(value).toLowerCase();
  if (['info', 'success', 'warning', 'error'].includes(normalized)) {
    return normalized as CodexInspectionLogLevel;
  }
  return 'info';
};

const readAuthFileName = (file: AuthFileItem) => {
  const name = readString(file.name);
  if (name) return name;
  const id = readString(file.id);
  if (id) return id;
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  return authIndex || 'unknown-auth-file';
};

const readDisplayAccount = (file: AuthFileItem) =>
  readString(file.account) ||
  readString(file.email) ||
  readString(file.label) ||
  readString(file.name) ||
  readString(file.id) ||
  normalizeAuthIndex(file['auth_index'] ?? file.authIndex) ||
  '-';

const toInspectionAccount = (file: AuthFileItem): CodexInspectionAccount => {
  const accountSource: InspectionAccountSource = isApiKeyInspectionAccount(file) ? 'api_key' : 'oauth';
  const fileName = readAuthFileName(file) || readString(file.id) || readString(file.name) || 'api-key';
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  return {
    key: `${fileName}::${authIndex || '-'}`,
    fileName,
    displayAccount: readDisplayAccount(file),
    authIndex,
    accountId: resolveCodexChatgptAccountId(file),
    provider: resolveAuthProvider(file),
    disabled: isDisabledAuthFile(file),
    status: readString(file.status),
    state: readString(file.state),
    accountSource,
    baseUrl: resolveAccountBaseUrl(file) || undefined,
    compatName: resolveCompatName(file) || undefined,
    raw: file,
  };
};

const readConfigurableSettingsFromConfig = (
  config?: Config | null
): Partial<CodexInspectionConfigurableSettings> => {
  const clean = config?.clean ?? null;
  const cleanRecord = isRecord(clean) ? clean : {};
  return {
    accountSource:
      cleanRecord.accountSource === undefined
        ? undefined
        : normalizeInspectionAccountSource(cleanRecord.accountSource),
    targetType: readString(clean?.targetType),
    workers: normalizeNumberValue(clean?.workers) ?? undefined,
    deleteWorkers: normalizeNumberValue(clean?.deleteWorkers) ?? undefined,
    timeout: normalizeNumberValue(clean?.timeout) ?? undefined,
    retries: normalizeNumberValue(clean?.retries) ?? undefined,
    userAgent: readString(clean?.userAgent),
    usedPercentThreshold: normalizeNumberValue(clean?.usedPercentThreshold) ?? undefined,
    sampleSize: normalizeNumberValue(clean?.sampleSize) ?? undefined,
    probePromptMode:
      cleanRecord.probePromptMode === undefined
        ? undefined
        : normalizeProbePromptMode(cleanRecord.probePromptMode),
    probeModel: readString(cleanRecord.probeModel),
    providerFilter: readString(cleanRecord.providerFilter),
    autoActionMode:
      cleanRecord.autoActionMode === undefined
        ? undefined
        : normalizeAutoActionMode(cleanRecord.autoActionMode),
    realtimeAutoActions:
      cleanRecord.realtimeAutoActions === undefined
        ? undefined
        : normalizeRealtimeAutoActions(cleanRecord.realtimeAutoActions),
  };
};

type CodexInspectionConfigurableSettingsInput = {
  accountSource?: unknown;
  targetType?: unknown;
  workers?: unknown;
  deleteWorkers?: unknown;
  timeout?: unknown;
  retries?: unknown;
  userAgent?: unknown;
  usedPercentThreshold?: unknown;
  sampleSize?: unknown;
  probePromptMode?: unknown;
  probeModel?: unknown;
  providerFilter?: unknown;
  autoExecuteActions?: unknown;
  autoActionMode?: unknown;
  realtimeAutoActions?: unknown;
};

const normalizeConfigurableSettings = (
  input?: CodexInspectionConfigurableSettingsInput | null
): CodexInspectionConfigurableSettings => {
  const merged = {
    ...DEFAULT_CODEX_INSPECTION_SETTINGS,
    ...(input ?? {}),
  };

  const threshold = normalizeThreshold(merged.usedPercentThreshold);
  const retriesValue = normalizeNumberValue(merged.retries);
  const sampleSizeValue = normalizeNumberValue(merged.sampleSize);

  const accountSource = normalizeInspectionAccountSource(
    merged.accountSource,
    DEFAULT_CODEX_INSPECTION_SETTINGS.accountSource
  );
  let targetType =
    readString(merged.targetType).toLowerCase() || DEFAULT_CODEX_INSPECTION_SETTINGS.targetType;
  if (accountSource === 'api_key') {
    targetType = normalizeInspectionApiKeyFamily(targetType, 'all');
  } else if (!isSupportedInspectionTargetType(targetType)) {
    targetType = DEFAULT_CODEX_INSPECTION_SETTINGS.targetType;
  }

  return {
    accountSource,
    targetType,
    workers: clampPositiveInteger(
      normalizeNumberValue(merged.workers) ?? undefined,
      DEFAULT_CODEX_INSPECTION_SETTINGS.workers
    ),
    deleteWorkers: clampPositiveInteger(
      normalizeNumberValue(merged.deleteWorkers) ?? undefined,
      clampPositiveInteger(
        normalizeNumberValue(merged.workers) ?? undefined,
        DEFAULT_CODEX_INSPECTION_SETTINGS.workers
      )
    ),
    timeout: clampPositiveInteger(
      normalizeNumberValue(merged.timeout) ?? undefined,
      DEFAULT_CODEX_INSPECTION_SETTINGS.timeout
    ),
    retries:
      retriesValue === null
        ? DEFAULT_CODEX_INSPECTION_SETTINGS.retries
        : Math.max(0, Math.floor(retriesValue)),
    userAgent: readString(merged.userAgent) || DEFAULT_CODEX_INSPECTION_SETTINGS.userAgent,
    usedPercentThreshold: Number.isFinite(threshold)
      ? Math.max(0, Math.min(100, threshold))
      : DEFAULT_CODEX_INSPECTION_SETTINGS.usedPercentThreshold,
    sampleSize:
      sampleSizeValue === null
        ? DEFAULT_CODEX_INSPECTION_SETTINGS.sampleSize
        : Math.max(0, Math.floor(sampleSizeValue)),
    probePromptMode: normalizeProbePromptMode(
      merged.probePromptMode,
      DEFAULT_CODEX_INSPECTION_SETTINGS.probePromptMode
    ),
    probeModel: readString(merged.probeModel),
    providerFilter: readString(merged.providerFilter),
    autoActionMode: normalizeAutoActionMode(merged.autoActionMode, merged.autoExecuteActions),
    realtimeAutoActions: normalizeRealtimeAutoActions(merged.realtimeAutoActions, accountSource),
  };
};

export const loadCodexInspectionConfigurableSettings = (
  config?: Config | null
): CodexInspectionConfigurableSettings => {
  const configSettings = readConfigurableSettingsFromConfig(config);

  try {
    if (typeof localStorage === 'undefined') {
      return normalizeConfigurableSettings(configSettings);
    }
    const raw = localStorage.getItem(CODEX_INSPECTION_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return normalizeConfigurableSettings(configSettings);
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return normalizeConfigurableSettings(configSettings);
    }
    return normalizeConfigurableSettings({
      ...configSettings,
      ...parsed,
    });
  } catch {
    return normalizeConfigurableSettings(configSettings);
  }
};

export const saveCodexInspectionConfigurableSettings = (
  settings: Partial<CodexInspectionConfigurableSettings>
): CodexInspectionConfigurableSettings => {
  const normalized = normalizeConfigurableSettings(settings);

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CODEX_INSPECTION_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch {
    console.warn('保存 Codex 巡检配置失败');
  }

  return normalized;
};

export const clearCodexInspectionConfigurableSettings = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CODEX_INSPECTION_SETTINGS_STORAGE_KEY);
    }
  } catch {
    console.warn('清除 Codex 巡检配置失败');
  }
};

const sanitizeInspectionSettingsForStorage = (
  settings: CodexInspectionSettings
): CodexInspectionSettings => ({
  baseUrl: '',
  token: '',
  accountSource: normalizeInspectionAccountSource(
    settings.accountSource,
    DEFAULT_CODEX_INSPECTION_SETTINGS.accountSource
  ),
  targetType: readString(settings.targetType) || DEFAULT_CODEX_INSPECTION_SETTINGS.targetType,
  workers: clampPositiveInteger(settings.workers, DEFAULT_CODEX_INSPECTION_SETTINGS.workers),
  deleteWorkers: clampPositiveInteger(
    settings.deleteWorkers,
    DEFAULT_CODEX_INSPECTION_SETTINGS.deleteWorkers
  ),
  timeout: clampPositiveInteger(settings.timeout, DEFAULT_CODEX_INSPECTION_SETTINGS.timeout),
  retries: Math.max(0, Math.floor(normalizeNumberValue(settings.retries) ?? 0)),
  userAgent: readString(settings.userAgent) || DEFAULT_CODEX_INSPECTION_SETTINGS.userAgent,
  usedPercentThreshold:
    normalizeNumberValue(settings.usedPercentThreshold) ??
    DEFAULT_CODEX_INSPECTION_SETTINGS.usedPercentThreshold,
  sampleSize: Math.max(0, Math.floor(normalizeNumberValue(settings.sampleSize) ?? 0)),
  probePromptMode: normalizeProbePromptMode(
    settings.probePromptMode,
    DEFAULT_CODEX_INSPECTION_SETTINGS.probePromptMode
  ),
  probeModel: readString(settings.probeModel),
  providerFilter: readString(settings.providerFilter),
  autoActionMode: normalizeAutoActionMode(settings.autoActionMode),
});

const normalizeStoredSettings = (value: unknown): CodexInspectionSettings => {
  const input = isRecord(value) ? value : {};
  const configurable = normalizeConfigurableSettings({
    accountSource: input.accountSource,
    targetType: input.targetType,
    workers: input.workers,
    deleteWorkers: input.deleteWorkers,
    timeout: input.timeout,
    retries: input.retries,
    userAgent: input.userAgent,
    usedPercentThreshold: input.usedPercentThreshold,
    sampleSize: input.sampleSize,
    probePromptMode: input.probePromptMode,
    probeModel: input.probeModel,
    providerFilter: input.providerFilter,
  });

  return {
    baseUrl: '',
    token: '',
    accountSource: configurable.accountSource,
    targetType: configurable.targetType,
    workers: configurable.workers,
    deleteWorkers: configurable.deleteWorkers,
    timeout: configurable.timeout,
    retries: configurable.retries,
    userAgent: configurable.userAgent,
    usedPercentThreshold: configurable.usedPercentThreshold,
    sampleSize: configurable.sampleSize,
    probePromptMode: configurable.probePromptMode,
    probeModel: configurable.probeModel,
    providerFilter: configurable.providerFilter,
    autoActionMode: configurable.autoActionMode,
  };
};

type StoredCodexInspectionResultItem = Omit<CodexInspectionResultItem, 'raw'>;

const serializeResultItemForStorage = (
  item: CodexInspectionResultItem
): StoredCodexInspectionResultItem => ({
  key: item.key,
  fileName: item.fileName,
  displayAccount: item.displayAccount,
  authIndex: item.authIndex,
  accountId: null,
  provider: item.provider,
  disabled: item.disabled,
  status: item.status,
  state: item.state,
  accountSource: item.accountSource,
  baseUrl: item.baseUrl,
  compatName: item.compatName,
  action: item.action,
  actionReason: item.actionReason,
  statusCode: item.statusCode,
  usedPercent: item.usedPercent,
  isQuota: item.isQuota,
  error: item.error,
});

const hydrateStoredResultItem = (
  value: unknown,
  settings: CodexInspectionSettings
): CodexInspectionResultItem | null => {
  if (!isRecord(value)) return null;
  const fileName = readString(value.fileName);
  if (!fileName) return null;

  const authIndex = readNullableString(value.authIndex);
  const provider = readString(value.provider) || settings.targetType;
  const disabled = readBoolean(value.disabled, false);
  const key = readString(value.key) || `${fileName}::${authIndex || '-'}`;

  return {
    key,
    fileName,
    displayAccount: readString(value.displayAccount) || fileName,
    authIndex,
    accountId: readNullableString(value.accountId),
    provider,
    disabled,
    status: readString(value.status),
    state: readString(value.state),
    accountSource: normalizeInspectionAccountSource(
      value.accountSource,
      settings.accountSource
    ),
    baseUrl: readString(value.baseUrl) || undefined,
    compatName: readString(value.compatName) || undefined,
    raw: {
      name: fileName,
      type: provider,
      authIndex,
      disabled,
      runtime_only: normalizeInspectionAccountSource(value.accountSource, settings.accountSource) === 'api_key',
    },
    action: normalizeInspectionAction(value.action),
    actionReason: readString(value.actionReason),
    statusCode: readNullableNumber(value.statusCode),
    usedPercent: readNullableNumber(value.usedPercent),
    isQuota: readBoolean(value.isQuota, false),
    error: readString(value.error),
  };
};

const buildSummaryFromStoredResult = (
  storedSummary: unknown,
  results: CodexInspectionResultItem[],
  settings: CodexInspectionSettings
): CodexInspectionSummary => {
  const summary = isRecord(storedSummary) ? storedSummary : {};
  const deleteCount = results.filter((item) => item.action === 'delete').length;
  const disableCount = results.filter((item) => item.action === 'disable').length;
  const enableCount = results.filter((item) => item.action === 'enable').length;
  const keepCount = results.length - deleteCount - disableCount - enableCount;
  const plannedActionPreview = results
    .filter((item) => item.action !== 'keep')
    .slice(0, 10)
    .map((item) => `${item.displayAccount} -> ${item.action}`);

  return {
    totalFiles: readNonNegativeInteger(summary.totalFiles, results.length),
    probeSetCount: readNonNegativeInteger(summary.probeSetCount, results.length),
    sampledCount: readNonNegativeInteger(summary.sampledCount, results.length),
    disabledCount: results.filter((item) => item.disabled).length,
    enabledCount: results.filter((item) => !item.disabled).length,
    deleteCount,
    disableCount,
    enableCount,
    keepCount,
    usedPercentThreshold:
      readNullableNumber(summary.usedPercentThreshold) ?? settings.usedPercentThreshold,
    sampled: readBoolean(summary.sampled, false),
    plannedActionPreview,
  };
};

const hydrateStoredLogEntry = (value: unknown): CodexInspectionStoredLogEntry | null => {
  if (!isRecord(value)) return null;
  const message = readString(value.message);
  if (!message) return null;
  const timestamp = readNullableNumber(value.timestamp) ?? Date.now();
  const id = readString(value.id) || `${timestamp}-${message.slice(0, 12)}`;

  return {
    id,
    level: normalizeLogLevel(value.level),
    message,
    timestamp,
  };
};

export const serializeCodexInspectionLastRun = ({
  result,
  logs,
  logsCollapsed = true,
  actionFilter = 'all',
  connectionFingerprint = null,
}: {
  result: CodexInspectionRunResult;
  logs?: CodexInspectionStoredLogEntry[];
  logsCollapsed?: boolean;
  actionFilter?: CodexInspectionStoredActionFilter;
  connectionFingerprint?: string | null;
}) => ({
  version: CODEX_INSPECTION_LAST_RUN_STORAGE_VERSION,
  savedAt: Date.now(),
  logsCollapsed,
  actionFilter,
  connectionFingerprint: readNullableString(connectionFingerprint),
  result: {
    settings: sanitizeInspectionSettingsForStorage(result.settings),
    results: result.results.map(serializeResultItemForStorage),
    summary: result.summary,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
  },
  logs: (logs ?? []).slice(-500),
});

export const hydrateCodexInspectionLastRun = (
  value: unknown,
  options: { expectedConnectionFingerprint?: string | null } = {}
): CodexInspectionLastRunState | null => {
  if (!isRecord(value)) return null;
  if (value.version !== CODEX_INSPECTION_LAST_RUN_STORAGE_VERSION) return null;
  if (!isRecord(value.result)) return null;

  const connectionFingerprint = readNullableString(value.connectionFingerprint);
  const expectedConnectionFingerprint = readNullableString(options.expectedConnectionFingerprint);
  if (expectedConnectionFingerprint && connectionFingerprint !== expectedConnectionFingerprint) {
    return null;
  }

  const settings = normalizeStoredSettings(value.result.settings);
  const resultItemsRaw = Array.isArray(value.result.results) ? value.result.results : [];
  const results = sortResults(
    resultItemsRaw
      .map((item) => hydrateStoredResultItem(item, settings))
      .filter((item): item is CodexInspectionResultItem => item !== null)
  );

  const startedAt = readNullableNumber(value.result.startedAt) ?? Date.now();
  const finishedAt = readNullableNumber(value.result.finishedAt) ?? startedAt;
  const logsRaw = Array.isArray(value.logs) ? value.logs : [];
  const logs = logsRaw
    .map(hydrateStoredLogEntry)
    .filter((item): item is CodexInspectionStoredLogEntry => item !== null)
    .slice(-500);

  return {
    result: {
      settings,
      files: [],
      results,
      summary: buildSummaryFromStoredResult(value.result.summary, results, settings),
      startedAt,
      finishedAt,
    },
    logs,
    logsCollapsed: readBoolean(value.logsCollapsed, true),
    actionFilter: normalizeStoredActionFilter(value.actionFilter),
    connectionFingerprint,
    savedAt: readNullableNumber(value.savedAt) ?? finishedAt,
  };
};

export const loadCodexInspectionLastRun = (
  expectedConnectionFingerprint?: string | null
): CodexInspectionLastRunState | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CODEX_INSPECTION_LAST_RUN_STORAGE_KEY);
    if (!raw) return null;
    return hydrateCodexInspectionLastRun(JSON.parse(raw), { expectedConnectionFingerprint });
  } catch {
    return null;
  }
};

export const saveCodexInspectionLastRun = (
  input: Parameters<typeof serializeCodexInspectionLastRun>[0]
) => {
  const payload = serializeCodexInspectionLastRun(input);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CODEX_INSPECTION_LAST_RUN_STORAGE_KEY, JSON.stringify(payload));
    }
  } catch {
    console.warn('保存 Codex 巡检记录失败');
  }
  return hydrateCodexInspectionLastRun(payload);
};

export const clearCodexInspectionLastRun = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CODEX_INSPECTION_LAST_RUN_STORAGE_KEY);
    }
  } catch {
    console.warn('清除 Codex 巡检记录失败');
  }
};

const pickSample = <T>(items: T[], sampleSize: number): T[] => {
  if (sampleSize <= 0 || sampleSize >= items.length) return [...items];

  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, sampleSize);
};

const withRetry = async <T>(
  retries: number,
  task: () => Promise<T>
): Promise<{ value: T } | { error: unknown; allTimeouts: boolean; attempts: number }> => {
  let lastError: unknown;
  let timeoutFailures = 0;
  let totalFailures = 0;
  const maxAttempts = Math.max(0, Math.floor(retries)) + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return { value: await task() };
    } catch (error) {
      lastError = error;
      totalFailures += 1;
      if (isTimeoutError(error)) {
        timeoutFailures += 1;
      }
    }
  }

  return {
    error: lastError,
    allTimeouts: totalFailures > 0 && timeoutFailures === totalFailures,
    attempts: totalFailures,
  };
};

const runConcurrently = async <T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) return [];

  const size = clampPositiveInteger(limit, 1);
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => worker()));
  return results;
};

type CodexInspectionDecision = Pick<
  CodexInspectionResultItem,
  'action' | 'actionReason' | 'usedPercent' | 'isQuota'
>;

const resolveLegacyProbeAction = (
  account: CodexInspectionAccount,
  statusCode: number,
  bodyText: string,
  usedPercent: number | null,
  isQuota: boolean,
  threshold: number
): CodexInspectionDecision => {
  const overThreshold = usedPercent !== null && usedPercent >= threshold;
  if (isCodexInvalidAccountResponse(statusCode, bodyText)) {
    return {
      action: 'delete',
      actionReason: `接口返回 ${statusCode || '认证失效'}，建议删除失效账号`,
      usedPercent,
      isQuota: false,
    };
  }
  if (isQuota || overThreshold) {
    if (account.disabled) {
      return {
        action: 'keep',
        actionReason: overThreshold ? '额度超阈值，但账号已禁用' : '额度已耗尽，但账号已禁用',
        usedPercent,
        isQuota,
      };
    }
    return {
      action: 'disable',
      actionReason: overThreshold ? '额度超阈值，建议禁用账号' : '额度已耗尽，建议禁用账号',
      usedPercent,
      isQuota,
    };
  }
  if (statusCode === 200 && account.disabled) {
    return {
      action: 'enable',
      actionReason: '账号恢复健康，建议重新启用',
      usedPercent,
      isQuota: false,
    };
  }
  return {
    action: 'keep',
    actionReason: '无需处理',
    usedPercent,
    isQuota: false,
  };
};

const resolveWindowAwareProbeAction = (
  account: CodexInspectionAccount,
  statusCode: number,
  bodyText: string,
  rateLimit: CodexRateLimitInfo | null,
  threshold: number,
  options: { disableFiveHourOverThreshold?: boolean } = {}
): CodexInspectionDecision | null => {
  if (!rateLimit) return null;

  const { fiveHourWindow, weeklyWindow } = classifyCodexRateLimitWindows(rateLimit);
  const weeklyUsedPercent = getCodexQuotaWindowUsedPercent(weeklyWindow);
  if (!weeklyWindow || weeklyUsedPercent === null) return null;

  const fiveHourUsedPercent = getCodexQuotaWindowUsedPercent(fiveHourWindow);
  const weeklyOverThreshold = weeklyUsedPercent >= threshold;
  const fiveHourOverThreshold = fiveHourUsedPercent !== null && fiveHourUsedPercent >= threshold;

  if (isCodexInvalidAccountResponse(statusCode, bodyText)) {
    return {
      action: 'delete',
      actionReason: `接口返回 ${statusCode || '认证失效'}，建议删除失效账号`,
      usedPercent: weeklyUsedPercent,
      isQuota: false,
    };
  }

  if (weeklyOverThreshold) {
    if (account.disabled) {
      return {
        action: 'keep',
        actionReason: '周额度达到阈值，但账号已禁用',
        usedPercent: weeklyUsedPercent,
        isQuota: true,
      };
    }
    return {
      action: 'disable',
      actionReason: '周额度达到阈值，建议禁用账号',
      usedPercent: weeklyUsedPercent,
      isQuota: true,
    };
  }

  if (fiveHourOverThreshold && options.disableFiveHourOverThreshold) {
    if (account.disabled) {
      return {
        action: 'keep',
        actionReason: '5 小时额度达到阈值，但账号已禁用',
        usedPercent: weeklyUsedPercent,
        isQuota: true,
      };
    }
    return {
      action: 'disable',
      actionReason: '5 小时额度达到阈值，建议禁用账号',
      usedPercent: weeklyUsedPercent,
      isQuota: true,
    };
  }

  if (account.disabled) {
    return {
      action: 'enable',
      actionReason: fiveHourOverThreshold
        ? '5 小时额度达到阈值，但周额度仍可用，建议立即启用账号'
        : '周额度仍可用，建议立即启用账号',
      usedPercent: weeklyUsedPercent,
      isQuota: false,
    };
  }

  if (fiveHourOverThreshold) {
    return {
      action: 'keep',
      actionReason: '5 小时额度达到阈值，但周额度仍可用，暂不禁用账号',
      usedPercent: weeklyUsedPercent,
      isQuota: false,
    };
  }

  return {
    action: 'keep',
    actionReason: '周额度仍可用，无需处理',
    usedPercent: weeklyUsedPercent,
    isQuota: false,
  };
};

const resolveProbeAction = (
  account: CodexInspectionAccount,
  statusCode: number,
  bodyText: string,
  rateLimit: CodexRateLimitInfo | null,
  usedPercent: number | null,
  isQuota: boolean,
  threshold: number,
  retries: number,
  autoActionMode: CodexInspectionAutoActionMode
): CodexInspectionDecision => {
  if (isCodexInvalidAccountResponse(statusCode, bodyText)) {
    return {
      action: 'delete',
      actionReason: `接口返回 ${statusCode || '认证失效'}，建议删除失效账号`,
      usedPercent,
      isQuota: false,
    };
  }

  if (isAdvancedAutoActionMode(autoActionMode) && statusCode !== 200 && retries > 1) {
    if (account.disabled) {
      return {
        action: 'keep',
        actionReason: '重试后仍非 200，但账号已禁用',
        usedPercent,
        isQuota,
      };
    }
    return {
      action: 'disable',
      actionReason: `重试 ${retries} 次后仍非 200，建议禁用账号`,
      usedPercent,
      isQuota,
    };
  }

  const windowAwareDecision = resolveWindowAwareProbeAction(
    account,
    statusCode,
    bodyText,
    rateLimit,
    threshold,
    { disableFiveHourOverThreshold: isAdvancedAutoActionMode(autoActionMode) }
  );
  if (windowAwareDecision) return windowAwareDecision;

  // Non-200 responses without codex-specific window data: prefer disable over keep.
  if (statusCode !== 200 && statusCode !== 0) {
    if (account.disabled) {
      return {
        action: 'keep',
        actionReason: `接口返回 ${statusCode}，但账号已禁用`,
        usedPercent,
        isQuota,
      };
    }
    return {
      action: 'disable',
      actionReason: `接口返回 ${statusCode}，建议禁用账号`,
      usedPercent,
      isQuota,
    };
  }

  return resolveLegacyProbeAction(account, statusCode, bodyText, usedPercent, isQuota, threshold);
};


type InspectionProbeSnapshot = {
  statusCode: number | null;
  /** Lowercased body text used for classification heuristics. */
  bodyText: string;
  /** Original response snippet for operator logs (not lowercased). */
  responsePreview: string;
  usedPercent: number | null;
  rateLimit: CodexRateLimitInfo | null;
  isQuotaHint: boolean;
};

const MAX_PROBE_RESPONSE_PREVIEW_CHARS = 280;

export const formatInspectionResponsePreview = (raw: unknown, max = MAX_PROBE_RESPONSE_PREVIEW_CHARS) => {
  let text = '';
  if (typeof raw === 'string') {
    text = raw;
  } else if (raw === null || raw === undefined) {
    text = '';
  } else {
    try {
      text = JSON.stringify(raw);
    } catch {
      text = String(raw);
    }
  }
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
};

const toProbeBodyFields = (raw: unknown) => {
  const responsePreview = formatInspectionResponsePreview(raw);
  return {
    bodyText: responsePreview.toLowerCase(),
    responsePreview,
  };
};

/** Append response body after status for non-200 logs; skip body on HTTP 200. */
export const formatInspectionProbeBodyLog = (
  statusCode: number | null | undefined,
  responsePreview: string | undefined
) => {
  if (statusCode === 200) return '';
  const body = String(responsePreview || '').trim();
  if (!body) return '';
  return ` · ${body}`;
};

const maxUsedPercent = (values: Array<number | null | undefined>) => {
  const numbers = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  if (numbers.length === 0) return null;
  return Math.max(...numbers);
};

const extractClaudeUsedPercent = (payload: ReturnType<typeof parseClaudeUsagePayload>) => {
  if (!payload) return null;
  const keys = [
    'five_hour',
    'seven_day',
    'seven_day_oauth_apps',
    'seven_day_opus',
    'seven_day_sonnet',
    'seven_day_cowork',
    'iguana_necktie',
  ] as const;
  return maxUsedPercent(
    keys.map((key) => {
      const window = payload[key as keyof typeof payload];
      if (!window || typeof window !== 'object' || !('utilization' in window)) return null;
      return normalizeNumberValue((window as { utilization?: unknown }).utilization);
    })
  );
};

const extractKimiUsedPercent = (payload: ReturnType<typeof parseKimiUsagePayload>) => {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const candidates: Array<number | null> = [];
  const pushMaybe = (value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const item = value as Record<string, unknown>;
      candidates.push(
        normalizeNumberValue(item.used_percent ?? item.usedPercent ?? item.utilization ?? item.usage)
      );
    }
  };
  if (Array.isArray(record.models)) {
    record.models.forEach(pushMaybe);
  }
  Object.values(record).forEach((value) => {
    if (Array.isArray(value)) value.forEach(pushMaybe);
    else pushMaybe(value);
  });
  return maxUsedPercent(candidates);
};

const extractAntigravityUsedPercent = (payload: Record<string, unknown> | null) => {
  if (!payload) return null;
  const groupsRaw =
    (Array.isArray(payload.groups) && payload.groups) ||
    (payload.models &&
    typeof payload.models === 'object' &&
    !Array.isArray(payload.models) &&
    Array.isArray((payload.models as Record<string, unknown>).groups)
      ? ((payload.models as Record<string, unknown>).groups as unknown[])
      : null);
  if (!Array.isArray(groupsRaw) || groupsRaw.length === 0) return null;

  const usedPercents = groupsRaw.map((group) => {
    if (!group || typeof group !== 'object') return null;
    const record = group as Record<string, unknown>;
    const remaining = normalizeNumberValue(
      record.remainingFraction ?? record.remaining_fraction ?? record.remaining
    );
    if (remaining === null) {
      return normalizeNumberValue(record.usedPercent ?? record.used_percent ?? record.utilization);
    }
    // remaining is usually 0~1 fraction
    if (remaining >= 0 && remaining <= 1) {
      return Math.max(0, Math.min(100, (1 - remaining) * 100));
    }
    return null;
  });
  return maxUsedPercent(usedPercents);
};

const extractGeminiCliUsedPercent = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const buckets =
    (Array.isArray(record.buckets) && record.buckets) ||
    (Array.isArray(record.quotaBuckets) && record.quotaBuckets) ||
    (Array.isArray(record.models) && record.models) ||
    [];
  const values = (buckets as unknown[]).map((item) => {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    const remaining = normalizeNumberValue(
      row.remainingFraction ?? row.remaining_fraction ?? row.remaining
    );
    if (remaining !== null && remaining >= 0 && remaining <= 1) {
      return Math.max(0, Math.min(100, (1 - remaining) * 100));
    }
    return normalizeNumberValue(row.usedPercent ?? row.used_percent ?? row.utilization);
  });
  return maxUsedPercent(values);
};

const probeCodexAccount = async (
  account: CodexInspectionAccount,
  settings: CodexInspectionSettings,
  requestConfig: AxiosRequestConfig
): Promise<InspectionProbeSnapshot> => {
  const { result, payload } = await requestCodexUsageRaw({
    authIndex: account.authIndex || '',
    accountId: account.accountId,
    userAgent: settings.userAgent,
    requestConfig,
  });
  const rateLimit = payload?.rate_limit ?? payload?.rateLimit ?? null;
  const usedPercent = deriveCodexRateLimitUsedPercent(rateLimit);
  const bodyFields = toProbeBodyFields(result.bodyText || result.body);
  return {
    statusCode: result.statusCode ?? null,
    ...bodyFields,
    usedPercent,
    rateLimit: rateLimit ?? null,
    isQuotaHint:
      isCodexRateLimitReached(rateLimit) ||
      (usedPercent !== null && usedPercent >= settings.usedPercentThreshold),
  };
};

const probeClaudeAccount = async (
  account: CodexInspectionAccount,
  requestConfig: AxiosRequestConfig
): Promise<InspectionProbeSnapshot> => {
  const result = await apiCallApi.request(
    {
      authIndex: account.authIndex || '',
      method: 'GET',
      url: CLAUDE_USAGE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    },
    requestConfig
  );
  const payload = parseClaudeUsagePayload(result.body ?? result.bodyText);
  const usedPercent = extractClaudeUsedPercent(payload);
  return {
    statusCode: result.statusCode ?? null,
    ...toProbeBodyFields(result.bodyText || result.body),
    usedPercent,
    rateLimit: null,
    isQuotaHint: usedPercent !== null && usedPercent >= 100,
  };
};

const XAI_CHAT_COMPLETIONS_URL = 'https://cli-chat-proxy.grok.com/v1/chat/completions';
const XAI_PROBE_HEADERS = {
  ...XAI_REQUEST_HEADERS,
  // grok/xai cli proxy commonly expects these client headers
  'X-XAI-Token-Auth': 'xai-grok-cli',
  'x-grok-client-version': '0.2.93',
  'x-grok-client-identifier': 'grok-shell',
  'User-Agent': 'grok-shell/0.2.93 (linux; x86_64)',
} as const;

const resolveXaiChatCompletionsUrl = (account: CodexInspectionAccount) => {
  const raw = account.raw as Record<string, unknown> | null | undefined;
  const metadata =
    raw && typeof raw.metadata === 'object' && raw.metadata !== null
      ? (raw.metadata as Record<string, unknown>)
      : null;
  const baseUrl = readString(
    raw?.base_url ?? raw?.baseUrl ?? metadata?.base_url ?? metadata?.baseUrl
  ).replace(/\/+$/, '');
  if (!baseUrl) return XAI_CHAT_COMPLETIONS_URL;
  if (baseUrl.endsWith('/chat/completions')) return baseUrl;
  if (baseUrl.endsWith('/v1')) return `${baseUrl}/chat/completions`;
  return `${baseUrl}/v1/chat/completions`;
};

const isXaiQuotaExhaustedResponse = (statusCode: number | null, bodyText: string) => {
  if (statusCode === 402) return true;
  if (statusCode === 429) {
    // free-usage / rate-limit exhausted should disable; pure transient rate limit
    // without exhausted wording still treated as unhealthy for inspection.
    return true;
  }
  return QUOTA_BODY_PATTERNS.some((pattern) => bodyText.includes(pattern));
};

const probeXaiAccount = async (
  account: CodexInspectionAccount,
  settings: CodexInspectionSettings,
  requestConfig: AxiosRequestConfig
): Promise<InspectionProbeSnapshot> => {
  const authIndex = account.authIndex || '';
  const chatUrl = resolveXaiChatCompletionsUrl(account);
  const probePrompt = buildInspectionProbePrompt(settings.probePromptMode);
  const xaiHeaders = {
    ...XAI_PROBE_HEADERS,
    ...(settings.userAgent ? { 'User-Agent': settings.userAgent } : {}),
  };

  // Billing alone is insufficient: free usage can be exhausted for chat while
  // billing still returns 200. Probe a minimal chat completion as ground truth.
  const [billingResult, chatResult] = await Promise.allSettled([
    apiCallApi.request(
      {
        authIndex,
        method: 'GET',
        url: XAI_BILLING_URL,
        header: { ...xaiHeaders },
      },
      requestConfig
    ),
    apiCallApi.request(
      {
        authIndex,
        method: 'POST',
        url: chatUrl,
        header: {
          ...xaiHeaders,
          'Content-Type': 'application/json',
        },
        data: JSON.stringify({
          model: 'grok-4.5',
          messages: [{ role: 'user', content: probePrompt }],
          max_tokens: 16,
          stream: false,
        }),
      },
      requestConfig
    ),
  ]);

  const billing =
    billingResult.status === 'fulfilled'
      ? billingResult.value
      : null;
  const chat =
    chatResult.status === 'fulfilled'
      ? chatResult.value
      : null;

  const billingBody = toProbeBodyFields(billing?.bodyText || billing?.body);
  const chatBody = toProbeBodyFields(chat?.bodyText || chat?.body);
  const chatErrorPreview =
    chatResult.status === 'rejected'
      ? formatInspectionResponsePreview(
          chatResult.reason instanceof Error
            ? chatResult.reason.message
            : chatResult.reason || ''
        )
      : '';
  const chatErrorText = chatErrorPreview.toLowerCase();

  const payload = billing ? parseXaiBillingPayload(billing.body ?? billing.bodyText) : null;
  const summary =
    buildXaiBillingSummary(payload?.config) ||
    buildXaiBillingSummary((payload as { monthlyLimit?: unknown } | null) as never) ||
    null;
  const usedPercent = summary?.usedPercent ?? null;

  const chatStatusCode = chat?.statusCode ?? null;
  const billingStatusCode = billing?.statusCode ?? null;

  // Prefer chat probe outcome when available: it matches real routing failures (429 free usage).
  const preferredStatusCode =
    chatStatusCode && chatStatusCode !== 0
      ? chatStatusCode
      : billingStatusCode && billingStatusCode !== 0
        ? billingStatusCode
        : chatStatusCode ?? billingStatusCode ?? null;

  const combinedPreview = [chatBody.responsePreview, chatErrorPreview, billingBody.responsePreview]
    .filter(Boolean)
    .join(' | ');
  const combinedBodyText = combinedPreview.toLowerCase();

  const quotaHint =
    isXaiQuotaExhaustedResponse(preferredStatusCode, combinedBodyText) ||
    (usedPercent !== null && usedPercent >= 100);

  // If chat probe failed at transport layer with request-failed style message, surface it.
  if (!preferredStatusCode && chatErrorText) {
    return {
      statusCode: null,
      bodyText: chatErrorText,
      responsePreview: chatErrorPreview,
      usedPercent,
      rateLimit: null,
      isQuotaHint: quotaHint,
    };
  }

  return {
    statusCode: preferredStatusCode,
    bodyText: combinedBodyText,
    responsePreview: combinedPreview,
    usedPercent,
    rateLimit: null,
    isQuotaHint: quotaHint,
  };
};

const probeKimiAccount = async (
  account: CodexInspectionAccount,
  requestConfig: AxiosRequestConfig
): Promise<InspectionProbeSnapshot> => {
  const result = await apiCallApi.request(
    {
      authIndex: account.authIndex || '',
      method: 'GET',
      url: KIMI_USAGE_URL,
      header: { ...KIMI_REQUEST_HEADERS },
    },
    requestConfig
  );
  const payload = parseKimiUsagePayload(result.body ?? result.bodyText);
  const usedPercent = extractKimiUsedPercent(payload);
  return {
    statusCode: result.statusCode ?? null,
    ...toProbeBodyFields(result.bodyText || result.body),
    usedPercent,
    rateLimit: null,
    isQuotaHint: usedPercent !== null && usedPercent >= 100,
  };
};

const probeAntigravityAccount = async (
  account: CodexInspectionAccount,
  requestConfig: AxiosRequestConfig
): Promise<InspectionProbeSnapshot> => {
  let lastResult: ApiCallResult | null = null;
  let lastPayload: Record<string, unknown> | null = null;

  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    const result = await apiCallApi.request(
      {
        authIndex: account.authIndex || '',
        method: 'POST',
        url,
        header: { ...ANTIGRAVITY_REQUEST_HEADERS },
        data: '{}',
      },
      requestConfig
    );
    lastResult = result;
    if (result.statusCode >= 200 && result.statusCode < 300) {
      lastPayload = parseAntigravityPayload(result.body ?? result.bodyText);
      if (lastPayload) break;
    }
  }

  const usedPercent = extractAntigravityUsedPercent(lastPayload);
  return {
    statusCode: lastResult?.statusCode ?? null,
    ...toProbeBodyFields(lastResult?.bodyText || lastResult?.body),
    usedPercent,
    rateLimit: null,
    isQuotaHint: usedPercent !== null && usedPercent >= 100,
  };
};

const probeGeminiCliAccount = async (
  account: CodexInspectionAccount,
  requestConfig: AxiosRequestConfig
): Promise<InspectionProbeSnapshot> => {
  const projectId = resolveGeminiCliProjectId(account.raw) || '';
  const result = await apiCallApi.request(
    {
      authIndex: account.authIndex || '',
      method: 'POST',
      url: GEMINI_CLI_QUOTA_URL,
      header: { ...GEMINI_CLI_REQUEST_HEADERS },
      data: JSON.stringify(projectId ? { project: projectId } : {}),
    },
    requestConfig
  );
  const payload = parseGeminiCliQuotaPayload(result.body ?? result.bodyText);
  const usedPercent = extractGeminiCliUsedPercent(payload);
  return {
    statusCode: result.statusCode ?? null,
    ...toProbeBodyFields(result.bodyText || result.body),
    usedPercent,
    rateLimit: null,
    isQuotaHint: usedPercent !== null && usedPercent >= 100,
  };
};


const joinApiBasePath = (baseUrl: string, path: string) => {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  if (!base) return suffix;
  if (/\/v\d+$/i.test(base)) {
    // base already ends with /v1
    return `${base}${suffix.replace(/^\/v\d+/i, '')}`;
  }
  return `${base}${suffix.startsWith('/v') ? suffix : suffix}`;
};

const resolveApiKeyProbeModel = (
  account: CodexInspectionAccount,
  settings: CodexInspectionSettings
) => {
  const configured = readString(settings.probeModel);
  if (configured) return configured;
  const raw = account.raw as Record<string, unknown>;
  const metadata =
    raw && typeof raw.metadata === 'object' && raw.metadata !== null
      ? (raw.metadata as Record<string, unknown>)
      : null;
  const fromMeta = firstNonEmptyString(
    raw.model,
    raw.default_model,
    raw.defaultModel,
    metadata?.model,
    metadata?.default_model,
    metadata?.defaultModel
  );
  if (fromMeta) return fromMeta;
  const family = resolveInspectionApiKeyFamily(account.provider);
  if (family === 'claude-apikey') return 'claude-3-5-haiku-latest';
  if (family === 'gemini-apikey') return 'gemini-2.0-flash';
  if (family === 'vertex-apikey') return 'gemini-2.0-flash';
  return 'gpt-4o-mini';
};

const buildApiKeyAuthHeaders = (
  settings: CodexInspectionSettings,
  extra?: Record<string, string>
): Record<string, string> => {
  const headers: Record<string, string> = {
    Authorization: 'Bearer $TOKEN$',
    'Content-Type': 'application/json',
    ...(extra || {}),
  };
  const userAgent = readString(settings.userAgent);
  if (userAgent) headers['User-Agent'] = userAgent;
  return headers;
};

const probeApiKeyModels = async (
  account: CodexInspectionAccount,
  settings: CodexInspectionSettings,
  requestConfig: AxiosRequestConfig,
  modelsUrl: string,
  extraHeaders?: Record<string, string>
): Promise<InspectionProbeSnapshot> => {
  const result = await apiCallApi.request(
    {
      authIndex: account.authIndex || '',
      method: 'GET',
      url: modelsUrl,
      header: buildApiKeyAuthHeaders(settings, extraHeaders),
    },
    requestConfig
  );
  return {
    statusCode: result.statusCode ?? null,
    ...toProbeBodyFields(result.bodyText || result.body),
    usedPercent: null,
    rateLimit: null,
    isQuotaHint: false,
  };
};

const probeApiKeyChatCompletions = async (
  account: CodexInspectionAccount,
  settings: CodexInspectionSettings,
  requestConfig: AxiosRequestConfig,
  chatUrl: string,
  extraHeaders?: Record<string, string>
): Promise<InspectionProbeSnapshot> => {
  const model = resolveApiKeyProbeModel(account, settings);
  const prompt = buildInspectionProbePrompt(settings.probePromptMode);
  const result = await apiCallApi.request(
    {
      authIndex: account.authIndex || '',
      method: 'POST',
      url: chatUrl,
      header: buildApiKeyAuthHeaders(settings, extraHeaders),
      data: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 8,
        stream: false,
      }),
    },
    requestConfig
  );
  return {
    statusCode: result.statusCode ?? null,
    ...toProbeBodyFields(result.bodyText || result.body),
    usedPercent: null,
    rateLimit: null,
    isQuotaHint: false,
  };
};

const probeApiKeyClaudeMessages = async (
  account: CodexInspectionAccount,
  settings: CodexInspectionSettings,
  requestConfig: AxiosRequestConfig,
  baseUrl: string
): Promise<InspectionProbeSnapshot> => {
  const model = resolveApiKeyProbeModel(account, settings);
  const prompt = buildInspectionProbePrompt(settings.probePromptMode);
  const url = joinApiBasePath(baseUrl || 'https://api.anthropic.com', '/v1/messages');
  // Anthropic uses x-api-key; management api-call also substitutes $TOKEN$ in any header value.
  const result = await apiCallApi.request(
    {
      authIndex: account.authIndex || '',
      method: 'POST',
      url,
      header: buildApiKeyAuthHeaders(settings, {
        'x-api-key': '$TOKEN$',
        'anthropic-version': '2023-06-01',
      }),
      data: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: 'user', content: prompt }],
      }),
    },
    requestConfig
  );
  return {
    statusCode: result.statusCode ?? null,
    ...toProbeBodyFields(result.bodyText || result.body),
    usedPercent: null,
    rateLimit: null,
    isQuotaHint: false,
  };
};

const probeApiKeyGemini = async (
  account: CodexInspectionAccount,
  settings: CodexInspectionSettings,
  requestConfig: AxiosRequestConfig,
  baseUrl: string
): Promise<InspectionProbeSnapshot> => {
  // Prefer models list; Gemini often expects key as query, but api-call injects bearer via $TOKEN$.
  // Many gemini-compatible gateways accept Authorization bearer.
  const modelsUrl = baseUrl
    ? joinApiBasePath(baseUrl, '/v1beta/models')
    : 'https://generativelanguage.googleapis.com/v1beta/models';
  try {
    const listed = await probeApiKeyModels(account, settings, requestConfig, modelsUrl);
    if (listed.statusCode && listed.statusCode >= 200 && listed.statusCode < 300) {
      return listed;
    }
    // Fallback: generateContent-style minimal call via OpenAI-compatible path if base is custom gateway.
    if (baseUrl) {
      const chatUrl = buildApiKeyModelsUrl(baseUrl).replace(/\/models\/?$/i, '/chat/completions');
      return probeApiKeyChatCompletions(account, settings, requestConfig, chatUrl);
    }
    return listed;
  } catch {
    if (baseUrl) {
      const chatUrl = buildApiKeyModelsUrl(baseUrl).replace(/\/models\/?$/i, '/chat/completions');
      return probeApiKeyChatCompletions(account, settings, requestConfig, chatUrl);
    }
    throw new Error('gemini api key probe failed');
  }
};

const probeApiKeyAccount = async (
  account: CodexInspectionAccount,
  settings: CodexInspectionSettings,
  requestConfig: AxiosRequestConfig
): Promise<InspectionProbeSnapshot> => {
  const baseUrl = readString(account.baseUrl) || resolveAccountBaseUrl(account.raw);
  const family =
    resolveInspectionApiKeyFamily(account.provider) ||
    normalizeInspectionApiKeyFamily(settings.targetType, 'openai-compat');

  // Claude API key: messages endpoint (no usage OAuth URL).
  if (family === 'claude-apikey') {
    return probeApiKeyClaudeMessages(account, settings, requestConfig, baseUrl);
  }

  // Gemini / Vertex API key
  if (family === 'gemini-apikey' || family === 'vertex-apikey') {
    if (!baseUrl && family === 'vertex-apikey') {
      return {
        statusCode: null,
        bodyText: 'missing base_url',
        responsePreview: 'missing base_url',
        usedPercent: null,
        rateLimit: null,
        isQuotaHint: false,
      };
    }
    return probeApiKeyGemini(account, settings, requestConfig, baseUrl);
  }

  // OpenAI-compatible + codex-apikey (+ default): models then optional chat fallback.
  if (!baseUrl) {
    return {
      statusCode: null,
      bodyText: 'missing base_url',
      responsePreview: 'missing base_url',
      usedPercent: null,
      rateLimit: null,
      isQuotaHint: false,
    };
  }

  const modelsUrl = buildApiKeyModelsUrl(baseUrl);
  const modelsSnapshot = await probeApiKeyModels(account, settings, requestConfig, modelsUrl);
  if (
    modelsSnapshot.statusCode &&
    modelsSnapshot.statusCode >= 200 &&
    modelsSnapshot.statusCode < 300
  ) {
    return modelsSnapshot;
  }

  // Chat fallback when models is unavailable (some gateways disable /models).
  const chatUrl = modelsUrl.replace(/\/models\/?$/i, '/chat/completions');
  try {
    const chatSnapshot = await probeApiKeyChatCompletions(
      account,
      settings,
      requestConfig,
      chatUrl
    );
    // Prefer chat outcome if models was 404/405; otherwise keep models status for auth errors.
    if (
      modelsSnapshot.statusCode === 404 ||
      modelsSnapshot.statusCode === 405 ||
      modelsSnapshot.statusCode === 501 ||
      !modelsSnapshot.statusCode
    ) {
      return chatSnapshot;
    }
    if (chatSnapshot.statusCode && chatSnapshot.statusCode >= 200 && chatSnapshot.statusCode < 300) {
      return chatSnapshot;
    }
    // Auth failures: keep models snapshot (or chat if it has clearer body).
    if (modelsSnapshot.statusCode === 401 || modelsSnapshot.statusCode === 403) {
      return modelsSnapshot;
    }
    return chatSnapshot.responsePreview ? chatSnapshot : modelsSnapshot;
  } catch {
    return modelsSnapshot;
  }
};

const probeAccountByType = async (
  account: CodexInspectionAccount,
  settings: CodexInspectionSettings,
  requestConfig: AxiosRequestConfig
): Promise<InspectionProbeSnapshot> => {
  if (settings.accountSource === 'api_key' || account.accountSource === 'api_key') {
    return probeApiKeyAccount(account, settings, requestConfig);
  }
  const targetType = readString(settings.targetType || account.provider).toLowerCase();
  switch (targetType) {
    case 'claude':
      return probeClaudeAccount(account, requestConfig);
    case 'xai':
    case 'grok':
      return probeXaiAccount(account, settings, requestConfig);
    case 'kimi':
      return probeKimiAccount(account, requestConfig);
    case 'antigravity':
      return probeAntigravityAccount(account, requestConfig);
    case 'gemini-cli':
    case 'gemini':
      return probeGeminiCliAccount(account, requestConfig);
    case 'codex':
    default:
      return probeCodexAccount(account, settings, requestConfig);
  }
};

const inspectSingleAccount = async (
  account: CodexInspectionAccount,
  settings: CodexInspectionSettings,
  onLog?: LogHandler
): Promise<CodexInspectionResultItem> => {
  if (!account.authIndex) {
    onLog?.('warning', `${account.displayAccount} 缺少 auth_index，跳过探测`);
    return {
      ...account,
      action: 'keep',
      actionReason: '缺少 auth_index，保留账号',
      statusCode: null,
      usedPercent: null,
      isQuota: false,
      error: '缺少 auth_index',
    };
  }

  const requestConfig: AxiosRequestConfig =
    settings.timeout > 0 ? { timeout: settings.timeout } : {};

  const probeOutcome = await withRetry(settings.retries, () =>
    probeAccountByType(account, settings, requestConfig)
  );

  if ('error' in probeOutcome) {
    const error = probeOutcome.error;
    const errorMessage = error instanceof Error ? error.message : String(error || '探测失败');
    const statusMatch = errorMessage.match(/\b(40[1-3]|429|5\d\d)\b/);
    const statusCode = statusMatch ? Number(statusMatch[1]) : null;
    const normalizedError = errorMessage.toLowerCase();
    const looksLikeTimeout =
      probeOutcome.allTimeouts || isTimeoutError(error) || isTimeoutErrorText(errorMessage);

    // Timeout counts as non-200. After all attempts are exhausted and every attempt timed out,
    // suggest disable (same outcome family as non-200 probe failures).
    if (looksLikeTimeout) {
      const attempts = Math.max(1, probeOutcome.attempts || settings.retries + 1);
      if (account.disabled) {
        onLog?.(
          'warning',
          `${account.displayAccount} -> keep (timeout · already disabled · attempts ${attempts})`
        );
        return {
          ...account,
          action: 'keep',
          actionReason: attempts > 1
            ? `探测超时 ${attempts} 次（视为非 200），但账号已禁用`
            : '探测超时（视为非 200），但账号已禁用',
          statusCode: null,
          usedPercent: null,
          isQuota: false,
          error: errorMessage || 'timeout',
        };
      }

      const actionReason =
        attempts > 1
          ? `探测超时 ${attempts} 次（视为非 200），建议禁用账号`
          : '探测超时（视为非 200），建议禁用账号';
      onLog?.(
        'warning',
        `${account.displayAccount} -> disable (timeout · attempts ${attempts})`
      );
      return {
        ...account,
        action: 'disable',
        actionReason,
        statusCode: null,
        usedPercent: null,
        isQuota: false,
        error: errorMessage || 'timeout',
      };
    }

    const looksLikeAuthFailure =
      statusCode === 401 ||
      statusCode === 403 ||
      isCodexInvalidAccountResponse(statusCode || 0, normalizedError) ||
      normalizedError.includes('request failed') ||
      normalizedError.includes('unauthorized') ||
      normalizedError.includes('invalid');

    if (looksLikeAuthFailure) {
      let action: CodexInspectionAction = account.disabled
        ? 'keep'
        : statusCode === 401 || statusCode === 403
          ? 'delete'
          : 'disable';
      if (account.accountSource === 'api_key' && action === 'delete') {
        action = account.disabled ? 'keep' : 'disable';
      }
      const actionReason = account.disabled
        ? '探测失败，但账号已禁用'
        : action === 'delete'
          ? `探测失败（${errorMessage}），建议删除失效账号`
          : account.accountSource === 'api_key'
            ? `探测失败（${errorMessage}），建议禁用 API Key`
            : `探测失败（${errorMessage}），建议禁用账号`;
      onLog?.(
        action === 'delete' ? 'error' : 'warning',
        `${account.displayAccount} -> ${action} (${errorMessage})`
      );
      return {
        ...account,
        action,
        actionReason,
        statusCode,
        usedPercent: null,
        isQuota: false,
        error: errorMessage,
      };
    }

    onLog?.('warning', `${account.displayAccount} 探测异常，保留账号：${errorMessage}`);
    return {
      ...account,
      action: 'keep',
      actionReason: '探测异常，保留账号',
      statusCode,
      usedPercent: null,
      isQuota: false,
      error: errorMessage,
    };
  }

  try {
    const snapshot = probeOutcome.value;

    if (!snapshot.statusCode) {
      const bodyText = String(snapshot.bodyText || '').toLowerCase();
      const looksLikeTimeout = isTimeoutErrorText(bodyText);

      // Same rule as thrown timeouts: timeout-like empty status counts as non-200 => disable.
      if (looksLikeTimeout) {
        if (account.disabled) {
          onLog?.(
            'warning',
            `${account.displayAccount} -> keep (timeout · already disabled${formatInspectionProbeBodyLog(null, snapshot.responsePreview)})`
          );
          return {
            ...account,
            action: 'keep',
            actionReason: '探测超时（视为非 200），但账号已禁用',
            statusCode: null,
            usedPercent: null,
            isQuota: false,
            error: bodyText || 'timeout',
          };
        }
        onLog?.(
          'warning',
          `${account.displayAccount} -> disable (timeout${formatInspectionProbeBodyLog(null, snapshot.responsePreview)})`
        );
        return {
          ...account,
          action: 'disable',
          actionReason: '探测超时（视为非 200），建议禁用账号',
          statusCode: null,
          usedPercent: null,
          isQuota: false,
          error: bodyText || 'timeout',
        };
      }

      const looksLikeAuthFailure =
        isCodexInvalidAccountResponse(0, bodyText) ||
        bodyText.includes('request failed') ||
        bodyText.includes('unauthorized') ||
        bodyText.includes('invalid');

      if (looksLikeAuthFailure) {
        const action = account.disabled ? 'keep' : 'disable';
        const actionReason = account.disabled
          ? '探测失败且无 status_code，但账号已禁用'
          : '探测失败且无 status_code，建议禁用账号';
        onLog?.(
          'warning',
          `${account.displayAccount} -> ${action} (无 status_code${formatInspectionProbeBodyLog(null, snapshot.responsePreview || bodyText || 'request failed')})`
        );
        return {
          ...account,
          action,
          actionReason,
          statusCode: null,
          usedPercent: null,
          isQuota: false,
          error: bodyText || '响应缺少 status_code',
        };
      }

      onLog?.('warning', `${account.displayAccount} 探测未返回 status_code，保留账号`);
      return {
        ...account,
        action: 'keep',
        actionReason: '探测响应缺少 status_code，保留账号',
        statusCode: null,
        usedPercent: null,
        isQuota: false,
        error: '响应缺少 status_code',
      };
    }

    const rateLimit = snapshot.rateLimit;
    const usedPercent = snapshot.usedPercent;
    const bodyText = snapshot.bodyText;
    const isQuota =
      snapshot.statusCode === 402 ||
      QUOTA_BODY_PATTERNS.some((pattern) => bodyText.includes(pattern)) ||
      snapshot.isQuotaHint ||
      (usedPercent !== null && usedPercent >= settings.usedPercentThreshold);
    // Timeout-equivalent non-200 path stays inside resolveProbeAction for HTTP statuses.
    const decision = resolveProbeAction(
      account,
      snapshot.statusCode,
      bodyText,
      rateLimit,
      usedPercent,
      isQuota,
      settings.usedPercentThreshold,
      settings.retries,
      settings.autoActionMode
    );

    const successLevel =
      decision.action === 'delete'
        ? 'error'
        : decision.action === 'disable'
          ? 'warning'
          : decision.action === 'enable'
            ? 'success'
            : 'info';
    const percentText =
      decision.usedPercent === null ? '--' : `${decision.usedPercent.toFixed(1)}%`;
    const bodyLog = formatInspectionProbeBodyLog(snapshot.statusCode, snapshot.responsePreview);
    onLog?.(
      successLevel,
      `${account.displayAccount} -> ${decision.action} (HTTP ${snapshot.statusCode} · 已用 ${percentText}${bodyLog})`
    );

    let action = decision.action;
    let actionReason = decision.actionReason;
    if (account.accountSource === 'api_key' && action === 'delete') {
      action = account.disabled ? 'keep' : 'disable';
      actionReason = account.disabled
        ? 'API Key 认证失败，但账号已禁用'
        : 'API Key 认证失败，建议禁用（不删除密钥）';
    }

    return {
      ...account,
      action,
      actionReason,
      statusCode: snapshot.statusCode,
      usedPercent: decision.usedPercent,
      isQuota: decision.isQuota,
      error: '',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error || '探测失败');
    const statusMatch = errorMessage.match(/\b(40[1-3]|429|5\d\d)\b/);
    const statusCode = statusMatch ? Number(statusMatch[1]) : null;
    onLog?.('warning', `${account.displayAccount} 探测异常，保留账号：${errorMessage}`);
    return {
      ...account,
      action: 'keep',
      actionReason: '探测异常，保留账号',
      statusCode,
      usedPercent: null,
      isQuota: false,
      error: errorMessage,
    };
  }
};

const sortResults = (items: CodexInspectionResultItem[]) =>
  [...items].sort(
    (left, right) =>
      left.fileName.localeCompare(right.fileName) ||
      left.displayAccount.localeCompare(right.displayAccount) ||
      left.key.localeCompare(right.key)
  );

const createEmptyProgressSummary = (): CodexInspectionProgressSummary => ({
  totalFiles: 0,
  probeSetCount: 0,
  sampledCount: 0,
  disabledCount: 0,
  enabledCount: 0,
  deleteCount: 0,
  disableCount: 0,
  enableCount: 0,
  keepCount: 0,
});

const buildProgressSummary = (
  files: AuthFileItem[],
  probeSet: CodexInspectionAccount[],
  sampledAccounts: CodexInspectionAccount[],
  results: CodexInspectionResultItem[]
): CodexInspectionProgressSummary => {
  const deleteCount = results.filter((item) => item.action === 'delete').length;
  const disableCount = results.filter((item) => item.action === 'disable').length;
  const enableCount = results.filter((item) => item.action === 'enable').length;
  const keepCount = results.length - deleteCount - disableCount - enableCount;

  return {
    totalFiles: files.length,
    probeSetCount: probeSet.length,
    sampledCount: sampledAccounts.length,
    disabledCount: probeSet.filter((item) => item.disabled).length,
    enabledCount: probeSet.filter((item) => !item.disabled).length,
    deleteCount,
    disableCount,
    enableCount,
    keepCount,
  };
};

const createProgressSnapshot = (
  total: number,
  completed: number,
  inFlight: number,
  status: CodexInspectionProgressStatus,
  startedAt: number,
  updatedAt: number = Date.now(),
  summary: CodexInspectionProgressSummary = createEmptyProgressSummary()
): CodexInspectionProgressSnapshot => {
  const pending = Math.max(0, total - completed - inFlight);

  return {
    total,
    completed,
    inFlight,
    pending,
    percent: total <= 0 ? 0 : Math.round((Math.min(total, completed) / total) * 100),
    status,
    summary,
    startedAt,
    updatedAt,
  };
};

const buildSummary = (
  files: AuthFileItem[],
  sampledAccounts: CodexInspectionAccount[],
  results: CodexInspectionResultItem[],
  settings: CodexInspectionSettings
): CodexInspectionSummary => {
  const deleteCount = results.filter((item) => item.action === 'delete').length;
  const disableCount = results.filter((item) => item.action === 'disable').length;
  const enableCount = results.filter((item) => item.action === 'enable').length;
  const keepCount = results.length - deleteCount - disableCount - enableCount;
  const suggestedActionCount = deleteCount + disableCount + enableCount;
  const preview = results
    .filter((item) => item.action !== 'keep')
    .slice(0, 10)
    .map((item) => `${item.displayAccount} -> ${item.action}`);

  return {
    totalFiles: files.length,
    probeSetCount: suggestedActionCount,
    sampledCount: results.length,
    disabledCount: sampledAccounts.filter((item) => item.disabled).length,
    enabledCount: sampledAccounts.filter((item) => !item.disabled).length,
    deleteCount,
    disableCount,
    enableCount,
    keepCount,
    usedPercentThreshold: settings.usedPercentThreshold,
    sampled: settings.sampleSize > 0 && settings.sampleSize < sampledAccounts.length,
    plannedActionPreview: preview,
  };
};

export const resolveCodexInspectionSettings = (
  config: Config | null,
  apiBase: string,
  managementKey: string,
  settingsOverride?: Partial<CodexInspectionConfigurableSettings> | null
): CodexInspectionSettings => {
  const clean = config?.clean ?? null;
  const configurable = normalizeConfigurableSettings({
    ...readConfigurableSettingsFromConfig(config),
    ...(settingsOverride ?? {}),
  });

  return {
    baseUrl: readString(apiBase) || readString(clean?.baseUrl),
    token: readString(managementKey) || readString(clean?.token),
    accountSource: configurable.accountSource,
    targetType: configurable.targetType,
    workers: configurable.workers,
    deleteWorkers: configurable.deleteWorkers,
    timeout: configurable.timeout,
    retries: configurable.retries,
    userAgent: configurable.userAgent,
    usedPercentThreshold: configurable.usedPercentThreshold,
    sampleSize: configurable.sampleSize,
    probePromptMode: configurable.probePromptMode,
    probeModel: configurable.probeModel,
    providerFilter: configurable.providerFilter,
    autoActionMode: configurable.autoActionMode,
  };
};

export const createCodexInspectionSession = ({
  config,
  apiBase,
  managementKey,
  settings,
  onLog,
  onProgress,
  onResultsChange,
}: CreateCodexInspectionSessionOptions): CodexInspectionSession => {
  const resolvedSettings = resolveCodexInspectionSettings(config, apiBase, managementKey, settings);
  const sessionId = `codex-inspection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let status: CodexInspectionProgressStatus = 'idle';
  let startedAt = 0;
  let finishedAt = 0;
  let files: AuthFileItem[] = [];
  let probeSet: CodexInspectionAccount[] = [];
  let sampledAccounts: CodexInspectionAccount[] = [];
  let cursor = 0;
  let inFlight = 0;
  let finalResult: CodexInspectionRunResult | null = null;
  let deferred: CodexInspectionSessionPromiseState | null = null;
  // stop => reject; finish => resolve partial results and allow suggested actions.
  let stopSettleMode: 'reject' | 'resolve' = 'reject';
  // Once settled, late in-flight probe callbacks must not mutate the published result.
  let settled = false;
  const resultMap = new Map<string, CodexInspectionResultItem>();

  const emitProgress = () => {
    const baseTime = startedAt || Date.now();
    const summary = buildProgressSummary(
      files,
      probeSet,
      sampledAccounts,
      Array.from(resultMap.values())
    );
    onProgress?.(
      createProgressSnapshot(
        sampledAccounts.length,
        resultMap.size,
        settled ? 0 : inFlight,
        status,
        baseTime,
        Date.now(),
        summary
      )
    );
  };

  const buildRunResult = (finishedTime: number): CodexInspectionRunResult => {
    const results = sortResults(Array.from(resultMap.values()));
    const summary = buildSummary(files, probeSet, results, resolvedSettings);
    return {
      settings: resolvedSettings,
      files,
      results,
      summary,
      startedAt,
      finishedAt: finishedTime,
    };
  };

  const emitResultsChange = (latestResult: CodexInspectionResultItem) => {
    if (latestResult.action === 'keep') return;
    onResultsChange?.(buildRunResult(0));
  };

  const settleStopped = () => {
    if (!deferred || settled) return;
    if (stopSettleMode === 'resolve') {
      onLog?.(
        'warning',
        `巡检已结束：基于当前 ${resultMap.size} 个探测结果处理建议操作（不等待进行中探测）`
      );
      settleCompleted();
      return;
    }
    settled = true;
    const currentDeferred = deferred;
    deferred = null;
    currentDeferred.reject(new CodexInspectionStoppedError());
  };

  const settleCompleted = () => {
    if (!deferred || settled) return;
    settled = true;
    const currentDeferred = deferred;
    deferred = null;
    finishedAt = Date.now();
    finalResult = buildRunResult(finishedAt);
    status = 'completed';
    emitProgress();
    onLog?.(
      'success',
      `巡检完成：删除 ${finalResult.summary.deleteCount}、禁用 ${finalResult.summary.disableCount}、启用 ${finalResult.summary.enableCount}、保留 ${finalResult.summary.keepCount}`
    );
    currentDeferred.resolve(finalResult);
  };

  const maybeSettle = () => {
    if (status === 'stopped') {
      if (inFlight === 0) {
        settleStopped();
      }
      return;
    }

    if (cursor >= sampledAccounts.length && inFlight === 0) {
      settleCompleted();
    }
  };

  const pump = () => {
    if (status !== 'running') {
      maybeSettle();
      return;
    }

    while (
      status === 'running' &&
      inFlight < resolvedSettings.workers &&
      cursor < sampledAccounts.length
    ) {
      const account = sampledAccounts[cursor];
      cursor += 1;
      inFlight += 1;
      emitProgress();

      void inspectSingleAccount(account, resolvedSettings, onLog)
        .then((inspectionResult) => {
          if (settled) return;
          resultMap.set(inspectionResult.key, inspectionResult);
          emitResultsChange(inspectionResult);
        })
        .catch((error) => {
          if (settled) return;
          const fallbackResult: CodexInspectionResultItem = {
            ...account,
            action: 'keep',
            actionReason: '探测异常，保留账号',
            statusCode: null,
            usedPercent: null,
            isQuota: false,
            error: error instanceof Error ? error.message : String(error || '探测失败'),
          };
          resultMap.set(account.key, fallbackResult);
          emitResultsChange(fallbackResult);
        })
        .finally(() => {
          inFlight = Math.max(0, inFlight - 1);
          if (!settled) {
            emitProgress();
            pump();
          }
        });
    }

    maybeSettle();
  };

  const ensureStarted = () => {
    if (startedAt <= 0) {
      startedAt = Date.now();
    }
    if (!deferred) {
      deferred = createDeferred();
    }
    return deferred;
  };

  const initialize = async () => {
    onLog?.(
      'info',
      `加载认证列表，账号源：${resolvedSettings.accountSource}，目标类型：${resolvedSettings.targetType}`
    );

    const authFilesResponse = await authFilesApi.list();
    files = Array.isArray(authFilesResponse.files) ? authFilesResponse.files : [];
    const accounts = files.map(toInspectionAccount);
    probeSet = accounts.filter((item) => {
      const sourceOk =
        resolvedSettings.accountSource === 'api_key'
          ? item.accountSource === 'api_key' &&
            matchesInspectionApiKeyFamily(
              item.provider,
              normalizeInspectionApiKeyFamily(resolvedSettings.targetType, 'all')
            )
          : item.accountSource !== 'api_key' &&
            matchesInspectionTargetType(item.provider, resolvedSettings.targetType);
      if (!sourceOk) return false;
      if (shouldInspectDisabledOnly(resolvedSettings.autoActionMode) && !item.disabled) return false;
      if (shouldInspectEnabledOnly(resolvedSettings.autoActionMode) && item.disabled) return false;
      if (resolvedSettings.accountSource === 'api_key') {
        const filter = readString(resolvedSettings.providerFilter).toLowerCase();
        if (filter) {
          const haystack = [
            item.provider,
            item.displayAccount,
            item.compatName || '',
            item.baseUrl || '',
            item.fileName,
          ]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(filter)) return false;
        }
      }
      return true;
    });
    sampledAccounts =
      resolvedSettings.sampleSize > 0
        ? pickSample(probeSet, Math.min(resolvedSettings.sampleSize, probeSet.length))
        : probeSet;

    onLog?.(
      'info',
      `巡检集合 ${probeSet.length} 个账号，本次探测 ${sampledAccounts.length} 个账号`
    );
    emitProgress();
  };

  const start = () => {
    if (finalResult) {
      return Promise.resolve(finalResult);
    }

    if (status === 'completed') {
      return Promise.reject(new Error('巡检已结束，请重新开始'));
    }

    if (status === 'running') {
      return ensureStarted().promise;
    }

    if (status === 'paused') {
      status = 'running';
      onLog?.('info', '继续巡检');
      emitProgress();
      pump();
      return ensureStarted().promise;
    }

    if (status === 'stopped') {
      return Promise.reject(new CodexInspectionStoppedError('巡检已停止，请重新开始'));
    }

    const currentDeferred = ensureStarted();
    status = 'running';
    emitProgress();

    void initialize()
      .then(() => {
        pump();
      })
      .catch((error) => {
        status = 'completed';
        emitProgress();
        const activeDeferred = deferred;
        deferred = null;
        activeDeferred?.reject(error);
      });

    return currentDeferred.promise;
  };

  const resume = () => {
    if (status !== 'paused') return;
    status = 'running';
    onLog?.('info', '继续巡检');
    emitProgress();
    pump();
  };

  const pause = () => {
    if (status !== 'running') return;
    status = 'paused';
    onLog?.(
      'info',
      inFlight > 0 ? `巡检已暂停，等待 ${inFlight} 个进行中的探测完成` : '巡检已暂停'
    );
    emitProgress();
    maybeSettle();
  };

  const stop = () => {
    if (status === 'completed' || status === 'stopped' || status === 'idle' || settled) return;
    stopSettleMode = 'reject';
    status = 'stopped';
    // Immediate reject so callers can react without waiting for in-flight probes.
    onLog?.(
      'warning',
      inFlight > 0 ? `巡检已停止（忽略 ${inFlight} 个进行中探测）` : '巡检已停止'
    );
    emitProgress();
    settleStopped();
  };

  const finish = () => {
    if (status === 'completed' || status === 'stopped' || status === 'idle' || settled) return;
    stopSettleMode = 'resolve';
    status = 'stopped';
    // Immediate settle for responsiveness: do not wait for in-flight probes.
    onLog?.(
      'warning',
      inFlight > 0
        ? `正在结束巡检：忽略 ${inFlight} 个进行中探测，基于已完成结果处理建议操作`
        : '正在结束巡检：基于当前结果处理建议操作'
    );
    emitProgress();
    settleStopped();
  };

  return {
    id: sessionId,
    start,
    resume,
    pause,
    stop,
    finish,
    getProgress: () =>
      createProgressSnapshot(
        sampledAccounts.length,
        resultMap.size,
        // After finish/stop settle, hide stale in-flight count for immediate UI feedback.
        settled ? 0 : inFlight,
        status,
        startedAt || Date.now(),
        Date.now(),
        buildProgressSummary(files, probeSet, sampledAccounts, Array.from(resultMap.values()))
      ),
  };
};

export const inspectCodexAccounts = async ({
  config,
  apiBase,
  managementKey,
  settings,
  onLog,
  onProgress,
  onResultsChange,
}: InspectCodexAccountsOptions): Promise<CodexInspectionRunResult> => {
  const session = createCodexInspectionSession({
    config,
    apiBase,
    managementKey,
    settings,
    onLog,
    onProgress,
    onResultsChange,
  });

  return session.start();
};

const dedupeExecutionItems = (items: CodexInspectionResultItem[]) => {
  const map = new Map<string, CodexInspectionResultItem>();
  items.forEach((item) => {
    if (item.action === 'keep') return;
    if (!item.fileName) return;
    if (!map.has(item.fileName)) {
      map.set(item.fileName, item);
    }
  });
  return Array.from(map.values()).sort((left, right) =>
    left.fileName.localeCompare(right.fileName)
  );
};

const buildFailedExecutionOutcome = (
  item: CodexInspectionResultItem,
  action: CodexInspectionExecutionAction,
  error: unknown
): CodexInspectionExecutionOutcome => ({
  action,
  fileName: item.fileName,
  displayAccount: item.displayAccount,
  success: false,
  error: error instanceof Error ? error.message : String(error || '执行失败'),
});

const executeItemsConcurrently = (
  items: CodexInspectionResultItem[],
  limit: number,
  action: CodexInspectionExecutionAction,
  task: (item: CodexInspectionResultItem) => Promise<CodexInspectionExecutionOutcome>
) =>
  runConcurrently(items, limit, async (item) => {
    try {
      return await task(item);
    } catch (error) {
      return buildFailedExecutionOutcome(item, action, error);
    }
  });

const executeDelete = async (
  item: CodexInspectionResultItem
): Promise<CodexInspectionExecutionOutcome> => {
  const result = await deleteFileByName(item.fileName);
  const failed = result.failed[0];
  if (failed) {
    return {
      action: 'delete',
      fileName: item.fileName,
      displayAccount: item.displayAccount,
      success: false,
      error: failed.error || '删除失败',
    };
  }
  return {
    action: 'delete',
    fileName: item.fileName,
    displayAccount: item.displayAccount,
    success: true,
    error: '',
  };
};

const resolveStatusTargetNames = (item: CodexInspectionResultItem): string[] => {
  const candidates = [
    item.fileName,
    readString(item.raw?.id),
    readString(item.raw?.name),
    item.authIndex || '',
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(candidates));
};

const executeStatusChange = async (
  item: CodexInspectionResultItem,
  disabled: boolean
): Promise<CodexInspectionExecutionOutcome> => {
  const names = resolveStatusTargetNames(item);
  let lastError: unknown = null;
  for (const name of names) {
    try {
      await setStatusWithFallback(name, disabled);
      return {
        action: disabled ? 'disable' : 'enable',
        fileName: item.fileName,
        displayAccount: item.displayAccount,
        success: true,
        error: '',
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError || 'failed to update status'));
};

export const executeCodexInspectionActions = async ({
  settings,
  items,
  previousFiles,
  onLog,
}: ExecuteCodexInspectionActionsOptions): Promise<CodexInspectionExecutionResult> => {
  const dedupedItems = dedupeExecutionItems(items);
  const deleteItems = dedupedItems.filter((item) => item.action === 'delete');
  const disableItems = dedupedItems.filter((item) => item.action === 'disable');
  const enableItems = dedupedItems.filter((item) => item.action === 'enable');
  const outcomes: CodexInspectionExecutionOutcome[] = [];

  // API Key / runtime credentials must never be deleted as auth files.
  const apiKeyDeletes = deleteItems.filter((item) => item.accountSource === 'api_key');
  const oauthDeletes = deleteItems.filter((item) => item.accountSource !== 'api_key');
  if (apiKeyDeletes.length > 0) {
    onLog?.(
      'warning',
      `跳过 ${apiKeyDeletes.length} 个 API Key 删除建议（禁止删除 config/runtime 密钥）`
    );
    apiKeyDeletes.forEach((item) => {
      outcomes.push({
        action: 'delete',
        fileName: item.fileName,
        displayAccount: item.displayAccount,
        success: false,
        error: 'API Key 账号禁止删除',
      });
    });
  }

  if (oauthDeletes.length > 0) {
    onLog?.('info', `开始删除 ${oauthDeletes.length} 个账号`);
    const deleteOutcomes = await executeItemsConcurrently(
      oauthDeletes,
      settings.deleteWorkers,
      'delete',
      executeDelete
    );
    deleteOutcomes.forEach((outcome) => {
      onLog?.(
        outcome.success ? 'success' : 'error',
        `${outcome.displayAccount} 删除${outcome.success ? '成功' : `失败：${outcome.error}`}`
      );
    });
    outcomes.push(...deleteOutcomes);
  }

  if (disableItems.length > 0) {
    onLog?.('info', `开始禁用 ${disableItems.length} 个账号`);
    const disableOutcomes = await executeItemsConcurrently(
      disableItems,
      settings.deleteWorkers,
      'disable',
      (item) => executeStatusChange(item, true)
    );
    disableOutcomes.forEach((outcome) => {
      onLog?.(
        outcome.success ? 'success' : 'error',
        `${outcome.displayAccount} 禁用${outcome.success ? '成功' : `失败：${outcome.error}`}`
      );
    });
    outcomes.push(...disableOutcomes);
  }

  if (enableItems.length > 0) {
    onLog?.('info', `开始启用 ${enableItems.length} 个账号`);
    const enableOutcomes = await executeItemsConcurrently(
      enableItems,
      settings.deleteWorkers,
      'enable',
      (item) => executeStatusChange(item, false)
    );
    enableOutcomes.forEach((outcome) => {
      onLog?.(
        outcome.success ? 'success' : 'error',
        `${outcome.displayAccount} 启用${outcome.success ? '成功' : `失败：${outcome.error}`}`
      );
    });
    outcomes.push(...enableOutcomes);
  }

  let refreshedFiles = previousFiles;
  let refreshError = '';
  try {
    const response = await authFilesApi.list();
    refreshedFiles = Array.isArray(response.files) ? response.files : previousFiles;
  } catch (error) {
    refreshError = error instanceof Error ? error.message : String(error || '刷新账号列表失败');
    onLog?.('warning', `执行后刷新账号列表失败，已回退旧快照：${refreshError}`);
  }

  return {
    outcomes,
    refreshedFiles,
    refreshError,
  };
};

export const buildCodexInspectionError = (message: string) => message;

export const buildExecutionFailureMessage = (outcome: CodexInspectionExecutionOutcome) =>
  `${outcome.displayAccount}：${outcome.error || '执行失败'}`;

export const isSuggestedAction = (item: CodexInspectionResultItem) => item.action !== 'keep';

export const resolveCodexInspectionAutoActionItems = (
  mode: CodexInspectionAutoActionMode,
  items: CodexInspectionResultItem[]
): CodexInspectionResultItem[] => {
  const normalizedMode = normalizeAutoActionMode(mode);
  if (normalizedMode === 'none') return [];

  if (normalizedMode === 'disable') {
    return items
      .filter((item) => item.action === 'delete' || item.action === 'disable')
      .map((item) =>
        item.action === 'delete'
          ? {
              ...item,
              action: 'disable',
              actionReason: item.actionReason
                ? `${item.actionReason}；自动禁用策略改为禁用账号`
                : '自动禁用策略改为禁用账号',
            }
          : item
      );
  }

  if (normalizedMode === 'strategy4') {
    return items.filter(
      (item) => item.action === 'delete' || item.action === 'disable' || item.action === 'enable'
    );
  }

  if (normalizedMode === 'strategy5' || normalizedMode === 'strategy6') {
    return items.filter(
      (item) => item.action === 'delete' || item.action === 'disable' || item.action === 'enable'
    );
  }

  return items.filter((item) => item.action === 'delete' || item.action === 'disable');
};

/** Keep only actions allowed for realtime auto-apply (and never delete API Key accounts). */
export const filterCodexInspectionRealtimeActionItems = (
  items: CodexInspectionResultItem[],
  realtime: CodexInspectionRealtimeAutoActions | null | undefined,
  accountSource?: InspectionAccountSource
): CodexInspectionResultItem[] => {
  const allow = normalizeRealtimeAutoActions(realtime, accountSource);
  return items.filter((item) => {
    if (item.action === 'disable') return allow.disable;
    if (item.action === 'enable') return allow.enable;
    if (item.action === 'delete') {
      if (item.accountSource === 'api_key' || accountSource === 'api_key') return false;
      return allow.delete;
    }
    return false;
  });
};

export const resolveCodexInspectionRealtimeActionItems = (
  mode: CodexInspectionAutoActionMode,
  items: CodexInspectionResultItem[],
  realtime: CodexInspectionRealtimeAutoActions | null | undefined,
  accountSource?: InspectionAccountSource
): CodexInspectionResultItem[] =>
  filterCodexInspectionRealtimeActionItems(
    resolveCodexInspectionAutoActionItems(mode, items),
    realtime,
    accountSource
  );

export const isCodexInspectionStoppedError = (
  error: unknown
): error is CodexInspectionStoppedError => error instanceof CodexInspectionStoppedError;

export const applyCodexInspectionExecutionResult = (
  previousResult: CodexInspectionRunResult,
  execution: CodexInspectionExecutionResult
): CodexInspectionRunResult => {
  const successfulOutcomes = new Map(
    execution.outcomes.filter((item) => item.success).map((item) => [item.fileName, item] as const)
  );
  const refreshedAccounts = new Map(
    execution.refreshedFiles.map((file) => {
      const account = toInspectionAccount(file);
      return [account.fileName, account] as const;
    })
  );

  const nextResults = sortResults(
    previousResult.results.map((item) => {
      const refreshedAccount = refreshedAccounts.get(item.fileName);
      const baseItem: CodexInspectionResultItem = refreshedAccount
        ? {
            ...item,
            ...refreshedAccount,
            raw: refreshedAccount.raw,
          }
        : item;
      const outcome = successfulOutcomes.get(item.fileName);

      if (!outcome) {
        return baseItem;
      }

      return {
        ...baseItem,
        disabled:
          outcome.action === 'disable'
            ? true
            : outcome.action === 'enable'
              ? false
              : baseItem.disabled,
        action: 'keep',
        actionReason: '无需处理',
        error: '',
      };
    })
  );

  const deleteCount = nextResults.filter((item) => item.action === 'delete').length;
  const disableCount = nextResults.filter((item) => item.action === 'disable').length;
  const enableCount = nextResults.filter((item) => item.action === 'enable').length;
  const keepCount = nextResults.length - deleteCount - disableCount - enableCount;
  const plannedActionPreview = nextResults
    .filter((item) => item.action !== 'keep')
    .slice(0, 10)
    .map((item) => `${item.displayAccount} -> ${item.action}`);

  return {
    ...previousResult,
    files: execution.refreshedFiles,
    results: nextResults,
    summary: {
      ...previousResult.summary,
      totalFiles: execution.refreshedFiles.length,
      disabledCount: nextResults.filter((item) => item.disabled).length,
      enabledCount: nextResults.filter((item) => !item.disabled).length,
      deleteCount,
      disableCount,
      enableCount,
      keepCount,
      plannedActionPreview,
    },
    finishedAt: Date.now(),
  };
};

export const buildSuggestedActionCountLabel = (summary: CodexInspectionSummary) =>
  summary.deleteCount + summary.disableCount + summary.enableCount;

export const getProbeFailureMessage = (result: CodexInspectionResultItem) =>
  result.error ||
  getApiCallErrorMessage({
    statusCode: result.statusCode || 0,
    header: {},
    bodyText: '',
    body: null,
  });
