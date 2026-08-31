/**
 * Secondary-development extension of community authFilesApi.
 * Adds JSON object download/save, text save, and single-file upload methods.
 */

import { authFilesApi } from '@/services/api/authFiles';

export const AUTH_FILE_INVALID_JSON_OBJECT_ERROR = 'AUTH_FILE_INVALID_JSON_OBJECT';

const parseAuthFileJsonObject = (rawText: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText.trim()) as unknown;
  } catch {
    throw new Error(AUTH_FILE_INVALID_JSON_OBJECT_ERROR);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(AUTH_FILE_INVALID_JSON_OBJECT_ERROR);
  }

  return { ...(parsed as Record<string, unknown>) };
};

const saveAuthFileText = async (name: string, text: string) => {
  const file = new File([text], name, { type: 'application/json' });
  await authFilesApi.uploadFiles([file]);
};

export const isAuthFileInvalidJsonObjectError = (err: unknown): boolean =>
  err instanceof Error && err.message === AUTH_FILE_INVALID_JSON_OBJECT_ERROR;

export const authFilesApiExt = {
  ...authFilesApi,
  upload: (file: File) => authFilesApi.uploadFiles([file]),
  async downloadJsonObject(name: string): Promise<Record<string, unknown>> {
    return parseAuthFileJsonObject(await authFilesApi.downloadText(name));
  },
  saveText: (name: string, text: string) => saveAuthFileText(name, text),
  saveJsonObject: (name: string, json: Record<string, unknown>) =>
    saveAuthFileText(name, JSON.stringify(json)),
};
