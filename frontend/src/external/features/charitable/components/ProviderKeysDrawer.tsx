import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useAuthStore, useNotificationStore } from '@/stores';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { Sheet } from '../../serviceProviders/ui/Sheet';
import { listKeys } from '../api';
import { listAllFilteredKeys, probeKeysAndPersist } from '../keyProbeService';
import type { APIKey, Provider } from '../types';
import { getStatusDescription } from '../types';
import { getAuthFileDisplayMeta } from '../authFilePush';
import { maskKey } from '../utils';
import { CharitableConfigActions } from './CharitableConfigActions';
import { KeyEditorSheet } from './KeyEditorSheet';
import { ProviderCpaSyncButton } from './ProviderCpaSyncButton';
import styles from './ProviderKeysDrawer.module.scss';

const PAGE_SIZE = 20;

interface ProviderKeysDrawerProps {
  provider: Provider | null;
  open: boolean;
  onClose: () => void;
}

export function ProviderKeysDrawer({ provider, open, onClose }: ProviderKeysDrawerProps) {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore((state) => state.serviceBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [items, setItems] = useState<APIKey[]>([]);
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState<number | null>(null);
  const [probingKeyId, setProbingKeyId] = useState<number | null>(null);
  const [probingAll, setProbingAll] = useState(false);

  const load = useCallback(async () => {
    if (!open || !provider || !baseUrl) return;
    setLoading(true);
    try {
      const result = await listKeys(
        baseUrl,
        { provider_id: provider.provider_id, page, page_size: PAGE_SIZE, status: 'all' },
        managementKey
      );
      setItems(result.items);
      setTotalItems(result.total_items);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, managementKey, open, page, provider]);

  useEffect(() => {
    if (open) setPage(1);
  }, [open, provider?.provider_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const notifyProbeResult = useCallback((result: { success: number; failed: number; skipped: number }) => {
    showNotification(t('charitable.probe.batchResult', result), result.failed > 0 ? 'warning' : 'success');
  }, [showNotification, t]);

  const handleProbeKey = useCallback(async (key: APIKey) => {
    if (!baseUrl || !provider || probingKeyId !== null || probingAll) return;
    setProbingKeyId(key.id);
    try {
      const result = await probeKeysAndPersist(baseUrl, managementKey, [key], [provider], 1);
      notifyProbeResult(result);
      await load();
    } catch {
      showNotification(t('charitable.probe.batchFailed'), 'error');
    } finally {
      setProbingKeyId(null);
    }
  }, [baseUrl, load, managementKey, notifyProbeResult, probingAll, probingKeyId, provider, showNotification, t]);

  const handleProbeAll = useCallback(async () => {
    if (!baseUrl || !provider || probingAll || probingKeyId !== null || totalItems === 0) return;
    setProbingAll(true);
    try {
      const keys = await listAllFilteredKeys(baseUrl, { provider_id: provider.provider_id, status: 'all' }, managementKey);
      const result = await probeKeysAndPersist(baseUrl, managementKey, keys, [provider]);
      notifyProbeResult(result);
      await load();
    } catch {
      showNotification(t('charitable.probe.batchFailed'), 'error');
    } finally {
      setProbingAll(false);
    }
  }, [baseUrl, load, managementKey, notifyProbeResult, probingAll, probingKeyId, provider, showNotification, t, totalItems]);

  const handleClose = () => {
    setEditingKeyId(null);
    onClose();
  };

  return (
    <>
      <Sheet
        open={open && editingKeyId === null}
        onClose={handleClose}
        title={t('charitable.provider.keysDrawerTitle', { name: provider?.provider_name ?? '-' })}
        size="xl"
      >
        <div className={styles.body}>
        <div className={styles.summary}>
          <span>{t('charitable.provider.keysDrawerSummary', { count: totalItems })}</span>
          <div className={styles.rowActions}>
            <ProviderCpaSyncButton provider={provider} />
            <Button variant="secondary" size="sm" onClick={() => void handleProbeAll()} disabled={probingAll || probingKeyId !== null || totalItems === 0} loading={probingAll}>
              {t('charitable.probe.allProviderKeys', { count: totalItems })}
            </Button>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>{t('charitable.key.apiKey')}</th><th>{t('charitable.key.credentialKind')}</th><th>{t('charitable.key.authFileName')}</th><th>{t('charitable.status')}</th><th>{t('charitable.key.priority')}</th><th>{t('charitable.key.remark')}</th><th>{t('charitable.actions')}</th></tr></thead>
            <tbody>
              {items.map((item) => {
                const statusDescription = getStatusDescription(item.status);
                const meta = getAuthFileDisplayMeta(item);
                const kindLabel = !meta.isAuthFile
                  ? 'API Key'
                  : meta.credentialType === 'service_account'
                    ? 'Service Account'
                    : meta.credentialType === 'oidc'
                      ? 'OIDC'
                      : meta.credentialType === 'api_key_set'
                        ? 'API Key Set'
                        : meta.credentialType === 'api_key'
                          ? 'API Key'
                          : 'OAuth2';
                return <tr key={item.id}>
                  <td>{maskKey(item.auth_value || item.api_key || '')}<small>{item.auth_index}</small></td>
                  <td>{kindLabel}</td>
                  <td>{meta.fileName || '-'}</td>
                  <td><span title={t(statusDescription.key, statusDescription.values)}>{item.status}</span></td>
                  <td>{item.priority}</td>
                  <td>{item.remark || item.content || '-'}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <Button variant="secondary" size="sm" onClick={() => void handleProbeKey(item)} disabled={probingAll || probingKeyId !== null} loading={probingKeyId === item.id}>{t('charitable.probe.rowProbe')}</Button>
                      <CharitableConfigActions keyId={item.id} onEditKey={setEditingKeyId} />
                    </div>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
          {!loading && items.length === 0 ? <div className={styles.empty}>{t('charitable.provider.keysEmpty')}</div> : null}
        </div>
        <div className={styles.footer}>
          <span>{page} / {totalPages}</span>
          <div>
            <Button variant="secondary" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>{t('common.previous')}</Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>{t('common.next')}</Button>
          </div>
        </div>
        </div>
      </Sheet>
      <KeyEditorSheet
        keyId={editingKeyId}
        open={open && editingKeyId !== null}
        onClose={() => setEditingKeyId(null)}
        onSaved={(saved) => {
          setItems((current) => current.map((item) => item.id === saved.id ? saved : item));
          void load();
        }}
      />
    </>
  );
}
