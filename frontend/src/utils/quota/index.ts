/**
 * Quota utility functions barrel export.
 */

import type { AuthFileItem } from '@/types';

export * from './constants';
export * from './parsers';
export * from './resolvers';
export * from './formatters';
export * from './validators';
export * from './builders';
export * from './resetCredits';
export * from './xaiPaid';

export function isRuntimeOnlyAuthFile(file: AuthFileItem): boolean {
  const raw = file['runtime_only'] ?? file.runtimeOnly;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
}
