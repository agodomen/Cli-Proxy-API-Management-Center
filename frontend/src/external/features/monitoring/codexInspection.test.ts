import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexInspectionResultItem, CodexInspectionSettings } from './codexInspection';

const authFilesMocks = vi.hoisted(() => ({
  deleteFileByName: vi.fn(),
  list: vi.fn(),
  setStatusWithFallback: vi.fn(),
}));

vi.mock('@/external/services/api/authFiles', () => ({
  authFilesApi: { list: authFilesMocks.list },
  deleteFileByName: authFilesMocks.deleteFileByName,
  setStatusWithFallback: authFilesMocks.setStatusWithFallback,
}));

import {
  executeCodexInspectionActions,
  filterCodexInspectionRealtimeActionItems,
  isCodexInvalidAccountResponse,
  resolveCodexInspectionRealtimeActionItems,
} from './codexInspection';

const settings: CodexInspectionSettings = {
  baseUrl: '',
  token: '',
  accountSource: 'oauth',
  targetType: 'codex',
  workers: 1,
  deleteWorkers: 2,
  timeout: 1000,
  retries: 0,
  userAgent: '',
  usedPercentThreshold: 100,
  sampleSize: 0,
  probePromptMode: 'math',
  probeModel: '',
  providerFilter: '',
  autoActionMode: 'none',
};

const createDeleteItem = (fileName: string): CodexInspectionResultItem => ({
  key: fileName,
  fileName,
  displayAccount: fileName,
  authIndex: null,
  accountId: null,
  provider: 'codex',
  disabled: false,
  status: '',
  state: '',
  accountSource: 'oauth',
  raw: { name: fileName },
  action: 'delete',
  actionReason: 'invalid account',
  statusCode: 401,
  usedPercent: null,
  isQuota: false,
  error: '',
});

describe('executeCodexInspectionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authFilesMocks.list.mockResolvedValue({ files: [] });
  });

  it('continues deleting remaining accounts when one deletion fails', async () => {
    authFilesMocks.deleteFileByName.mockImplementation(async (fileName: string) => {
      if (fileName === 'blocked.json') {
        throw new Error('file is locked');
      }
      return {
        status: 'ok',
        deleted: 1,
        files: [fileName],
        failed: [],
      };
    });

    const result = await executeCodexInspectionActions({
      settings,
      items: [
        createDeleteItem('first.json'),
        createDeleteItem('blocked.json'),
        createDeleteItem('last.json'),
      ],
      previousFiles: [],
    });

    expect(authFilesMocks.deleteFileByName).toHaveBeenCalledTimes(3);
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        fileName: 'blocked.json',
        success: false,
        error: 'file is locked',
      }),
      expect.objectContaining({ fileName: 'first.json', success: true }),
      expect.objectContaining({ fileName: 'last.json', success: true }),
    ]);
  });
});

describe('isCodexInvalidAccountResponse', () => {
  it('never treats HTTP 2xx as an invalid account, even with failure text in body', () => {
    expect(
      isCodexInvalidAccountResponse(
        200,
        'request failed\nunauthorized\ninvalid token\nbilling ok'
      )
    ).toBe(false);
    expect(isCodexInvalidAccountResponse(204, '账号已失效')).toBe(false);
  });

  it('treats 401 as invalid regardless of body', () => {
    expect(isCodexInvalidAccountResponse(401, '')).toBe(true);
    expect(isCodexInvalidAccountResponse(401, 'ok')).toBe(true);
  });

  it('matches invalid account keywords only on non-success responses', () => {
    expect(isCodexInvalidAccountResponse(403, 'invalid_api_key')).toBe(true);
    expect(isCodexInvalidAccountResponse(500, '账号已失效')).toBe(true);
    expect(isCodexInvalidAccountResponse(500, 'request failed')).toBe(false);
    expect(isCodexInvalidAccountResponse(0, 'unauthorized')).toBe(true);
  });
});


describe('filterCodexInspectionRealtimeActionItems', () => {
  const base = {
    key: 'a',
    fileName: 'a.json',
    displayAccount: 'a',
    authIndex: null,
    accountId: null,
    provider: 'codex',
    disabled: false,
    status: '',
    state: '',
    accountSource: 'oauth' as const,
    raw: { name: 'a.json' },
    actionReason: '',
    statusCode: 401,
    usedPercent: null,
    isQuota: false,
    error: '',
  };

  it('filters by realtime checkboxes and blocks api_key delete', () => {
    const items = [
      { ...base, fileName: 'd.json', action: 'disable' as const },
      { ...base, fileName: 'e.json', action: 'enable' as const },
      { ...base, fileName: 'x.json', action: 'delete' as const },
      {
        ...base,
        fileName: 'k.json',
        action: 'delete' as const,
        accountSource: 'api_key' as const,
      },
    ];

    const filtered = filterCodexInspectionRealtimeActionItems(
      items,
      { disable: true, enable: true, delete: false },
      'oauth'
    );
    expect(filtered.map((item) => item.fileName)).toEqual(['d.json', 'e.json']);

    const withDelete = filterCodexInspectionRealtimeActionItems(
      items,
      { disable: false, enable: false, delete: true },
      'oauth'
    );
    expect(withDelete.map((item) => item.fileName)).toEqual(['x.json']);

    const apiKeySource = filterCodexInspectionRealtimeActionItems(
      items,
      { disable: true, enable: true, delete: true },
      'api_key'
    );
    expect(apiKeySource.map((item) => item.fileName).sort()).toEqual(['d.json', 'e.json']);
  });

  it('resolveCodexInspectionRealtimeActionItems maps delete->disable under disable mode', () => {
    const items = [
      {
        ...base,
        fileName: 'x.json',
        action: 'delete' as const,
        actionReason: 'invalid',
      },
    ];
    const resolved = resolveCodexInspectionRealtimeActionItems(
      'disable',
      items,
      { disable: true, enable: true, delete: false },
      'oauth'
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].action).toBe('disable');
  });
});
