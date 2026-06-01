import { PROTOCOL_PRIMES, type ProtocolKey } from './types';

// ── api_type prime product utilities ──

/** Compute api_type prime product from protocol key array */
export function computeApiType(protocols: ProtocolKey[]): number {
  if (protocols.length === 0) return 1;
  return protocols.reduce((product, key) => product * PROTOCOL_PRIMES[key], 1);
}

/** Parse selected protocols from api_type prime product */
export function parseApiType(apiType: number): ProtocolKey[] {
  return (Object.keys(PROTOCOL_PRIMES) as ProtocolKey[]).filter(
    key => apiType % PROTOCOL_PRIMES[key] === 0
  );
}

/** Validate that api_type is valid (at least one protocol selected) */
export function isValidApiType(apiType: number): boolean {
  return apiType > 1;
}

// ── Parameter merging (frontend preview) ──

/** Frontend parameter merge, consistent with backend MergeParams logic */
export function mergeParams(
  channelParam: string,
  providerParam: string,
  keyParam: string
): Record<string, unknown> {
  const channel = safeParse(channelParam);
  const provider = safeParse(providerParam);
  const key = safeParse(keyParam);
  return { ...channel, ...provider, ...key };
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

// ── Key masking ──

/** Mask key for display: first 4 chars + **** + last 4 chars */
export function maskKey(key: string): string {
  if (!key) return '—';
  if (key.length <= 8) return '••••••' + key.slice(-4);
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

// ── param parsing ──

/** Safely parse provider param */
export function parseProviderParam(raw: string): {
  path: Record<string, string>;
  models: Array<{ name: string; alias: string }>;
} {
  const obj = safeParse(raw);
  return {
    path: typeof obj.path === 'object' && obj.path !== null
      ? obj.path as Record<string, string>
      : {},
    models: Array.isArray(obj.models)
      ? obj.models as Array<{ name: string; alias: string }>
      : [],
  };
}
