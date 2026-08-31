import { apiClient } from '@/services/api/client';

export type ClusterNodeType = 'cpa' | 'cpa-home' | 'cpamc';
export type ClusterNodeRole = 'master' | 'follower';
export type ClusterNodeStatus = 'active' | 'draining' | 'offline';

export interface ClusterNode {
  id: string;
  type: ClusterNodeType;
  role: ClusterNodeRole;
  endpoint: string;
  status: ClusterNodeStatus;
  name: string;
  managementKey?: string;
  metadata?: Record<string, unknown>;
  lastSeenAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HomeConnection {
  baseUrl: string;
  managementKey?: string;
  role?: string;
}

export interface PushResult {
  nodeId: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
}

export interface ClusterOverview {
  nodes: ClusterNode[];
  home: HomeConnection;
}

export interface ConfigSnapshotItem {
  key: string;
  value: string;
  version: number;
  updatedAt: string;
}

export interface UpsertNodeRequest {
  id: string;
  type?: ClusterNodeType;
  role?: ClusterNodeRole;
  endpoint?: string;
  status?: ClusterNodeStatus;
  name?: string;
  managementKey?: string;
  metadata?: Record<string, unknown>;
}

export const clusterApi = {
  async getOverview(): Promise<ClusterOverview> {
    return apiClient.cpamcGet('/cluster');
  },

  async listNodes(): Promise<ClusterNode[]> {
    const data = await apiClient.cpamcGet<{ nodes: ClusterNode[] }>('/cluster/nodes');
    return data.nodes ?? [];
  },

  async upsertNode(node: UpsertNodeRequest): Promise<ClusterNode> {
    return apiClient.cpamcPost('/cluster/nodes', node);
  },

  async deleteNode(id: string): Promise<void> {
    await apiClient.cpamcDelete(`/cluster/nodes/${encodeURIComponent(id)}`);
  },

  async heartbeat(
    id: string,
    payload?: { status?: ClusterNodeStatus; metadata?: Record<string, unknown> },
  ): Promise<{ heartbeatInterval: string; node: ClusterNode }> {
    return apiClient.cpamcPost(`/cluster/nodes/${encodeURIComponent(id)}/heartbeat`, payload ?? {});
  },

  async pushAll(): Promise<PushResult[]> {
    const data = await apiClient.cpamcPost<{ results: PushResult[] }>('/cluster/push');
    return data.results ?? [];
  },

  async pushNode(id: string): Promise<PushResult> {
    return apiClient.cpamcPost(`/cluster/nodes/${encodeURIComponent(id)}/push`);
  },

  async getHome(): Promise<HomeConnection> {
    return apiClient.cpamcGet('/cluster/home');
  },

  async setHome(conn: HomeConnection): Promise<HomeConnection> {
    return apiClient.cpamcPut('/cluster/home', conn);
  },

  async pushHome(): Promise<PushResult> {
    return apiClient.cpamcPost('/cluster/home/push');
  },

  async getConfig(): Promise<ConfigSnapshotItem[]> {
    const data = await apiClient.cpamcGet<{ config: ConfigSnapshotItem[] }>('/cluster/config');
    return data.config ?? [];
  },

  async setConfig(key: string, value: string): Promise<void> {
    await apiClient.cpamcPut('/cluster/config', { key, value });
  },
};
