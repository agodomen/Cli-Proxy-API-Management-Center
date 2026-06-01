import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { useAuthStore, useNotificationStore } from '@/stores';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { updateKey } from '../api';
import {
  previewAuthFileRequestConfig,
  pushAuthDetailsToAuthFiles,
  stampAuthInfoPushedAt,
  type AuthFilePushMetadata,
  type AuthFilePushProgress,
  type AuthFileRequestConfigPreview,
} from '../authFilePush';
import { listAllFilteredKeys } from '../keyProbeService';
import type { APIKey, Provider } from '../types';
import { AuthFileSyncProgressModal } from './AuthFileSyncProgressModal';
import styles from '../CharitablePage.module.scss';

interface ProviderAuthFileSyncDialogProps {
  provider: Provider | null;
  open: boolean;
  onClose: () => void;
  /** When true, dialog was opened right after provider save. */
  afterSave?: boolean;
}

const formatHeaderValue = (value: string) => {
  if (!value) return '∅';
  return value.length > 48 ? `${value.slice(0, 45)}…` : value;
};

export function ProviderAuthFileSyncDialog({
  provider,
  open,
  onClose,
  afterSave = false,
}: ProviderAuthFileSyncDialogProps) {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore((state) => state.serviceBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [keys, setKeys] = useState<APIKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<AuthFilePushProgress | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || !provider || !baseUrl) return;
    let active = true;
    setKeys([]);
    setProgress(null);
    setLoading(true);
    void listAllFilteredKeys(
      baseUrl,
      { provider_id: provider.provider_id, credential_kind: 'auth_file', status: 'all' },
      managementKey
    )
      .then((items) => {
        if (active) setKeys(items);
      })
      .catch(() => {
        if (active) {
          showNotification(t('charitable.provider.authFileConfigLoadFailed'), 'error');
          onClose();
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [baseUrl, managementKey, onClose, open, provider, showNotification, t]);

  const previews = useMemo(() => {
    if (!provider) return [] as AuthFileRequestConfigPreview[];
    return keys.map((item) =>
      previewAuthFileRequestConfig({
        key: item,
        provider,
        // Live CPA file contents are applied at push time; preview uses local params.
        currentAuthJSON: null,
      })
    );
  }, [keys, provider]);

  const impactedHeaderNames = useMemo(() => {
    const names = new Set<string>();
    previews.forEach((item) => {
      item.managedHeaderKeys.forEach((name) => names.add(name));
      item.headerChanges.forEach((change) => names.add(change.name));
    });
    return Array.from(names);
  }, [previews]);

  const stampPushedAuthInfo = useCallback(
    async ({
      key,
      fileName,
      managedHeaderKeys,
      managedFields,
      sourceModified,
    }: AuthFilePushMetadata) => {
      if (!baseUrl) return;
      const nextInfo = stampAuthInfoPushedAt(key.auth_info, fileName, {
        managedHeaderKeys,
        managedFields,
        sourceModified,
      });
      await updateKey(baseUrl, key.id, { ...key, auth_info: nextInfo }, managementKey);
    },
    [baseUrl, managementKey]
  );

  const handleSync = useCallback(async () => {
    if (!provider || running || keys.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress({
      phase: 'preparing',
      total: keys.length,
      current: 0,
      currentName: '',
      success: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    });
    try {
      const result = await pushAuthDetailsToAuthFiles({
        keys,
        providers: [provider],
        signal: controller.signal,
        onProgress: (next) => setProgress({ ...next, failures: [...next.failures] }),
        onPushed: stampPushedAuthInfo,
      });
      if (result.phase === 'cancelled') {
        showNotification(t('charitable.key.authFilePushCancelled'), 'warning');
      } else if (result.failed > 0) {
        showNotification(
          t('charitable.key.authFilePushPartial', {
            success: result.success,
            failed: result.failed,
            skipped: result.skipped,
          }),
          'warning'
        );
      } else {
        showNotification(
          t('charitable.key.authFilePushSuccess', {
            success: result.success,
            skipped: result.skipped,
          }),
          'success'
        );
      }
    } catch {
      showNotification(t('charitable.key.authFilePushFailed'), 'error');
      setProgress(null);
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }, [keys, provider, running, showNotification, stampPushedAuthInfo, t]);

  const closeAll = () => {
    if (running) return;
    setProgress(null);
    onClose();
  };

  const laterLabel = afterSave
    ? t('charitable.provider.authFileConfigSyncLater')
    : t('charitable.cancel');

  return (
    <>
      <Modal
        open={open && progress == null}
        onClose={onClose}
        title={t('charitable.provider.authFileConfigSyncTitle')}
        width={720}
        footer={
          <>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={loading || keys.length === 0}
              onClick={() => void handleSync()}
            >
              {t('charitable.provider.authFileConfigSyncConfirm')}
            </button>
            <button type="button" className={styles.btnGhost} onClick={onClose}>
              {laterLabel}
            </button>
          </>
        }
      >
        {loading ? (
          <p>{t('charitable.provider.authFileConfigLoading')}</p>
        ) : (
          <>
            <p>
              {afterSave
                ? t('charitable.provider.authFileConfigSyncAfterSave', {
                    name: provider?.provider_name || '-',
                    count: keys.length,
                  })
                : t('charitable.provider.authFileConfigSyncDescription', {
                    name: provider?.provider_name || '-',
                    count: keys.length,
                  })}
            </p>
            <p className={styles.fieldHint}>
              {t('charitable.provider.authFileConfigSyncFieldHint')}
            </p>
            {keys.length === 0 ? (
              <p className={styles.deleteTargetName}>
                {t('charitable.provider.authFileConfigEmpty')}
              </p>
            ) : (
              <div className={styles.syncProgressFailures}>
                <div className={styles.syncProgressFailuresTitle}>
                  {t('charitable.provider.authFileConfigImpactTitle', { count: keys.length })}
                </div>
                {impactedHeaderNames.length > 0 ? (
                  <p className={styles.syncProgressSummary}>
                    {t('charitable.provider.authFileConfigHeaders', {
                      headers: impactedHeaderNames.join(', '),
                    })}
                  </p>
                ) : (
                  <p className={styles.syncProgressSummary}>
                    {t('charitable.provider.authFileConfigNoHeaderChanges')}
                  </p>
                )}
                <ul>
                  {previews.slice(0, 12).map((item) => (
                    <li key={item.fileName || item.accountLabel}>
                      <strong>{item.accountLabel || item.fileName || '—'}</strong>
                      <span>
                        {item.fileName}
                        {item.headerChanges.length > 0
                          ? ` · ${item.headerChanges
                              .slice(0, 4)
                              .map(
                                (change) =>
                                  `${change.name}: ${formatHeaderValue(change.from)} → ${formatHeaderValue(change.to)}`
                              )
                              .join('; ')}${item.headerChanges.length > 4 ? '…' : ''}`
                          : ` · ${t('charitable.provider.authFileConfigNoHeaderChanges')}`}
                      </span>
                    </li>
                  ))}
                </ul>
                {previews.length > 12 ? (
                  <p className={styles.fieldHint}>
                    {t('charitable.provider.authFileConfigMoreAccounts', {
                      count: previews.length - 12,
                    })}
                  </p>
                ) : null}
              </div>
            )}
          </>
        )}
      </Modal>

      <AuthFileSyncProgressModal
        open={open && progress != null}
        progress={progress}
        onCancel={() => abortRef.current?.abort()}
        onClose={closeAll}
        labels={{
          title: t('charitable.provider.authFileConfigSyncTitle'),
          phase: (phase) => {
            if (phase === 'preparing') return t('charitable.key.authFilePushPreparing');
            if (phase === 'pushing') return t('charitable.key.authFilePushRunning');
            if (phase === 'cancelled') return t('charitable.key.authFilePushCancelled');
            return t('charitable.key.authFilePushDone');
          },
          current: t('charitable.key.authFilePushCurrent'),
          summary: t('charitable.key.authFilePushSummary'),
          cancel: t('charitable.cancel'),
          close: t('charitable.close'),
          failures: t('charitable.key.authFilePushFailures'),
        }}
      />
    </>
  );
}
