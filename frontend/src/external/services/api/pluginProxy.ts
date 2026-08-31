import { apiClient } from '@/services/api/client';
import { isRecord } from '@/utils/helpers';

export type PluginProxyStatus = 0 | 1 | 2 | 3;

export interface PluginProxyConfig {
  url: string;
  /** Accelerator base used when status=3. Independent from url. */
  accelerator: string;
  /** 0=none, 1=custom proxy, 2=system, 3=accelerator */
  status: PluginProxyStatus;
}

export interface PluginProxyResponse {
  pluginProxy: PluginProxyConfig;
  proxyUrl: string;
  effective: string;
}

const asString = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return String(value);
};

const normalizePluginProxyStatus = (value: unknown): PluginProxyStatus => {
  const raw =
    typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (raw === 1) return 1;
  if (raw === 2) return 2;
  if (raw === 3) return 3;
  return 0;
};

const normalizePluginProxyConfig = (value: unknown): PluginProxyConfig => {
  const source = isRecord(value) ? value : {};
  return {
    url: asString(source.url).trim(),
    accelerator: asString(source.accelerator).trim(),
    status: normalizePluginProxyStatus(source.status),
  };
};

const normalizePluginProxyResponse = (value: unknown): PluginProxyResponse => {
  const source = isRecord(value) ? value : {};
  return {
    pluginProxy: normalizePluginProxyConfig(source['plugin-proxy'] ?? source.pluginProxy),
    proxyUrl: asString(source['proxy-url'] ?? source.proxyUrl).trim(),
    effective: asString(source.effective).trim(),
  };
};

const getPluginProxyErrorMessage = (error: unknown): string => {
  if (isRecord(error)) {
    if (isRecord(error.details)) {
      const detail = error.details.error ?? error.details.message;
      if (typeof detail === 'string' && detail.trim()) {
        return detail.trim();
      }
    }
    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim();
    }
  }
  return 'invalid plugin-proxy url';
};

export const isPluginProxyUnsupportedError = (error: unknown): boolean =>
  isRecord(error) && error.status === 404;

export const pluginProxyApi = {
  async getSystemProxyUrl(): Promise<string> {
    try {
      const data = await apiClient.get('/proxy-url');
      if (!isRecord(data)) return '';
      return asString(data['proxy-url'] ?? data.proxyUrl ?? data.value).trim();
    } catch {
      return '';
    }
  },

  async get(): Promise<PluginProxyResponse> {
    const data = await apiClient.cpamcGet('/plugin-proxy');
    return normalizePluginProxyResponse(data);
  },

  async update(input: {
    status: PluginProxyStatus;
    url?: string;
    accelerator?: string;
  }): Promise<void> {
    await apiClient.cpamcPut('/plugin-proxy', {
      value: {
        status: input.status,
        url: input.url ?? '',
        accelerator: input.accelerator ?? '',
      },
    });
  },

  async validate(
    url: string,
    status: PluginProxyStatus = 1
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const body =
        status === 3
          ? { status, accelerator: url }
          : { status, url };
      await apiClient.cpamcPost('/plugin-proxy/validate', body);
      return { valid: true };
    } catch (error: unknown) {
      return {
        valid: false,
        error: getPluginProxyErrorMessage(error),
      };
    }
  },
};
