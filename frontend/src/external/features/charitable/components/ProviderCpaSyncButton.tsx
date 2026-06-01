import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useAuthStore, useNotificationStore } from '@/stores';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { getProvider } from '../api';
import { syncProviderToCpa } from '../cpaProviderSync';
import { listAllFilteredKeys } from '../keyProbeService';
import type { Provider } from '../types';

interface ProviderCpaSyncButtonProps {
  provider?: Provider | null;
  providerId?: number | null;
}

export function ProviderCpaSyncButton({ provider, providerId }: ProviderCpaSyncButtonProps) {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore((state) => state.serviceBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const { showNotification, showConfirmation } = useNotificationStore();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    const targetId = provider?.provider_id ?? providerId;
    if (!baseUrl || !targetId || syncing) return;
    setSyncing(true);
    try {
      const target = provider ?? await getProvider(baseUrl, targetId, managementKey);
      const keys = await listAllFilteredKeys(baseUrl, { provider_id: target.provider_id, status: 'all' }, managementKey);
      const valid = keys.filter((key) => key.auth_type === 1 && key.status > 0).length;
      setSyncing(false);
      showConfirmation({
        title: t('charitable.cpaSync.previewTitle'),
        message: t('charitable.cpaSync.preview', { name: target.provider_name, target: target.cpa_config_type || 'openai-compatibility', valid, skipped: keys.length - valid }),
        confirmText: t('charitable.cpaSync.action'), cancelText: t('charitable.cancel'),
        onConfirm: async () => {
          setSyncing(true);
          try {
            const result = await syncProviderToCpa(baseUrl, managementKey, target, keys);
            showNotification(t('charitable.cpaSync.success', { name: result.name, count: result.keyCount, action: t(result.created ? 'charitable.cpaSync.created' : 'charitable.cpaSync.updated') }), result.keyCount > 0 ? 'success' : 'warning');
          } catch { showNotification(t('charitable.cpaSync.failed'), 'error'); }
          finally { setSyncing(false); }
        },
      });
    } catch (error) {
      showNotification(
        error instanceof Error && error.message === 'provider_base_url_required'
          ? t('charitable.key.providerBaseUrlMissing')
          : t('charitable.cpaSync.failed'),
        'error'
      );
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Button variant="secondary" size="sm" loading={syncing} disabled={syncing} onClick={() => void handleSync()}>
      {t('charitable.cpaSync.action')}
    </Button>
  );
}
