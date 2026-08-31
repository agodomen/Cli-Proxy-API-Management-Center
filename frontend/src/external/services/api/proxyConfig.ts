import { apiClient } from '@/services/api/client';
import { isRecord } from '@/utils/helpers';

export type ProxyStatus = 0 | 1 | 2 | 3;

export interface ScopedProxyConfig {
  url: string;
  accelerator: string;
  status: ProxyStatus;
}

export interface ScopedProxyResponse {
  scoped: ScopedProxyConfig;
  proxyUrl: string;
  effective: string;
  accelerator: string;
}

export interface ValidateProxyResult {
  valid: boolean;
  error?: string;
}

const asString = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return String(value);
};

const normalizeStatus = (value: unknown): ProxyStatus => {
  const raw = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (raw === 1) return 1;
  if (raw === 2) return 2;
  if (raw === 3) return 3;
  return 0;
};

const normalizeScopedConfig = (value: unknown): ScopedProxyConfig => {
  const source = isRecord(value) ? value : {};
  return {
    url: asString(source.url).trim(),
    accelerator: asString(source.accelerator).trim(),
    status: normalizeStatus(source.status),
  };
};

export const normalizeScopedProxyResponse = (
  data: unknown,
  configKey: string
): ScopedProxyResponse => {
  const source = isRecord(data) ? data : {};
  return {
    scoped: normalizeScopedConfig(source[configKey] ?? source.scoped),
    proxyUrl: asString(source['proxy-url'] ?? source.proxyUrl).trim(),
    effective: asString(source.effective).trim(),
    accelerator: asString(source.accelerator).trim(),
  };
};

export interface ProxyConfigApi {
  get(globalProxyUrl: string): Promise<ScopedProxyResponse>;
  update(input: {
    status: ProxyStatus;
    url?: string;
    accelerator?: string;
  }): Promise<void>;
  validate(
    url: string,
    status: ProxyStatus
  ): Promise<ValidateProxyResult>;
}

const createScopedProxyApi = (
  basePath: string,
  configKey: string
): ProxyConfigApi => ({
  async get() {
    const data = await apiClient.cpamcGet(basePath);
    return normalizeScopedProxyResponse(data, configKey);
  },

  async update(input) {
    await apiClient.cpamcPut(basePath, {
      value: {
        status: input.status,
        url: input.url ?? '',
        accelerator: input.accelerator ?? '',
      },
    });
  },

  async validate(url, status) {
    try {
      const body = status === 3 ? { status, accelerator: url } : { status, url };
      await apiClient.cpamcPost(`${basePath}/validate`, body);
      return { valid: true };
    } catch (error: unknown) {
      const message = isRecord(error) && typeof error.message === 'string'
        ? error.message
        : 'invalid proxy url';
      return { valid: false, error: message };
    }
  },
});

export const modelPriceProxyApi: ProxyConfigApi = createScopedProxyApi(
  '/model-price-proxy',
  'model-price-proxy'
);

export const globalProxyUrlApi = {
  async get(): Promise<string> {
    try {
      const data = await apiClient.get('/proxy-url');
      if (!isRecord(data)) return '';
      return asString(data['proxy-url'] ?? data.proxyUrl ?? data.value).trim();
    } catch {
      return '';
    }
  },

  async update(url: string): Promise<void> {
    await apiClient.put(`/proxy-url`, { value: url });
  },

  async remove(): Promise<void> {
    await apiClient.delete('/proxy-url');
  },
};
