import axios from 'axios';
import { normalizeApiBase } from '@/utils/connection';

function buildMetaBase(base: string): string {
  const normalized = normalizeApiBase(base).replace(/\/+$/, '');
  return `${normalized}/v0/cpamc/meta-api`;
}

const authConfig = (managementKey?: string) =>
  managementKey ? { headers: { Authorization: `Bearer ${managementKey}` } } : undefined;

export interface MetaAPIEntry {
  id: string;
  group: string;
  method: string;
  path: string;
  side: 'frontend' | 'backend';
  source: 'secondary' | 'community';
  fileRef: string;
  description: string;
}

export interface MetaAPIStats {
  total: number;
  bySide: Record<string, number>;
  bySource: Record<string, number>;
  byGroup: Record<string, number>;
}

export interface MetaAPIListResponse {
  items: MetaAPIEntry[];
  stats: MetaAPIStats;
}

export async function listMetaAPI(
  base: string,
  managementKey?: string
): Promise<MetaAPIListResponse> {
  const { data } = await axios.get<MetaAPIListResponse>(
    `${buildMetaBase(base)}/list`,
    authConfig(managementKey)
  );
  return data;
}

export type DebugMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface MetaDebugRequest {
  method: DebugMethod;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  managementKey?: string;
}

export interface MetaDebugResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

/**
 * Sends a debug request against an absolute backend path on the management
 * server. Unlike debugCharitableRequest (which prepends the charitable base),
 * this targets any /v0/cpamc/* or /v1/* path directly.
 */
export async function debugMetaApiRequest(
  base: string,
  request: MetaDebugRequest
): Promise<MetaDebugResponse> {
  const normalized = normalizeApiBase(base).replace(/\/+$/, '');
  const path = request.path.startsWith('/') ? request.path : `/${request.path}`;
  const response = await axios.request({
    url: `${normalized}${path}`,
    method: request.method,
    params: request.query,
    data: request.body,
    validateStatus: () => true,
    ...(authConfig(request.managementKey) ?? {}),
  });

  const headers: Record<string, string> = {};
  Object.entries(response.headers ?? {}).forEach(([key, value]) => {
    headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
  });

  return {
    status: response.status,
    data: response.data,
    headers,
  };
}
