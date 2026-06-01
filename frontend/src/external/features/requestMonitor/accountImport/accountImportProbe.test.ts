import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountImportItem } from './accountImportConverter';
import {
  collectProbeStatusCodes,
  formatProbeStatusCode,
  getAccountImportItemKey,
  probeAccountImportItem,
  probeAccountImportItems,
} from './accountImportProbe';

const requestMock = vi.fn();

vi.mock('@/services/api/apiCall', () => ({
  apiCallApi: {
    request: (...args: unknown[]) => requestMock(...args),
  },
  getApiCallErrorMessage: (result: { statusCode: number; bodyText?: string }) =>
    `${result.statusCode} ${result.bodyText || 'error'}`.trim(),
}));

const makeItem = (overrides?: Partial<AccountImportItem>): AccountImportItem => ({
  fileName: 'user.xai.json',
  authJson: {
    type: 'xai',
    access_token: 'token-1',
    email: 'user@example.com',
    headers: {
      'User-Agent': 'grok-shell/0.2.93',
    },
  },
  source: 'sub2api',
  label: 'user@example.com',
  email: 'user@example.com',
  accountId: 'acc-1',
  credentialHash: 'hash-1',
  ...overrides,
});

describe('accountImportProbe', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('formats timeout status as 0', () => {
    expect(formatProbeStatusCode(0)).toBe('0 (timeout)');
    expect(formatProbeStatusCode(401)).toBe('401');
  });

  it('probes xai account and returns status code', async () => {
    requestMock.mockResolvedValueOnce({
      statusCode: 200,
      header: {},
      bodyText: '{}',
      body: {},
    });

    const status = await probeAccountImportItem(makeItem());
    expect(status.statusCode).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(1);
    const payload = requestMock.mock.calls[0][0];
    expect(payload.method).toBe('GET');
    expect(payload.url).toContain('billing');
    expect(payload.header.Authorization).toContain('token-1');
  });

  it('maps transport failures to status 0', async () => {
    requestMock.mockRejectedValueOnce(Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' }));
    const status = await probeAccountImportItem(makeItem());
    expect(status.statusCode).toBe(0);
    expect(status.message).toMatch(/timeout/i);
  });

  it('probes multiple items and collects status codes', async () => {
    requestMock
      .mockResolvedValueOnce({ statusCode: 401, header: {}, bodyText: 'unauthorized', body: null })
      .mockResolvedValueOnce({ statusCode: 200, header: {}, bodyText: '{}', body: {} });

    const items = [
      makeItem({ credentialHash: 'a', fileName: 'a.json' }),
      makeItem({ credentialHash: 'b', fileName: 'b.json' }),
    ];
    const map = await probeAccountImportItems(items, { concurrency: 2 });
    expect(Object.keys(map)).toHaveLength(2);
    expect(collectProbeStatusCodes(items, map).sort((a, b) => a - b)).toEqual([200, 401]);
    expect(getAccountImportItemKey(items[0], 0)).toBe('a');
  });
});
