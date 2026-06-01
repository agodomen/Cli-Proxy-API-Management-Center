import { apiClient } from '@/services/api/client';

export interface ResetAuthRoutingCooldownResult {
  status: string;
  authIndex: string;
  models: string[];
}

interface ResetAuthRoutingCooldownWireResult {
  status?: string;
  auth_index?: string;
  models?: unknown[];
}

export const resetAuthRoutingCooldown = async (
  authIndex: string
): Promise<ResetAuthRoutingCooldownResult> => {
  const result = await apiClient.post<ResetAuthRoutingCooldownWireResult>('/reset-quota', {
    auth_index: authIndex,
  });
  return {
    status: String(result.status ?? ''),
    authIndex: String(result.auth_index ?? authIndex),
    models: Array.isArray(result.models) ? result.models.map((model) => String(model)) : [],
  };
};
