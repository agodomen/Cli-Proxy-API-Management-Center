import type { ProxyDetail } from './types';

export type ProxyPrivacy = 'local' | 'public' | 'personal';

export interface ProxyInfoMeta {
  privacy: ProxyPrivacy;
  [key: string]: unknown;
}

export const PROXY_PRIVACY_OPTIONS: ProxyPrivacy[] = ['public', 'personal', 'local'];
export const DEFAULT_PROXY_PRIVACY: ProxyPrivacy = 'public';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeProxyPrivacy(value: unknown, fallback: ProxyPrivacy = DEFAULT_PROXY_PRIVACY): ProxyPrivacy {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (text === 'local' || text === 'public' || text === 'personal') return text;
  return fallback;
}

/** Parse proxy_info JSON metadata. Legacy plain text becomes `{ privacy, note }`. */
export function parseProxyInfo(raw: string | null | undefined, fallbackPrivacy: ProxyPrivacy = DEFAULT_PROXY_PRIVACY): ProxyInfoMeta {
  const text = String(raw ?? '').trim();
  if (!text) return { privacy: fallbackPrivacy };

  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) {
      const { privacy: rawPrivacy, ...rest } = parsed;
      return {
        ...rest,
        privacy: normalizeProxyPrivacy(rawPrivacy, fallbackPrivacy),
      };
    }
  } catch {
    // legacy free-text proxy_info
  }

  return {
    privacy: fallbackPrivacy,
    note: text,
  };
}

export function stringifyProxyInfo(meta: ProxyInfoMeta): string {
  const privacy = normalizeProxyPrivacy(meta.privacy);
  const next: Record<string, unknown> = { ...meta, privacy };
  return JSON.stringify(next);
}

export function prettyProxyInfo(raw: string | null | undefined, fallbackPrivacy: ProxyPrivacy = DEFAULT_PROXY_PRIVACY): string {
  return JSON.stringify(parseProxyInfo(raw, fallbackPrivacy), null, 2);
}

export function withProxyPrivacy(
  raw: string | null | undefined,
  privacy: ProxyPrivacy,
  fallbackPrivacy: ProxyPrivacy = DEFAULT_PROXY_PRIVACY
): string {
  const meta = parseProxyInfo(raw, fallbackPrivacy);
  return stringifyProxyInfo({ ...meta, privacy: normalizeProxyPrivacy(privacy, fallbackPrivacy) });
}

/** Legacy export fallback: priority < 0 was treated as public. */
export function resolveProxyPrivacy(item: Pick<ProxyDetail, 'proxy_info' | 'priority'>): ProxyPrivacy {
  const text = String(item.proxy_info ?? '').trim();
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (isRecord(parsed) && parsed.privacy != null) {
        return normalizeProxyPrivacy(parsed.privacy);
      }
    } catch {
      // ignore and fall through to priority heuristic
    }
    if (text.startsWith('{') || text.startsWith('[')) {
      return parseProxyInfo(text).privacy;
    }
  }
  return Number(item.priority) < 0 ? 'public' : 'personal';
}

export function formatProxyInfoPreview(raw: string | null | undefined, maxLen = 42): string {
  const text = String(raw ?? '').trim();
  if (!text) return '—';
  let compact = text;
  try {
    const meta = parseProxyInfo(text);
    compact = JSON.stringify(meta);
  } catch {
    compact = text.replace(/\s+/g, ' ');
  }
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, Math.max(1, maxLen - 1))}…`;
}
