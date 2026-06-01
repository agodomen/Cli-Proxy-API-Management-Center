import { describe, expect, it } from 'vitest';
import { getProbeStatusAfterResult } from './probeStatus';

describe('probe status classification', () => {
  it.each([401, 402, 403, 429, 500, 501])('keeps HTTP %s as a concrete invalid reason', (statusCode) => {
    expect(getProbeStatusAfterResult(1, { valid: false, statusCode })).toBe(-statusCode);
  });

  it('stores the successful HTTP status code', () => {
    expect(getProbeStatusAfterResult(1, { valid: true, statusCode: 200 })).toBe(200);
  });

  it('moves a generic manual invalid status to unknown after success', () => {
    expect(getProbeStatusAfterResult(-1, { valid: true, statusCode: 200 })).toBe(0);
  });

  it.each([undefined, 200])('uses unknown for an uncertain result with HTTP %s', (statusCode) => {
    expect(getProbeStatusAfterResult(1, { valid: false, statusCode })).toBe(0);
  });

  it.each([-2, -3, -5, -99])('preserves manual detailed status %s', (status) => {
    expect(getProbeStatusAfterResult(status, { valid: false, statusCode: 401 })).toBeNull();
  });
});
