// ── API response types ──

export interface Channel {
  channel_id: number;
  channel_name: string;
  description: string;
  status: number; // 1=valid, 0=unknown, -1=invalid (soft delete)
  param: string; // JSON string
  url?: string;
  create_at: string;
  update_at: string;
}

export interface Provider {
  provider_id: number;
  provider_name: string;
  description: string;
  channel_id?: number | null;
  status: number; // 1=valid, 0=unknown, -1=invalid (soft delete)
  base_url: string;
  /** Single protocol or comma-separated multi-select, e.g. "openai_compatible,anthropic". */
  protocol_type?: string;
  cpa_config_type?: CPAConfigType;
  probe_policy: string;
  param: string; // JSON string
  create_at: string;
  update_at: string;
}

export type ProviderProtocolType = 'openai_compatible' | 'anthropic' | 'gemini' | 'codex' | 'vertex';
export type CPAConfigType = 'openai-compatibility' | 'claude-api-key' | 'gemini-api-key' | 'codex-api-key' | 'vertex-api-key';

export const PROVIDER_INTEGRATION_OPTIONS: Array<{
  protocol: ProviderProtocolType;
  cpaConfig: CPAConfigType;
}> = [
  { protocol: 'openai_compatible', cpaConfig: 'openai-compatibility' },
  { protocol: 'anthropic', cpaConfig: 'claude-api-key' },
  { protocol: 'gemini', cpaConfig: 'gemini-api-key' },
  { protocol: 'codex', cpaConfig: 'codex-api-key' },
  { protocol: 'vertex', cpaConfig: 'vertex-api-key' },
];


export const PROVIDER_PROTOCOL_ORDER: ProviderProtocolType[] = PROVIDER_INTEGRATION_OPTIONS.map(
  (item) => item.protocol
);

/** Parse provider.protocol_type into a de-duplicated multi-select list. */
export function parseProviderProtocols(raw?: string | null): ProviderProtocolType[] {
  const tokens = String(raw || '')
    .split(/[,;|\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = new Set<string>(PROVIDER_PROTOCOL_ORDER);
  const seen = new Set<ProviderProtocolType>();
  const out: ProviderProtocolType[] = [];
  for (const token of tokens) {
    if (!allowed.has(token) || seen.has(token as ProviderProtocolType)) continue;
    seen.add(token as ProviderProtocolType);
    out.push(token as ProviderProtocolType);
  }
  return out.length > 0 ? out : ['openai_compatible'];
}

/** Serialize selected protocols for API storage. */
export function formatProviderProtocols(protocols: ProviderProtocolType[]): string {
  const allowed = new Set<string>(PROVIDER_PROTOCOL_ORDER);
  const seen = new Set<ProviderProtocolType>();
  const ordered: ProviderProtocolType[] = [];
  for (const protocol of PROVIDER_PROTOCOL_ORDER) {
    if (protocols.includes(protocol) && !seen.has(protocol)) {
      seen.add(protocol);
      ordered.push(protocol);
    }
  }
  for (const protocol of protocols) {
    if (allowed.has(protocol) && !seen.has(protocol)) {
      seen.add(protocol);
      ordered.push(protocol);
    }
  }
  return (ordered.length > 0 ? ordered : ['openai_compatible']).join(',');
}

/** First protocol used by single-adapter consumers (probe, display summary). */
export function primaryProviderProtocol(raw?: string | null): ProviderProtocolType {
  return parseProviderProtocols(raw)[0] || 'openai_compatible';
}

/** Default CPA target for the primary selected protocol. */
export function defaultCPAConfigForProtocols(protocols: ProviderProtocolType[]): CPAConfigType {
  const primary = protocols[0] || 'openai_compatible';
  return (
    PROVIDER_INTEGRATION_OPTIONS.find((item) => item.protocol === primary)?.cpaConfig ||
    'openai-compatibility'
  );
}

export interface AuthDetail {
  id: number;
  auth_index: string;
  auth_type: number; // 1=api_key, 2=service_account, 3=oauth2, 4=oidc, 5=multi api_key
  auth_value: string;
  auth_info: string; // versioned JSON metadata; never stores credential secrets
  content?: string;
  status: number; // 0=unknown, >=1=valid, <0=invalid
  priority: number;
  expires_at_ms?: number | null;
  probe_policy: string;
  param: string; // JSON string
  provider_id?: number | null;
  owner_id?: number | null;
  create_at: string;
  update_at: string;
  remark?: string;
  // Compatibility aliases for auth_type=1
  api_key?: string;
  api_type?: number;
}

export interface AuthInfo {
  schema_version: 1;
  credential_type: 'api_key' | 'service_account' | 'oauth2' | 'oidc' | 'api_key_set';
  api_type: number;
  protocols: ProtocolKey[];
  source?: string;
  source_format?: string;
  provider_type?: string;
  file_name?: string;
  label?: string;
  email?: string;
  account_id?: string;
  credential_hash?: string;
  /** Headers previously written by the management center (non-sensitive). */
  managed_header_keys?: string[];
  /** Scalar fields previously managed by the center (proxy_url/prefix...). */
  managed_auth_file_fields?: string[];
  /** Last field-level push timestamp (ms). */
  last_pushed_at?: number;
  /** Auth-file modtime observed at last push (ms). */
  source_modtime?: number;
  /** @deprecated Prefer source_modtime. */
  source_modified?: number;
  last_synced_at?: number;
  [key: string]: unknown;
}

/** @deprecated Prefer AuthDetail; kept for existing Keys page naming. */
export type APIKey = AuthDetail;

export interface KeyProbePolicy {
  enabled?: boolean;
  autoPriorityEnabled?: boolean;
  autoStatusEnabled?: boolean;
  autoCpaAccountEnabled?: boolean;
  renewExpiryOnSuccess?: boolean;
  renewalSeconds?: number;
  priorityBoost?: number;
  priorityPenalty?: number;
  failureThreshold?: number;
  recoveryThreshold?: number;
  minPriority?: number;
  maxPriority?: number;
}

export interface ProxyDetail {
  id: number;
  proxy_index: string;
  proxy_type: number;
  proxy_value: string;
  /** JSON metadata (privacy/local-public-personal and other extensions). Not request params. */
  proxy_info: string;
  content?: string;
  status: number;
  priority: number;
  /** Request/runtime parameters JSON (e.g. clash node config). */
  param: string;
  owner_id?: number | null;
  create_at: string;
  update_at: string;
  remark?: string;
}

export interface ClashSubscription {
  id: number;
  token: string;
  subscription_type: 2 | 3;
  proxy_ids: number[];
  proxy_urls: string[];
  access_count: number;
  effective_at: string;
  expires_at?: string | null;
  create_at: string;
  update_at: string;
}

/** Proxy protocol family enum. socks4/socks5 both map to socks. */
export const PROXY_TYPE_MAP = {
  1: 'unknown',
  2: 'vmess',
  3: 'vless',
  4: 'socks',
  5: 'http',
  6: 'trojan',
  7: 'shadowsocks',
  8: 'shadowsocksr',
  9: 'hysteria',
  10: 'tuic',
  11: 'naiveproxy',
  12: 'juicity',
  13: 'overtls',
  14: 'wireguard',
  15: 'freedom',
  16: 'blackhole',
  17: 'dokodemo-door',
} as const;

export type ProxyTypeKey = (typeof PROXY_TYPE_MAP)[keyof typeof PROXY_TYPE_MAP];

export const PROXY_TYPE_OPTIONS: Array<{ value: number; key: ProxyTypeKey }> = Object.entries(
  PROXY_TYPE_MAP
).map(([value, key]) => ({
  value: Number(value),
  key,
}));

export function detectProxyType(uri: string): number {
  const raw = (uri || '').trim().toLowerCase();
  if (!raw) return 1;
  if (raw.startsWith('vmess://')) return 2;
  if (raw.startsWith('vless://')) return 3;
  if (raw.startsWith('socks5://') || raw.startsWith('socks4://') || raw.startsWith('socks://'))
    return 4;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return 5;
  if (raw.startsWith('trojan://')) return 6;
  if (raw.startsWith('ss://')) return 7;
  if (raw.startsWith('ssr://')) return 8;
  if (raw.startsWith('hysteria://') || raw.startsWith('hy2://') || raw.startsWith('hysteria2://'))
    return 9;
  if (raw.startsWith('tuic://')) return 10;
  if (raw.startsWith('naive://') || raw.startsWith('naive+https://')) return 11;
  if (raw.startsWith('juicity://')) return 12;
  if (raw.startsWith('overtls://')) return 13;
  if (raw.startsWith('wireguard://') || raw.startsWith('wg://')) return 14;
  if (raw.startsWith('freedom://')) return 15;
  if (raw.startsWith('blackhole://')) return 16;
  if (raw.startsWith('dokodemo-door://')) return 17;
  return 1;
}

export function getProxyTypeLabel(type: number): ProxyTypeKey {
  return PROXY_TYPE_MAP[type as keyof typeof PROXY_TYPE_MAP] ?? 'unknown';
}

export interface PageResult<T> {
  page: number;
  page_size: number;
  total_items: number;
  items: T[];
}

/** A concrete auth status code and its count under the active non-status filters. */
export interface KeyStatusCount {
  status: number;
  count: number;
}

export interface ListParams {
  page?: number;
  page_size?: number;
  search?: string;
  base_url?: string;
  channel_id?: number;
  provider_id?: number;
  provider_ids?: number[];
  status?: number | 'all';
  status_domain?: 'valid' | 'unknown' | 'invalid' | 'expired' | 'disabled';
  priority?: number;
  api_type?: number;
  proxy_type?: number;
  /** Filter keys by credential channel: auth-file vs plain API key. */
  credential_kind?: 'auth_file' | 'api_key';
}

// ── param structured type ──

export interface ProviderParam {
  path?: Record<string, string>;
  models?: Array<{ name: string; alias: string }>;
  [key: string]: unknown; // allow arbitrary extension fields
}

// ── Prime encoding constants ──

export const PROTOCOL_PRIMES = {
  openai: 2,
  anthropic: 3,
  gemini: 5,
  openai_responses: 7,
} as const;

export type ProtocolKey = keyof typeof PROTOCOL_PRIMES;

// ── Status mapping ──

export const STATUS_MAP: Record<number, { label: string; color: string }> = {
  1: { label: 'charitable.statusValid', color: 'green' },
  200: { label: 'charitable.statusValid', color: 'green' },
  0: { label: 'charitable.statusUnknown', color: 'gray' },
  [-1]: { label: 'charitable.statusInvalid', color: 'red' },
  [-2]: { label: 'charitable.statusDisabled', color: 'red' },
  [-3]: { label: 'charitable.statusExpired', color: 'red' },
  [-5]: { label: 'charitable.statusExpired', color: 'orange' },
  [-401]: { label: 'charitable.statusInvalid', color: 'red' },
  [-439]: { label: 'charitable.statusInvalid', color: 'red' },
  [-501]: { label: 'charitable.statusInvalid', color: 'red' },
};

/** Check if status is valid (>= 1) */
export const isStatusValid = (s: number) => s >= 1;
/** Check if status is unknown */
export const isStatusUnknown = (s: number) => s === 0;
/** Check if status is invalid (< 0) */
export const isStatusInvalid = (s: number) => s < 0;
/** Check if status was auto-marked invalid by inspection (< -99) */
export const isAutoInvalid = (s: number) => s < -99;
/** Check if status was manually set invalid (-1 to -99) */
export const isManualInvalid = (s: number) => s >= -99 && s < 0;

/** Get status display info. `label` is an i18n key — call `t(label)` in the component. */
export function getStatusInfo(status: number): { label: string; color: string } {
  if (status >= 1) return STATUS_MAP[status] ?? { label: 'charitable.statusValid', color: 'green' };
  if (status < -99) return { label: `${status}`, color: 'red' };
  return STATUS_MAP[status] ?? { label: 'charitable.statusInvalid', color: 'red' };
}

export function getStatusDescription(status: number): {
  key: string;
  values?: Record<string, number>;
} {
  if (status === 1) return { key: 'charitable.statusDescription.manualValid' };
  if (status > 0) return { key: 'charitable.statusDescription.probeValid', values: { code: status } };
  if (status === 0) return { key: 'charitable.statusDescription.unknown' };
  if (status === -1) return { key: 'charitable.statusDescription.manualInvalid' };
  if (status === -2) return { key: 'charitable.statusDescription.disabled' };
  if (status === -3) return { key: 'charitable.statusDescription.expired' };
  if (status === -5) return { key: 'charitable.statusDescription.overdue' };
  if (status < -99) {
    return { key: 'charitable.statusDescription.probeInvalid', values: { code: Math.abs(status) } };
  }
  return { key: 'charitable.statusDescription.manualDetailedInvalid', values: { code: status } };
}
