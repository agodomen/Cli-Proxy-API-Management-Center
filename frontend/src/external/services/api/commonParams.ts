import axios from 'axios';
import { normalizeApiBase } from '@/utils/connection';

export interface CommonParams {
  codexUserAgent?: string;
  claudeUserAgent?: string;
  xaiUserAgent?: string;
  openCodeUserAgent?: string;
  updatedAtMs?: number;
}

export type CommonParamsField =
  | 'codexUserAgent'
  | 'claudeUserAgent'
  | 'xaiUserAgent'
  | 'openCodeUserAgent';

export const DEFAULT_COMMON_PARAMS: Required<
  Pick<CommonParams, 'codexUserAgent' | 'claudeUserAgent' | 'xaiUserAgent' | 'openCodeUserAgent'>
> = {
  codexUserAgent: 'codex-cli/0.142.2',
  claudeUserAgent: 'claude-cli/2.1.170',
  xaiUserAgent: 'grok-shell/0.2.93',
  openCodeUserAgent: 'opencode/0.15.0',
};

export interface RefreshUserAgentResponse {
  field: CommonParamsField;
  userAgent: string;
  version?: string;
  packageName?: string;
  source?: string;
}

const buildUrl = (base: string, path: string): string => {
  const normalized = normalizeApiBase(base).replace(new RegExp('/+$'), '');
  return normalized + path;
};

const authHeaders = (managementKey?: string) =>
  managementKey ? { Authorization: 'Bearer ' + managementKey } : undefined;

export const commonParamsApi = {
  get: async (base: string, managementKey?: string): Promise<CommonParams> => {
    const response = await axios.get<CommonParams>(buildUrl(base, '/api/common-params'), {
      timeout: 15_000,
      headers: authHeaders(managementKey),
    });
    return {
      ...DEFAULT_COMMON_PARAMS,
      ...response.data,
    };
  },

  save: async (
    base: string,
    params: CommonParams,
    managementKey?: string
  ): Promise<CommonParams> => {
    const response = await axios.put<CommonParams>(buildUrl(base, '/api/common-params'), params, {
      timeout: 15_000,
      headers: authHeaders(managementKey),
    });
    return {
      ...DEFAULT_COMMON_PARAMS,
      ...response.data,
    };
  },

  refreshUserAgent: async (
    base: string,
    field: CommonParamsField,
    currentUserAgent?: string,
    managementKey?: string
  ): Promise<RefreshUserAgentResponse> => {
    const response = await axios.post<RefreshUserAgentResponse>(
      buildUrl(base, '/api/common-params/refresh-user-agent'),
      {
        field,
        currentUserAgent: currentUserAgent || '',
      },
      {
        timeout: 20_000,
        headers: authHeaders(managementKey),
      }
    );
    return response.data;
  },
};
