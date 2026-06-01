import { describe, expect, it, vi } from 'vitest';
import { filterKeysByProbeStrategy, listAllFilteredKeys, probeKeysAndPersistWithOptions } from './keyProbeService';
import type { APIKey } from './types';

vi.mock('./api', () => ({
  listKeys: vi.fn(async (_base: string, params: { page: number }) => {
    if (params.page === 1) {
      return {
        page: 1,
        page_size: 500,
        total_items: 2,
        items: [
          { id: 1, auth_index: 'a', auth_type: 1, auth_value: 'sk-1', auth_info: '{}', content: '', status: 1, priority: 0, probe_policy: '{}', param: '{}', create_at: '', update_at: '' },
          { id: 2, auth_index: 'b', auth_type: 1, auth_value: 'sk-2', auth_info: '{}', content: '', status: 0, priority: 0, probe_policy: '{}', param: '{}', create_at: '', update_at: '' },
        ],
      };
    }
    return { page: params.page, page_size: 500, total_items: 2, items: [] };
  }),
  batchToggleKeys: vi.fn(async () => undefined),
  formatCharitableApiError: (error: unknown) => (error instanceof Error ? error.message : 'request_failed'),
}));

vi.mock('./authFilePush', () => ({
  isAuthFileCredential: () => false,
}));

vi.mock('./authFileProbe', () => ({
  runAuthFileAvailabilityProbe: vi.fn(),
}));

describe('keyProbeService', () => {
  it('lists all filtered keys across pages', async () => {
    const result = await listAllFilteredKeys('http://usage.test', { provider_id: 9, status: 'all' }, 'key');
    expect(result).toHaveLength(2);
  });

  it('filters keys by probe strategy', () => {
    const keys = [
      { id: 1, status: 200 },
      { id: 2, status: 0 },
      { id: 3, status: -401 },
      { id: 4, status: -2 },
    ] as APIKey[];
    expect(filterKeysByProbeStrategy(keys, 'all')).toHaveLength(4);
    expect(filterKeysByProbeStrategy(keys, 'unknown_invalid').map((k) => k.id)).toEqual([2, 3, 4]);
    expect(filterKeysByProbeStrategy(keys, 'enabled_only').map((k) => k.id)).toEqual([1, 2, 3]);
    expect(filterKeysByProbeStrategy(keys, 'disabled_only').map((k) => k.id)).toEqual([4]);
    expect(filterKeysByProbeStrategy(keys, 'valid_only').map((k) => k.id)).toEqual([1]);
  });

  it('persists same-status updates in chunks of at most 500 ids', async () => {
    const { batchToggleKeys } = await import('./api');
    const mockedToggle = vi.mocked(batchToggleKeys);
    mockedToggle.mockClear();

    const keys = Array.from({ length: 1201 }, (_, index) => ({
      id: index + 1,
      auth_index: `key-${index + 1}`,
      auth_type: 1,
      auth_value: `sk-${index + 1}`,
      auth_info: '{}',
      content: '',
      status: 0,
      priority: 0,
      probe_policy: '{}',
      param: '{}',
      create_at: '',
      update_at: '',
      provider_id: 1,
    })) as APIKey[];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'ok', choices: [{ message: { content: '1' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as typeof fetch;

    try {
      const result = await probeKeysAndPersistWithOptions({
        baseUrl: 'http://usage.test',
        managementKey: 'key',
        keys,
        providers: [
          {
            provider_id: 1,
            provider_name: 'openai',
            description: '',
            status: 1,
            base_url: 'https://api.openai.com',
            protocol_type: 'openai_compatible',
            probe_policy: '{}',
            param: '{"models":[{"name":"gpt-4o-mini"}]}',
            create_at: '',
            update_at: '',
          },
        ],
        concurrency: 8,
        autoAction: 'status_only',
      });

      expect(result.statusChanged).toBe(true);
      expect(result.statusWriteFailed).toBe(0);
      expect(mockedToggle).toHaveBeenCalledTimes(3);
      expect(mockedToggle.mock.calls.map((call) => (call[1] as number[]).length)).toEqual([500, 500, 201]);
      expect(mockedToggle.mock.calls.every((call) => call[2] === 200)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
