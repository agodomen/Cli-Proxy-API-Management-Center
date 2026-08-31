/**
 * CPA-specific authFiles API extension.
 * Re-exports the extended authFilesApi with secondary-dev methods.
 */

import { apiClient } from '@/services/api/client';

export { authFilesApiExt as authFilesApi } from '@/external/services/api/authFilesExtension';
export {
  AUTH_FILE_INVALID_JSON_OBJECT_ERROR,
  isAuthFileInvalidJsonObjectError,
} from '@/external/services/api/authFilesExtension';

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
