import { describe, expect, it } from 'vitest';
import { isUsageServiceId } from './usageService';

describe('isUsageServiceId', () => {
  it('accepts the service ids returned by current and legacy backends', () => {
    expect(isUsageServiceId('CPAMC')).toBe(true);
    expect(isUsageServiceId('cpamc')).toBe(true);
    expect(isUsageServiceId('cpa-usage-service')).toBe(true);
  });

  it('rejects unrelated service ids', () => {
    expect(isUsageServiceId('CLIProxyAPI')).toBe(false);
    expect(isUsageServiceId()).toBe(false);
  });
});
