import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/useAuthStore';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import type { HeaderPreset } from '@/external/components/ui/HeadersEditor';
import {
  commonParamsApi,
  DEFAULT_COMMON_PARAMS,
  type CommonParams,
} from '@/external/services/api/commonParams';

export type HeaderPresetsState = {
  commonParams: Required<Pick<CommonParams, 'codexUserAgent' | 'claudeUserAgent' | 'xaiUserAgent' | 'openCodeUserAgent'>>;
  presets: HeaderPreset[];
  loading: boolean;
  reload: () => Promise<void>;
};

/**
 * Shared Codex/Claude header presets for request header editors.
 * Values come from settings.common_params (via /api/common-params), with code defaults.
 */
export function useHeaderPresets(): HeaderPresetsState {
  const { t } = useTranslation();
  const managementKey = useAuthStore((state) => state.managementKey);
  const usageServiceBase = useUsageServiceStore((state) => state.serviceBase);
  const usageServiceEnabled = useUsageServiceStore((state) => state.enabled);
  const baseUrl = usageServiceEnabled && usageServiceBase ? usageServiceBase : '';

  const [commonParams, setCommonParams] = useState({
    codexUserAgent: DEFAULT_COMMON_PARAMS.codexUserAgent,
    claudeUserAgent: DEFAULT_COMMON_PARAMS.claudeUserAgent,
    xaiUserAgent: DEFAULT_COMMON_PARAMS.xaiUserAgent,
    openCodeUserAgent: DEFAULT_COMMON_PARAMS.openCodeUserAgent,
  });
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!baseUrl) {
      setCommonParams({ ...DEFAULT_COMMON_PARAMS });
      return;
    }
    setLoading(true);
    try {
      const params = await commonParamsApi.get(baseUrl, managementKey);
      setCommonParams({
        codexUserAgent: params.codexUserAgent || DEFAULT_COMMON_PARAMS.codexUserAgent,
        claudeUserAgent: params.claudeUserAgent || DEFAULT_COMMON_PARAMS.claudeUserAgent,
        xaiUserAgent: params.xaiUserAgent || DEFAULT_COMMON_PARAMS.xaiUserAgent,
        openCodeUserAgent: params.openCodeUserAgent || DEFAULT_COMMON_PARAMS.openCodeUserAgent,
      });
    } catch {
      // Keep built-in defaults when settings are unavailable.
      setCommonParams({ ...DEFAULT_COMMON_PARAMS });
    } finally {
      setLoading(false);
    }
  }, [baseUrl, managementKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const presets = useMemo<HeaderPreset[]>(
    () => [
      {
        id: 'codex',
        label: t('serviceProviders.form.codexHeaderPreset', 'Codex header'),
        userAgent: commonParams.codexUserAgent,
        title: `User-Agent: ${commonParams.codexUserAgent}`,
      },
      {
        id: 'claude',
        label: t('serviceProviders.form.claudeHeaderPreset', 'Claude header'),
        userAgent: commonParams.claudeUserAgent,
        title: `User-Agent: ${commonParams.claudeUserAgent}`,
      },
      {
        id: 'opencode',
        label: t('serviceProviders.form.openCodeHeaderPreset', 'Open Code header'),
        userAgent: commonParams.openCodeUserAgent,
        title: `User-Agent: ${commonParams.openCodeUserAgent}`,
      },
    ],
    [commonParams.claudeUserAgent, commonParams.codexUserAgent, commonParams.openCodeUserAgent, t]
  );

  return { commonParams, presets, loading, reload };
}
