/**
 * Regression tests for the CPAMC request origin fallback.
 *
 * The secondary-development panel is embedded in and served by the CPAMC
 * backend (/management.html). When a user points the login apiBase at an
 * external CLIProxyAPI host (external-cpa direct usage), that host has no
 * /v0/cpamc/* routes and answers 404 — which the plugin store page used to
 * misreport as "backend does not expose the plugin store API". The cpamc
 * request family now retries once against the panel origin on 404.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const instanceRequestMock = vi.hoisted(() => vi.fn());
const axiosRequestMock = vi.hoisted(() => vi.fn());
const dispatchEventMock = vi.hoisted(() => vi.fn());

vi.mock('axios', () => {
  const isAxiosError = (error: unknown): boolean =>
    Boolean(error) &&
    typeof error === 'object' &&
    'isAxiosError' in (error as Record<string, unknown>);
  return {
    default: {
      create: () => ({
        request: instanceRequestMock,
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
        defaults: { timeout: 30000, headers: {} },
      }),
      request: axiosRequestMock,
      isAxiosError,
    },
    isAxiosError,
  };
});

import { apiClient } from '@/services/api/client';

const stubWindow = (host: string) => {
  vi.stubGlobal('window', {
    location: { protocol: 'http:', host },
    dispatchEvent: dispatchEventMock,
    addEventListener: vi.fn(),
  });
};

/** Error shape produced by the instance interceptor chain (ApiError). */
const apiError = (status: number, message: string) => {
  const error = new Error(message) as Error & { status?: number };
  error.name = 'ApiError';
  error.status = status;
  return error;
};

/** Raw axios error shape produced by the module-level fallback request. */
const axiosError = (status: number, message: string) => {
  const error = new Error(message) as Error & {
    isAxiosError: boolean;
    response: { status: number; data: unknown };
  };
  error.isAxiosError = true;
  error.response = { status, data: { error: 'invalid_management_key', message } };
  return error;
};

describe('cpamc request origin fallback', () => {
  beforeEach(() => {
    instanceRequestMock.mockReset();
    axiosRequestMock.mockReset();
    dispatchEventMock.mockClear();
    stubWindow('127.0.0.1:18317');
  });

  test('uses the apiBase-derived cpamc base on the happy path', async () => {
    apiClient.setConfig({ apiBase: 'http://127.0.0.1:18317', managementKey: 'secret' });
    instanceRequestMock.mockResolvedValue({ data: { plugins: [] } });

    const result = await apiClient.cpamcGet('/plugin-store');

    expect(result).toEqual({ plugins: [] });
    expect(instanceRequestMock).toHaveBeenCalledTimes(1);
    expect(instanceRequestMock.mock.calls[0][0]).toMatchObject({
      method: 'get',
      url: '/plugin-store',
      baseURL: 'http://127.0.0.1:18317/v0/cpamc',
    });
    expect(axiosRequestMock).not.toHaveBeenCalled();
  });

  test('retries against the panel origin when the apiBase host returns 404', async () => {
    apiClient.setConfig({ apiBase: 'http://127.0.0.1:8317', managementKey: 'secret' });
    instanceRequestMock.mockRejectedValue(apiError(404, 'Request failed with status code 404'));
    axiosRequestMock.mockResolvedValue({ data: { plugins: [] } });

    const result = await apiClient.cpamcGet('/plugin-store');

    expect(result).toEqual({ plugins: [] });
    expect(axiosRequestMock).toHaveBeenCalledTimes(1);
    expect(axiosRequestMock.mock.calls[0][0]).toMatchObject({
      method: 'get',
      url: '/plugin-store',
      baseURL: 'http://127.0.0.1:18317/v0/cpamc',
    });
    expect(
      (axiosRequestMock.mock.calls[0][0] as { headers: Record<string, string> }).headers
        .Authorization
    ).toBe('Bearer secret');
  });

  test('surfaces fallback 401 as a normal error without triggering global logout', async () => {
    apiClient.setConfig({ apiBase: 'http://127.0.0.1:8317', managementKey: 'secret' });
    instanceRequestMock.mockRejectedValue(apiError(404, 'Request failed with status code 404'));
    axiosRequestMock.mockRejectedValue(axiosError(401, 'invalid management key'));

    const error = (await apiClient.cpamcGet('/plugin-store').then(
      () => null,
      (err: unknown) => err
    )) as (Error & { status?: number }) | null;

    expect(error).not.toBeNull();
    expect(error?.status).toBe(401);
    expect(error?.message).toContain('invalid management key');
    expect(dispatchEventMock).not.toHaveBeenCalled();
  });

  test('does not retry on non-404 failures', async () => {
    apiClient.setConfig({ apiBase: 'http://127.0.0.1:8317', managementKey: 'secret' });
    instanceRequestMock.mockRejectedValue(apiError(502, 'bad gateway'));

    await expect(apiClient.cpamcGet('/plugin-store')).rejects.toMatchObject({ status: 502 });
    expect(axiosRequestMock).not.toHaveBeenCalled();
  });

  test('does not retry when apiBase already matches the panel origin', async () => {
    apiClient.setConfig({ apiBase: 'http://127.0.0.1:18317', managementKey: 'secret' });
    instanceRequestMock.mockRejectedValue(apiError(404, 'Request failed with status code 404'));

    await expect(apiClient.cpamcGet('/plugin-store')).rejects.toMatchObject({ status: 404 });
    expect(axiosRequestMock).not.toHaveBeenCalled();
  });

  test('post requests fall back with their payload preserved', async () => {
    apiClient.setConfig({ apiBase: 'http://127.0.0.1:8317', managementKey: 'secret' });
    instanceRequestMock.mockRejectedValue(apiError(404, 'Request failed with status code 404'));
    axiosRequestMock.mockResolvedValue({ data: { status: 'installed' } });

    const result = await apiClient.cpamcPost('/plugin-store/demo/install', { version: '1.2.3' });

    expect(result).toEqual({ status: 'installed' });
    expect(axiosRequestMock.mock.calls[0][0]).toMatchObject({
      method: 'post',
      url: '/plugin-store/demo/install',
      data: { version: '1.2.3' },
      baseURL: 'http://127.0.0.1:18317/v0/cpamc',
    });
  });
});
