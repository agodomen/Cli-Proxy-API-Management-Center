import { describe, expect, it } from 'vitest';
import {
  buildAuthFileFieldsPatch,
  buildAuthFilePushPayload,
  isAuthFileCredential,
  previewAuthFileRequestConfig,
  resolveAuthFileName,
  stampAuthInfoPushedAt,
} from './authFilePush';
import type { APIKey, Provider } from './types';

const key = (partial: Partial<APIKey>): APIKey => ({
  id: 1,
  auth_index: 'auth-1',
  auth_type: 3,
  auth_value: '{}',
  auth_info: '{}',
  status: 1,
  priority: 0,
  probe_policy: '{}',
  param: '{}',
  create_at: '',
  update_at: '',
  ...partial,
});

const provider = (partial: Partial<Provider> = {}): Provider => ({
  provider_id: 2,
  provider_name: 'Codex',
  description: '',
  status: 1,
  base_url: 'https://chatgpt.com/backend-api/codex',
  probe_policy: '{}',
  param: '{}',
  create_at: '',
  update_at: '',
  ...partial,
});

describe('authFilePush', () => {
  it('detects auth-file credentials by file_name and auth_type', () => {
    expect(
      isAuthFileCredential(
        key({
          auth_type: 1,
          auth_info:
            '{"schema_version":1,"credential_type":"api_key","api_type":1,"protocols":[],"file_name":"a.json"}',
        })
      )
    ).toBe(true);
    expect(
      isAuthFileCredential(
        key({
          auth_type: 3,
          auth_info: '{"schema_version":1,"credential_type":"oauth2","api_type":2,"protocols":[]}',
        })
      )
    ).toBe(true);
    expect(
      isAuthFileCredential(
        key({
          auth_type: 1,
          auth_info: '{"schema_version":1,"credential_type":"api_key","api_type":1,"protocols":[]}',
        })
      )
    ).toBe(false);
  });

  it('create payload merges provider/key headers over auth_value without dropping tokens', () => {
    const result = buildAuthFilePushPayload({
      key: key({
        status: 0,
        priority: 8,
        auth_info:
          '{"schema_version":1,"credential_type":"oauth2","api_type":2,"protocols":["openai"],"file_name":"alice.codex.json","provider_type":"codex"}',
        auth_value: JSON.stringify({
          type: 'codex',
          access_token: 'tok',
          refresh_token: 'ref',
          headers: { 'X-Base': 'b', 'X-Remove': 'base' },
        }),
        param: '{"headers":{"X-Key":"k","X-Remove":""},"proxy_url":"http://key-proxy"}',
      }),
      provider: provider({
        param: '{"headers":{"X-Provider":"1","X-Remove":"old"},"proxy_url":"http://provider-proxy"}',
      }),
    });

    expect(result.fileName).toBe('alice.codex.json');
    expect(result.disabled).toBe(true);
    expect(result.payload.priority).toBe(8);
    expect(result.payload.disabled).toBe(true);
    expect(result.payload.proxy_url).toBe('http://key-proxy');
    expect(result.payload.headers).toEqual({
      'X-Base': 'b',
      'X-Provider': '1',
      'X-Key': 'k',
    });
    expect(result.payload.access_token).toBe('tok');
    expect(result.payload.refresh_token).toBe('ref');
  });

  it('field patch removes previous managed headers and keeps original auth-file headers', () => {
    const built = buildAuthFileFieldsPatch({
      key: key({
        priority: 9,
        auth_info: JSON.stringify({
          schema_version: 1,
          credential_type: 'oauth2',
          api_type: 2,
          protocols: ['openai'],
          file_name: 'alice.codex.json',
          managed_header_keys: ['X-Old-Managed', 'User-Agent'],
          managed_auth_file_fields: ['proxy_url'],
        }),
        param: '{"headers":{"User-Agent":"key-ua","X-Key":"k"}}',
      }),
      provider: provider({
        param: '{"headers":{"X-Provider":"p"},"prefix":"acct"}',
      }),
      currentAuthJSON: {
        type: 'codex',
        access_token: 'live-token',
        refresh_token: 'live-refresh',
        headers: {
          'X-Original': 'keep',
          'X-Old-Managed': 'drop-me',
          'User-Agent': 'old-ua',
        },
        proxy_url: 'http://old-proxy',
      },
    });

    // Never rewrite tokens via fields patch.
    expect(built.fields).not.toHaveProperty('access_token');
    expect(built.fields).not.toHaveProperty('refresh_token');
    expect(built.fields.priority).toBe(9);
    expect(built.fields.proxy_url).toBe(''); // previous managed proxy cleared when neither side provides it
    expect(built.fields.prefix).toBe('acct');
    expect(built.managedHeaderKeys).toEqual(['X-Provider', 'User-Agent', 'X-Key']);
    expect(built.fields.headers).toEqual({
      'X-Old-Managed': '',
      'User-Agent': 'key-ua',
      'X-Provider': 'p',
      'X-Key': 'k',
    });
  });

  it('preview reports header transitions for an existing auth file', () => {
    const preview = previewAuthFileRequestConfig({
      key: key({
        auth_info:
          '{"schema_version":1,"credential_type":"oauth2","api_type":2,"protocols":[],"file_name":"a.json","label":"Alice","managed_header_keys":["X-Old"]}',
        param: '{"headers":{"X-Key":"1"}}',
        priority: 3,
        status: 1,
      }),
      provider: provider({ param: '{"headers":{"X-Provider":"2"}}' }),
      currentAuthJSON: {
        headers: { 'X-Original': 'o', 'X-Old': 'gone' },
      },
    });
    expect(preview.mode).toBe('patch');
    expect(preview.accountLabel).toBe('Alice');
    expect(preview.headerChanges).toEqual(
      expect.arrayContaining([
        { name: 'X-Old', from: 'gone', to: '' },
        { name: 'X-Provider', from: '', to: '2' },
        { name: 'X-Key', from: '', to: '1' },
      ])
    );
    expect(preview.headerChanges.find((item) => item.name === 'X-Original')).toBeUndefined();
  });

  it('stamps managed metadata with source_modtime', () => {
    const stamped = stampAuthInfoPushedAt(
      '{"schema_version":1,"credential_type":"oauth2","api_type":2,"protocols":[],"file_name":"a.json"}',
      'a.json',
      {
        managedHeaderKeys: ['User-Agent', 'X-Custom'],
        managedFields: ['proxy_url'],
        sourceModified: 1784700000000,
      }
    );
    const parsed = JSON.parse(stamped) as Record<string, unknown>;
    expect(parsed.managed_header_keys).toEqual(['User-Agent', 'X-Custom']);
    expect(parsed.managed_auth_file_fields).toEqual(['proxy_url']);
    expect(parsed.source_modtime).toBe(1784700000000);
    expect(parsed.source_modified).toBe(1784700000000);
    expect(typeof parsed.last_pushed_at).toBe('number');
  });

  it('requires file name', () => {
    expect(resolveAuthFileName(key({ auth_index: '', auth_info: '{}' }))).toBe('');
    expect(resolveAuthFileName(key({ auth_index: 'abc', auth_info: '{}' }))).toBe('abc.json');
  });
});
