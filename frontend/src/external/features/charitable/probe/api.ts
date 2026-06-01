import axios from 'axios';
import { normalizeApiBase } from '@/utils/connection';

function buildProbeBase(base: string): string {
  const normalized = normalizeApiBase(base).replace(/\/+$/, '');
  return `${normalized}/api/charitable/probe`;
}

const authConfig = (managementKey?: string) =>
  managementKey ? { headers: { Authorization: `Bearer ${managementKey}` } } : undefined;

export interface ProbeConfig {
  enabled: boolean;
  autoPriorityEnabled: boolean;
  autoStatusEnabled: boolean;
  autoCpaAccountEnabled: boolean;
  renewExpiryOnSuccess: boolean;
  renewalSeconds: number;
  windowSeconds: number;
  priorityBoost: number;
  priorityPenalty: number;
  failureThreshold: number;
  recoveryThreshold: number;
  minPriority: number;
  maxPriority: number;
  maxActionsPerBatch: number;
  updatedAtMs?: number;
}

export interface ProbeStatus {
  enabled: boolean;
  service_status: string;
  last_processed_at_ms?: number;
  total_processed: number;
  total_actions: number;
  queue_depth: number;
  dropped_batches: number;
  last_error?: string;
  config: ProbeConfig;
}

export interface ProbeSummary {
  window_seconds: number;
  total_probes: number;
  success_count: number;
  failure_count: number;
  success_rate: number;
  unique_keys: number;
  unique_accounts: number;
  avg_latency_ms?: number | null;
  last_probe_at_ms?: number;
  actions_applied: number;
  enabled: boolean;
  service_status: string;
}

export interface ProbeResult {
  id: number;
  event_hash: string;
  request_id?: string;
  timestamp_ms: number;
  auth_index?: string;
  api_key_hash?: string;
  key_id?: number | null;
  provider_id?: number | null;
  provider_name?: string;
  account?: string;
  auth_label?: string;
  auth_file?: string;
  auth_provider?: string;
  model?: string;
  endpoint?: string;
  status_code?: number;
  latency_ms?: number | null;
  failed: boolean;
  success: boolean;
  error_message?: string;
  action_applied?: string;
  action_detail?: string;
  created_at_ms: number;
}

export interface ProbeKeyStat {
  key_id?: number | null;
  auth_index?: string;
  api_key_hash?: string;
  provider_id?: number | null;
  provider_name?: string;
  account?: string;
  auth_label?: string;
  auth_file?: string;
  auth_provider?: string;
  key_status?: number | null;
  key_priority?: number | null;
  total_probes: number;
  success_count: number;
  failure_count: number;
  success_rate: number;
  avg_latency_ms?: number | null;
  last_status_code?: number;
  last_failed: boolean;
  last_error?: string;
  last_probe_at_ms?: number;
  consecutive_fail: number;
  consecutive_ok: number;
  last_action?: string;
}

export interface ProbeActionLog {
  id: number;
  created_at_ms: number;
  auth_index?: string;
  key_id?: number | null;
  action: string;
  detail?: string;
  success: boolean;
  error?: string;
}

export interface ProbePageResult<T> {
  page: number;
  page_size: number;
  total_items: number;
  items: T[];
}

export interface ProbeResultsQuery {
  page?: number;
  page_size?: number;
  search?: string;
  auth_index?: string;
  key_id?: number;
  provider_id?: number;
  success?: boolean;
  since_ms?: number;
  until_ms?: number;
}

export const DEFAULT_PROBE_CONFIG: ProbeConfig = {
  enabled: false,
  autoPriorityEnabled: true,
  autoStatusEnabled: true,
  autoCpaAccountEnabled: true,
  renewExpiryOnSuccess: false,
  renewalSeconds: 86400,
  windowSeconds: 3600,
  priorityBoost: 1,
  priorityPenalty: 2,
  failureThreshold: 3,
  recoveryThreshold: 2,
  minPriority: 0,
  maxPriority: 100,
  maxActionsPerBatch: 50,
};

export async function getProbeConfig(base: string, managementKey?: string): Promise<ProbeConfig> {
  const { data } = await axios.get<ProbeConfig>(
    `${buildProbeBase(base)}/config`,
    authConfig(managementKey)
  );
  return data;
}

export async function saveProbeConfig(
  base: string,
  config: ProbeConfig,
  managementKey?: string
): Promise<ProbeConfig> {
  const { data } = await axios.put<ProbeConfig>(
    `${buildProbeBase(base)}/config`,
    config,
    authConfig(managementKey)
  );
  return data;
}

export async function getProbeStatus(base: string, managementKey?: string): Promise<ProbeStatus> {
  const { data } = await axios.get<ProbeStatus>(
    `${buildProbeBase(base)}/status`,
    authConfig(managementKey)
  );
  return data;
}

export async function getProbeSummary(
  base: string,
  windowSeconds?: number,
  managementKey?: string
): Promise<ProbeSummary> {
  const params: Record<string, string> = {};
  if (windowSeconds && windowSeconds > 0) params.window_seconds = String(windowSeconds);
  const { data } = await axios.get<ProbeSummary>(`${buildProbeBase(base)}/summary`, {
    params,
    ...(authConfig(managementKey) ?? {}),
  });
  return data;
}

export async function listProbeResults(
  base: string,
  query: ProbeResultsQuery,
  managementKey?: string
): Promise<ProbePageResult<ProbeResult>> {
  const { data } = await axios.get<ProbePageResult<ProbeResult>>(
    `${buildProbeBase(base)}/results`,
    {
      params: query,
      ...(authConfig(managementKey) ?? {}),
    }
  );
  return data;
}

export async function listProbeStats(
  base: string,
  query: { page?: number; page_size?: number; search?: string; window_seconds?: number },
  managementKey?: string
): Promise<ProbePageResult<ProbeKeyStat>> {
  const { data } = await axios.get<ProbePageResult<ProbeKeyStat>>(
    `${buildProbeBase(base)}/stats`,
    {
      params: query,
      ...(authConfig(managementKey) ?? {}),
    }
  );
  return data;
}

export async function listProbeActions(
  base: string,
  query: { page?: number; page_size?: number },
  managementKey?: string
): Promise<ProbePageResult<ProbeActionLog>> {
  const { data } = await axios.get<ProbePageResult<ProbeActionLog>>(
    `${buildProbeBase(base)}/actions`,
    {
      params: query,
      ...(authConfig(managementKey) ?? {}),
    }
  );
  return data;
}
