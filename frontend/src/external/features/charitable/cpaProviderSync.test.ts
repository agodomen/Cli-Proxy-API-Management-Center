import { describe, expect, it } from 'vitest';
import { buildProviderCpaConfig } from './cpaProviderSync';
import type { APIKey, Provider } from './types';

const provider: Provider = {
  provider_id: 7,
  provider_name: 'Example Provider',
  description: '',
  status: 1,
  base_url: 'https://api.example.com/',
  probe_policy: '{}',
  param: JSON.stringify({
    proxy_url: 'http://provider-proxy:8080',
    models: [{ name: 'gpt-4.1', alias: 'GPT 4.1' }],
    test_model: 'gpt-4.1',
  }),
  create_at: '',
  update_at: '',
};

const key = (overrides: Partial<APIKey>): APIKey => ({
  id: 1,
  auth_index: 'auth-1',
  auth_type: 1,
  auth_value: 'sk-valid',
  auth_info: '{}',
  status: 1,
  priority: 10,
  probe_policy: '{}',
  param: '{}',
  provider_id: 7,
  create_at: '',
  update_at: '',
  ...overrides,
});

describe('buildProviderCpaConfig', () => {
  it('replaces managed fields and only sends valid API keys', () => {
    const result = buildProviderCpaConfig(provider, [
      key({}),
      key({ id: 2, auth_index: 'auth-2', auth_value: 'sk-invalid', status: -1 }),
      key({ id: 3, auth_index: 'auth-3', auth_value: 'sk-service', auth_type: 2 }),
    ], {
      name: 'Example Provider',
      baseUrl: 'https://old.example.com',
      apiKeyEntries: [{ apiKey: 'sk-old' }],
      customField: 'preserved',
    });

    expect(result).toMatchObject({
      name: 'Example Provider',
      baseUrl: 'https://api.example.com',
      disabled: false,
      testModel: 'gpt-4.1',
      customField: 'preserved',
      apiKeyEntries: [{
        apiKey: 'sk-valid',
        authIndex: 'auth-1',
        proxyUrl: 'http://provider-proxy:8080',
      }],
    });
  });
});
