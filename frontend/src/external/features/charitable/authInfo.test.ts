import { describe, expect, it } from 'vitest';
import { buildImportedAuthDetail, parseAuthInfo } from './authInfo';

describe('charitable auth info', () => {
  it('maps an imported API key to plain auth_value and JSON auth_info', () => {
    const detail = buildImportedAuthDetail({
      fileName: 'gemini.json',
      authJson: { type: 'gemini', api_key: 'gemini-secret', disabled: true },
      source: 'cpa',
      label: 'Gemini key',
      credentialHash: 'hash-1',
    });

    expect(detail.auth_type).toBe(1);
    expect(detail.auth_value).toBe('gemini-secret');
    expect(detail.status).toBe(0);
    expect(parseAuthInfo(detail.auth_info).protocols).toEqual(['gemini']);
  });

  it('maps OAuth credentials to canonical JSON auth_value without secrets in auth_info', () => {
    const detail = buildImportedAuthDetail({
      fileName: 'codex.json',
      authJson: {
        type: 'codex',
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        email: 'user@example.com',
      },
      source: 'session',
      label: 'user@example.com',
      email: 'user@example.com',
      credentialHash: 'hash-2',
    });

    expect(detail.auth_type).toBe(3);
    expect(JSON.parse(detail.auth_value || '{}')).toMatchObject({
      access_token: 'access-secret',
      refresh_token: 'refresh-secret',
    });
    expect(detail.auth_info).not.toContain('access-secret');
    expect(detail.auth_info).not.toContain('refresh-secret');
    expect(detail.status).toBe(0);
  });
});

  it('respects disabled=false as status 1 and reuses existing auth_index', () => {
    const detail = buildImportedAuthDetail(
      {
        fileName: 'codex-enabled.json',
        authJson: {
          type: 'codex',
          access_token: 'access-secret',
          disabled: false,
        },
        source: 'session',
        label: 'enabled',
        credentialHash: 'hash-3',
      },
      {
        auth_index: 'keep-index',
        param: '{"headers":{"X-A":"1"}}',
        probe_policy: '{"interval":60}',
        remark: 'ops note',
        provider_id: 7,
        auth_info: '{"schema_version":1,"credential_type":"oauth2","api_type":2,"protocols":["openai"],"file_name":"codex-enabled.json"}',
      }
    );

    expect(detail.auth_index).toBe('keep-index');
    expect(detail.status).toBe(1);
    expect(detail.param).toContain('X-A');
    expect(detail.probe_policy).toContain('interval');
    expect(detail.provider_id).toBe(7);
    expect(parseAuthInfo(detail.auth_info).file_name).toBe('codex-enabled.json');
  });

