/**
 * Secondary-development quota utility extensions.
 * Adds constants and helpers used by external/ quota providers.
 */

import type { AuthFileItem } from '@/types';

// Re-export community constants for convenience
export * from '@/utils/quota/constants';
export * from '@/utils/quota/builders';

// Secondary-dev additions
export const XAI_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing';

export function isRuntimeOnlyAuthFile(file: AuthFileItem): boolean {
  const raw = file['runtime_only'] ?? file.runtimeOnly;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
}
