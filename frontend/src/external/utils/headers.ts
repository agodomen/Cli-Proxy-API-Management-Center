/**
 * Header utility extensions for CPAMC.
 * Re-exports community utilities and adds secondary-dev functions.
 */

import { buildHeaderObject, hasHeader, type HeaderEntry } from '@/utils/headers';

export { buildHeaderObject, hasHeader };
export type { HeaderEntry };

export function headersToEntries(
  headers?: Record<string, string | undefined | null>
): HeaderEntry[] {
  if (!headers || typeof headers !== 'object') return [];
  return Object.entries(headers)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ({ key, value: String(value) }));
}

export const normalizeHeaderEntries = (entries: HeaderEntry[]) =>
  (entries ?? [])
    .map((entry) => ({
      key: String(entry?.key ?? '').trim(),
      value: String(entry?.value ?? '').trim(),
    }))
    .filter((entry) => entry.key || entry.value)
    .sort((a, b) => {
      const byKey = a.key.toLowerCase().localeCompare(b.key.toLowerCase());
      if (byKey !== 0) return byKey;
      return a.value.localeCompare(b.value);
    });
