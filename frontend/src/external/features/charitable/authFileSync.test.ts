import { describe, expect, it } from 'vitest';
import { buildAuthFileSyncDetail } from './authFileSync';
import type { Provider } from './types';

const provider = (providerId: number, providerName: string, baseUrl: string, updateAt = ''): Provider => ({
  provider_id: providerId,
  provider_name: providerName,
  description: '',
  status: 1,
  base_url: baseUrl,
  probe_policy: '{}',
  param: '{}',
  create_at: '',
  update_at: updateAt,
});

describe('buildAuthFileSyncDetail', () => {
  it('maps disabled auth file into status 0 and keeps full auth_value', () => {
    const authJSON = {
      type: 'codex',
      email: 'alice@example.com',
      access_token: 'token-a',
      refresh_token: 'token-r',
      headers: { 'User-Agent': 'demo' },
      base_url: 'https://chatgpt.com/backend-api/codex',
      priority: 9,
    };
    const providers = [
      provider(1, 'Codex Old', 'https://chatgpt.com/backend-api/codex', '2026-01-01T00:00:00Z'),
      provider(2, 'Codex New', 'https://chatgpt.com/backend-api/codex', '2026-03-01T00:00:00Z'),
    ];

    const result = buildAuthFileSyncDetail({
      file: {
        name: 'alice.codex.json',
        authIndex: 'auth-index-1',
        disabled: true,
        type: 'codex',
      },
      authJSON,
      providers,
    });

    expect(result.detail.auth_index).toBe('auth-index-1');
    expect(result.detail.auth_type).toBe(3);
    expect(result.detail.status).toBe(0);
    expect(result.detail.priority).toBe(9);
    expect(result.detail.provider_id).toBe(2);
    expect(result.detail.auth_value).toContain('token-a');
    expect(result.detail.auth_info).toContain('alice.codex.json');
    expect(result.detail.auth_info).toContain('auth_file_sync');
    expect(result.detail.auth_info).not.toContain('token-a');
    expect(result.unmatchedProvider).toBe(false);
  });

  it('preserves existing center param and private fields', () => {
    const result = buildAuthFileSyncDetail({
      file: {
        name: 'bob.xai.json',
        authIndex: 'auth-2',
        disabled: false,
        type: 'xai',
      },
      authJSON: {
        type: 'xai',
        access_token: 'x',
        headers: { A: '1' },
      },
      providers: [provider(5, 'Grok', 'https://api.x.ai/v1', '2026-01-01T00:00:00Z')],
      existing: {
        id: 9,
        auth_index: 'auth-2',
        auth_type: 3,
        auth_value: '{}',
        auth_info: '{"schema_version":1,"credential_type":"oauth2","api_type":2,"protocols":["openai"]}',
        status: 1,
        priority: 1,
        probe_policy: '{"enabled":true}',
        param: '{"headers":{"Keep":"1"}}',
        provider_id: 5,
        create_at: '',
        update_at: '',
        remark: 'keep-me',
      },
    });

    expect(result.detail.param).toBe('{"headers":{"Keep":"1"}}');
    expect(result.detail.probe_policy).toBe('{"enabled":true}');
    expect(result.detail.remark).toBe('keep-me');
    expect(result.detail.status).toBe(1);
  });
});

  it('reuses existing auth_index when file lacks authIndex', () => {
    const result = buildAuthFileSyncDetail({
      file: {
        name: 'alice.codex.json',
        disabled: false,
        type: 'codex',
      },
      authJSON: {
        type: 'codex',
        access_token: 'token-refreshed',
        base_url: 'https://chatgpt.com/backend-api/codex',
      },
      providers: [provider(1, 'Codex', 'https://chatgpt.com/backend-api/codex', '2026-03-01T00:00:00Z')],
      existing: {
        id: 9,
        auth_index: 'stable-auth-index',
        auth_type: 3,
        auth_value: '{"type":"codex","access_token":"old"}',
        auth_info: '{"schema_version":1,"credential_type":"oauth2","api_type":2,"protocols":["openai"],"file_name":"alice.codex.json"}',
        content: '',
        status: 1,
        priority: 1,
        probe_policy: '{}',
        param: '{"headers":{"X-Keep":"1"}}',
        provider_id: 1,
        create_at: '',
        update_at: '',
      },
    });

    expect(result.detail.auth_index).toBe('stable-auth-index');
    expect(result.detail.param).toContain('X-Keep');
    expect(result.detail.auth_value).toContain('token-refreshed');
  });

