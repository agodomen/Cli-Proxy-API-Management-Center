import { apiClient } from '@/services/api/client';
import { isRecord } from '@/utils/helpers';

export interface ProxyServiceConfig {
  listen_addr: string;
  tcp_port: number;
  udp_port: number;
  password: string;
  encryption_method: string;
  auto_register: boolean;
  enabled: boolean;
}

export interface ProxyServiceComponentStatus {
  running: boolean;
  error?: string;
}

export interface ProxyServiceStatus {
  running: boolean;
  enabled: boolean;
  listen_addr: string;
  tcp_port: number;
  udp_port: number;
  tcp: ProxyServiceComponentStatus;
  udp: ProxyServiceComponentStatus;
  started_at?: string | null;
}

export interface ProxyServiceResponse {
  config: ProxyServiceConfig;
  status: ProxyServiceStatus;
}

const asString = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return String(value);
};

const asNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asBool = (value: unknown): boolean => Boolean(value);

const normalizeConfig = (value: unknown): ProxyServiceConfig => {
  const source = isRecord(value) ? value : {};
  return {
    listen_addr: asString(source.listen_addr).trim() || '127.0.0.1',
    tcp_port: asNumber(source.tcp_port),
    udp_port: asNumber(source.udp_port),
    password: asString(source.password),
    encryption_method: asString(source.encryption_method).trim() || 'none',
    auto_register: asBool(source.auto_register),
    enabled: asBool(source.enabled),
  };
};

const normalizeComponentStatus = (value: unknown): ProxyServiceComponentStatus => {
  const source = isRecord(value) ? value : {};
  return {
    running: asBool(source.running),
    error: asString(source.error) || undefined,
  };
};

const normalizeStatus = (value: unknown): ProxyServiceStatus => {
  const source = isRecord(value) ? value : {};
  return {
    running: asBool(source.running),
    enabled: asBool(source.enabled),
    listen_addr: asString(source.listen_addr).trim() || '127.0.0.1',
    tcp_port: asNumber(source.tcp_port),
    udp_port: asNumber(source.udp_port),
    tcp: normalizeComponentStatus(source.tcp),
    udp: normalizeComponentStatus(source.udp),
    started_at: asString(source.started_at) || null,
  };
};

const normalizeResponse = (value: unknown): ProxyServiceResponse => {
  const source = isRecord(value) ? value : {};
  return {
    config: normalizeConfig(source.config),
    status: normalizeStatus(source.status),
  };
};

export const proxyServiceApi = {
  async get(): Promise<ProxyServiceResponse> {
    const data = await apiClient.cpamcGet('/charitable/proxies/service');
    return normalizeResponse(data);
  },

  async update(config: ProxyServiceConfig): Promise<ProxyServiceResponse> {
    const data = await apiClient.cpamcPut('/charitable/proxies/service', config);
    return normalizeResponse(data);
  },

  async start(): Promise<ProxyServiceResponse> {
    const data = await apiClient.cpamcPost('/charitable/proxies/service/start');
    return normalizeResponse(data);
  },

  async stop(): Promise<ProxyServiceResponse> {
    const data = await apiClient.cpamcPost('/charitable/proxies/service/stop');
    return normalizeResponse(data);
  },

  async restart(): Promise<ProxyServiceResponse> {
    const data = await apiClient.cpamcPost('/charitable/proxies/service/restart');
    return normalizeResponse(data);
  },
};
