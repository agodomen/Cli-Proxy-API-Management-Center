/**
 * Antigravity provider quota fetch + parse helper.
 */

import type { TFunction } from 'i18next';
import type { AntigravityQuotaGroup, AuthFileItem } from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api/apiCall';
import { authFilesApi } from '@/services/api/authFiles';
import { ANTIGRAVITY_QUOTA_URLS, ANTIGRAVITY_REQUEST_HEADERS } from '@/utils/quota/constants';
import { createStatusError, getStatusFromError } from '@/utils/quota/formatters';
import { normalizeAuthIndex, normalizeStringValue, parseAntigravityPayload } from '@/utils/quota/parsers';
import { buildAntigravityQuotaGroups } from '@/utils/quota/builders';

const DEFAULT_ANTIGRAVITY_PROJECT_ID = 'bamboo-precept-lgxtn';

const resolveAntigravityProjectId = async (file: AuthFileItem): Promise<string> => {
  try {
    const text = await authFilesApi.downloadText(file.name);
    const trimmed = text.trim();
    if (!trimmed) return DEFAULT_ANTIGRAVITY_PROJECT_ID;

    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const topLevel = normalizeStringValue(parsed.project_id ?? parsed.projectId);
    if (topLevel) return topLevel;

    const installed =
      parsed.installed && typeof parsed.installed === 'object' && parsed.installed !== null
        ? (parsed.installed as Record<string, unknown>)
        : null;
    const installedProjectId = installed
      ? normalizeStringValue(installed.project_id ?? installed.projectId)
      : null;
    if (installedProjectId) return installedProjectId;

    const web =
      parsed.web && typeof parsed.web === 'object' && parsed.web !== null
        ? (parsed.web as Record<string, unknown>)
        : null;
    const webProjectId = web ? normalizeStringValue(web.project_id ?? web.projectId) : null;
    if (webProjectId) return webProjectId;
  } catch {
    return DEFAULT_ANTIGRAVITY_PROJECT_ID;
  }

  return DEFAULT_ANTIGRAVITY_PROJECT_ID;
};

export const fetchAntigravityQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<AntigravityQuotaGroup[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('antigravity_quota.missing_auth_index'));
  }

  const projectId = await resolveAntigravityProjectId(file);
  const requestBody = JSON.stringify({ project: projectId });

  let lastError = '';
  let lastStatus: number | undefined;
  let priorityStatus: number | undefined;
  let hadSuccess = false;

  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    try {
      const result = await apiCallApi.request({
        authIndex,
        method: 'POST',
        url,
        header: { ...ANTIGRAVITY_REQUEST_HEADERS },
        data: requestBody,
      });

      if (result.statusCode < 200 || result.statusCode >= 300) {
        lastError = getApiCallErrorMessage(result);
        lastStatus = result.statusCode;
        if (result.statusCode === 403 || result.statusCode === 404) {
          priorityStatus ??= result.statusCode;
        }
        continue;
      }

      hadSuccess = true;
      const payload = parseAntigravityPayload(result.body ?? result.bodyText);

      // The community builder now expects AntigravityQuotaSummaryPayload
      // (with `groups` array). The parsed payload may wrap the data under
      // a `models` key for backwards compatibility with older API versions,
      // or it may directly contain `groups`. Handle both shapes.
      const buildInput = (() => {
        if (!payload) return null;
        // New API shape: { groups: [...] }
        if (Array.isArray(payload.groups)) return payload;
        // Legacy API shape: { models: { groups: [...] } }
        const models = payload.models;
        if (models && typeof models === 'object' && !Array.isArray(models)) {
          return models as Record<string, unknown>;
        }
        return payload;
      })();

      if (!buildInput) {
        lastError = t('antigravity_quota.empty_models');
        continue;
      }

      const groups = buildAntigravityQuotaGroups(buildInput as Parameters<typeof buildAntigravityQuotaGroups>[0]);
      if (groups.length === 0) {
        lastError = t('antigravity_quota.empty_models');
        continue;
      }

      return groups;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      if (status) {
        lastStatus = status;
        if (status === 403 || status === 404) {
          priorityStatus ??= status;
        }
      }
    }
  }

  if (hadSuccess) {
    return [];
  }

  throw createStatusError(lastError || t('common.unknown_error'), priorityStatus ?? lastStatus);
};
