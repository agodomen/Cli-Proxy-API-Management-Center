import axios from 'axios';
import { normalizeApiBase } from '@/utils/connection';
import type {
  DebugDatabase,
  QueryRequest,
  QueryResponse,
  SchemaResponse,
} from './types';

function buildCharitableBase(base: string): string {
  const normalized = normalizeApiBase(base).replace(/\/+$/, '');
  return `${normalized}/api/charitable`;
}

const authConfig = (managementKey?: string) =>
  managementKey ? { headers: { Authorization: `Bearer ${managementKey}` } } : undefined;

export async function listDebugDatabases(
  base: string,
  managementKey?: string
): Promise<DebugDatabase[]> {
  const { data } = await axios.get<{ items: DebugDatabase[] }>(
    `${buildCharitableBase(base)}/debug/databases`,
    authConfig(managementKey)
  );
  return data.items ?? [];
}

export async function getDebugSchema(
  base: string,
  databaseId: string,
  managementKey?: string
): Promise<SchemaResponse> {
  const { data } = await axios.get<SchemaResponse>(
    `${buildCharitableBase(base)}/debug/databases/${encodeURIComponent(databaseId)}/schema`,
    authConfig(managementKey)
  );
  return data;
}

export async function runDebugQuery(
  base: string,
  request: QueryRequest,
  managementKey?: string
): Promise<QueryResponse> {
  const { data } = await axios.post<QueryResponse>(
    `${buildCharitableBase(base)}/debug/query`,
    request,
    authConfig(managementKey)
  );
  return data;
}
