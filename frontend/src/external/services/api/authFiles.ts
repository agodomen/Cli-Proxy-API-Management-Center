/**
 * CPA-specific authFiles API extension.
 */

import { apiClient } from '@/services/api/client';

export { authFilesApi } from '@/services/api/authFiles';

export const deleteFileByName = async (name: string): Promise<{
  status: 'ok';
  deleted: number;
  files: string[];
  failed: { name: string; error?: string }[];
}> => {
  const payload = await apiClient.delete<{ deleted?: number; files?: string[]; failed?: { name: string; error?: string }[] }>(
    `/auth-files?name=${encodeURIComponent(name)}`
  );
  return {
    status: 'ok',
    deleted: payload?.deleted ?? 0,
    files: payload?.files ?? [],
    failed: payload?.failed ?? [],
  };
};

export const setStatusWithFallback = async (name: string, disabled: boolean) => {
  try {
    return await apiClient.patch<{ name: string; disabled: boolean }>('/auth-files/status', { name, disabled });
  } catch {
    const { authFilesApi } = await import('@/services/api/authFiles');
    return authFilesApi.setStatus(name, disabled);
  }
};
