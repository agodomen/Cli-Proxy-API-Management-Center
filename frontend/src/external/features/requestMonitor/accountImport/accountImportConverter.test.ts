import { describe, expect, it } from 'vitest';
import { buildAccountImportPreview } from './accountImportConverter';

const taskExportSample = [
  {
    account_id: 'acc-1',
    task_id: 'task-1',
    platform_id: 'grok',
    mode: 'register',
    run_type: 'full',
    task_status: 'success',
    account_status: 'active',
    validation_status: 'passed',
    validation_reason: null,
    validation_attempts: 1,
    last_validated_at: null,
    next_validation_at: null,
    export_status: 'exported',
    real_registration: true,
    created: true,
    network_calls: null,
    email_provider: 'temp',
    email_address: 'user@example.com',
    email_inbox_user: null,
    username: 'grokuser',
    credential_ref: 'cred-1',
    last_error: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    inserted_at: '2026-01-01T00:00:00Z',
    payload: {
      task: {
        mode: 'register',
        events: [],
        status: 'success',
        task_id: 'task-1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        platform_id: 'grok',
        input_summary: {
          source: 'dir',
          temp_mail: {
            email: 'user@example.com',
            address: 'user@example.com',
            enabled: true,
            provider: 'temp',
          },
          source_dir: '/tmp',
        },
      },
      result: {
        sso: 'sso-token',
        email: 'user@example.com',
        source: 'register',
        account: 'acc-1',
        created: true,
        expired: null,
        headers: {
          'User-Agent': 'grok-shell/0.2.93',
          'x-xai-token-auth': 'token-auth',
          'x-grok-client-version': '1',
          'x-authenticateresponse': 'ok',
          'x-grok-client-identifier': 'id',
        },
        summary: 'ok',
        password: 'secret',
        run_type: 'full',
        username: 'grokuser',
        sso_token: 'sso-token',
        access_token: 'access-token-value',
        refresh_token: 'refresh-token-value',
        credential_ref: 'cred-1',
        real_registration: true,
        auth_kind: 'oauth',
        base_url: 'https://api.x.ai/v1',
      },
    },
  },
];

describe('accountImportConverter sub2api task-export', () => {
  it('auto-detects task export as sub2api and maps payload.result credentials', () => {
    const result = buildAccountImportPreview(JSON.stringify(taskExportSample), 'auto', {
      defaultDisabled: true,
    });

    expect(result.detectedFormat).toBe('sub2api');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].email).toBe('user@example.com');
    expect(result.items[0].authJson.type).toBe('xai');
    expect(result.items[0].authJson.access_token).toBe('access-token-value');
    expect(result.items[0].authJson.refresh_token).toBe('refresh-token-value');
    expect(result.items[0].authJson.disabled).toBe(true);
    expect(result.items[0].authJson.headers).toMatchObject({
      'x-xai-token-auth': 'token-auth',
    });
  });

  it('applies custom headers, proxy URL, and priority to every imported account', () => {
    const result = buildAccountImportPreview(JSON.stringify(taskExportSample), 'auto', {
      headers: {
        'User-Agent': 'custom-client/1.0',
        'X-Custom-Header': 'enabled',
      },
      proxyUrl: 'socks5://127.0.0.1:1080',
      priority: 42,
    });

    expect(result.items[0].authJson.headers).toMatchObject({
      'User-Agent': 'custom-client/1.0',
      'x-xai-token-auth': 'token-auth',
      'X-Custom-Header': 'enabled',
    });
    expect(result.items[0].authJson.proxy_url).toBe('socks5://127.0.0.1:1080');
    expect(result.items[0].authJson.priority).toBe(42);
  });

  it('keeps source import settings when no custom override is provided', () => {
    const source = {
      type: 'codex',
      access_token: 'token',
      proxy_url: 'http://source-proxy:8080',
      priority: 7,
      headers: { 'X-Source': 'source' },
    };
    const result = buildAccountImportPreview(JSON.stringify(source), 'cpa-single');

    expect(result.items[0].authJson.proxy_url).toBe('http://source-proxy:8080');
    expect(result.items[0].authJson.priority).toBe(7);
    expect(result.items[0].authJson.headers).toEqual({ 'X-Source': 'source' });
  });

  it('supports explicit sub2api format for task export arrays', () => {
    const result = buildAccountImportPreview(JSON.stringify(taskExportSample), 'sub2api', {
      defaultDisabled: false,
    });
    expect(result.detectedFormat).toBe('sub2api');
    expect(result.items[0].authJson.disabled).toBe(false);
    expect(result.items[0].authJson.type).toBe('xai');
  });

  it('skips task export items without usable credentials and keeps warnings', () => {
    const payload = [
      {
        ...taskExportSample[0],
        account_id: 'bad',
        payload: {
          ...taskExportSample[0].payload,
          result: {
            email: 'bad@example.com',
            source: 'register',
            account: 'bad',
            created: false,
            expired: null,
            summary: 'failed',
            password: '',
            run_type: 'full',
            username: 'bad',
            sso_token: '',
            credential_ref: 'bad',
            real_registration: false,
          },
        },
      },
      taskExportSample[0],
    ];

    const result = buildAccountImportPreview(JSON.stringify(payload), 'sub2api');
    expect(result.items).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
