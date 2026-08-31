/**
 * Secondary-development extension of community versionApi.
 * Adds runtime kind detection used by the external LogsPage.
 */

import { apiClient } from '@/services/api/client';
import { isRecord } from '@/utils/helpers';
import type { ServerRuntimeKind } from '@/external/types/runtime';

export async function detectRuntimeKind(): Promise<ServerRuntimeKind> {
  try {
    const data = await apiClient.get('/nodes');
    return isRecord(data) && Array.isArray(data.nodes) ? 'home' : 'unknown';
  } catch (error: unknown) {
    const status = isRecord(error) ? error.status : undefined;
    if (status === 404 || status === 405) {
      return 'cpa';
    }
    return 'unknown';
  }
}
