import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useNotificationStore } from '@/stores';
import {
  getUsageServiceErrorCode,
  usageServiceApi,
  type CleanupSettings,
  type CleanupTableID,
  type CleanupTableInfo,
  type CleanupTablePreference,
} from '@/external/services/api/usageService';
import styles from './SystemConfigPage.module.scss';

type RetentionMode =
  | 'all'
  | 'days_366'
  | 'days_180'
  | 'days_90'
  | 'days_30'
  | 'days_17'
  | 'days_7'
  | 'days_3'
  | 'custom';

const DAY_OPTIONS: Array<{ mode: RetentionMode; days?: number }> = [
  { mode: 'all' },
  { mode: 'days_366', days: 366 },
  { mode: 'days_180', days: 180 },
  { mode: 'days_90', days: 90 },
  { mode: 'days_30', days: 30 },
  { mode: 'days_17', days: 17 },
  { mode: 'days_7', days: 7 },
  { mode: 'days_3', days: 3 },
  { mode: 'custom' },
];

const PRESET_DAYS = new Set(DAY_OPTIONS.filter((item) => item.days).map((item) => item.days as number));

const formatTimestamp = (value?: number | null) => {
  if (!value || value <= 0) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
};

const formatCount = (value: number | undefined) => {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat().format(value as number);
};

const preferenceToUi = (
  pref?: CleanupTablePreference
): { mode: RetentionMode; customDays: string } => {
  if (!pref) return { mode: 'days_30', customDays: '30' };
  const mode = String(pref.mode || '').toLowerCase();
  if (mode === 'all') return { mode: 'all', customDays: '30' };
  if (mode === 'custom' || mode === 'custom_days') {
    const days = pref.days && pref.days > 0 ? pref.days : 30;
    return { mode: 'custom', customDays: String(days) };
  }
  const days = pref.days && pref.days > 0 ? pref.days : 30;
  if (PRESET_DAYS.has(days)) {
    return { mode: `days_${days}` as RetentionMode, customDays: String(days) };
  }
  return { mode: 'custom', customDays: String(days) };
};

const uiToPreference = (
  mode: RetentionMode,
  customDays: string
): CleanupTablePreference | null => {
  if (mode === 'all') return { mode: 'all' };
  if (mode === 'custom') {
    const days = Number(customDays);
    if (!Number.isFinite(days) || days <= 0) return null;
    return { mode: 'custom', days: Math.trunc(days) };
  }
  const match = mode.match(/^days_(\d+)$/);
  if (!match) return null;
  return { mode: 'days', days: Number(match[1]) };
};

const estimateForMode = (table: CleanupTableInfo, mode: RetentionMode, customDays: number) => {
  if (mode === 'all') return table.estimatedDeletable?.all ?? table.totalRows ?? 0;
  if (mode === 'custom') {
    if (!Number.isFinite(customDays) || customDays <= 0) return 0;
    const key = `days_${Math.trunc(customDays)}`;
    if (table.estimatedDeletable?.[key] != null) return table.estimatedDeletable[key];
    return -1;
  }
  return table.estimatedDeletable?.[mode] ?? 0;
};

export function DataCleanupPanel({
  serviceBase,
  managementKey,
  disabled,
}: {
  serviceBase: string;
  managementKey?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState('');
  const [tables, setTables] = useState<CleanupTableInfo[]>([]);
  const [settings, setSettings] = useState<CleanupSettings | null>(null);
  const [modes, setModes] = useState<Record<string, RetentionMode>>({});
  const [customDays, setCustomDays] = useState<Record<string, string>>({});
  const [busyTable, setBusyTable] = useState<CleanupTableID | null>(null);

  const retentionOptions = useMemo(
    () =>
      DAY_OPTIONS.map((item) => ({
        value: item.mode,
        label:
          item.mode === 'all'
            ? t('config_management.cleanup.retention_all', 'All data')
            : item.mode === 'custom'
              ? t('config_management.cleanup.retention_custom', 'Custom days')
              : t('config_management.cleanup.retention_days', {
                  days: item.days,
                  defaultValue: '{{days}} days ago',
                }),
      })),
    [t]
  );

  const applySettingsToState = useCallback(
    (nextTables: CleanupTableInfo[], nextSettings?: CleanupSettings | null) => {
      const nextModes: Record<string, RetentionMode> = {};
      const nextCustom: Record<string, string> = {};
      nextTables.forEach((table) => {
        const ui = preferenceToUi(nextSettings?.tables?.[table.id]);
        nextModes[table.id] = ui.mode;
        nextCustom[table.id] = ui.customDays;
      });
      setModes(nextModes);
      setCustomDays(nextCustom);
      setSettings(nextSettings ?? null);
    },
    []
  );

  const loadTables = useCallback(async () => {
    if (!serviceBase) {
      setTables([]);
      setSettings(null);
      setError(t('config_management.cleanup.service_required', 'Usage Service URL is required'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await usageServiceApi.listCleanupTables(serviceBase, managementKey);
      const nextTables = response.tables ?? [];
      setTables(nextTables);
      applySettingsToState(nextTables, response.settings ?? null);
    } catch (err) {
      const code = getUsageServiceErrorCode(err);
      setError(
        code
          ? t(`usage_service_errors.${code}`, {
              defaultValue: t('config_management.cleanup.load_failed', 'Failed to load cleanup tables'),
            })
          : err instanceof Error
            ? err.message
            : t('config_management.cleanup.load_failed', 'Failed to load cleanup tables')
      );
      setTables([]);
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [applySettingsToState, managementKey, serviceBase, t]);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  const categoryLabel = useCallback(
    (category: string) => {
      if (category === 'request_logs') {
        return t('config_management.cleanup.category_request', 'Request logs');
      }
      if (category === 'probe_logs') {
        return t('config_management.cleanup.category_probe', 'Probe logs');
      }
      return category;
    },
    [t]
  );

  const tableTitle = useCallback(
    (id: CleanupTableID) =>
      t(`config_management.cleanup.tables.${id}.title`, {
        defaultValue: id,
      }),
    [t]
  );

  const tableDescription = useCallback(
    (id: CleanupTableID) =>
      t(`config_management.cleanup.tables.${id}.description`, {
        defaultValue: '',
      }),
    [t]
  );

  const resolveDays = (tableId: string, mode: RetentionMode): number | null => {
    if (mode === 'all') return null;
    if (mode === 'custom') {
      const raw = Number(customDays[tableId]);
      if (!Number.isFinite(raw) || raw <= 0) return null;
      return Math.trunc(raw);
    }
    const match = mode.match(/^days_(\d+)$/);
    return match ? Number(match[1]) : null;
  };

  const buildSettingsPayload = useCallback((): CleanupSettings | null => {
    const nextTables: Record<string, CleanupTablePreference> = {};
    for (const table of tables) {
      const mode = modes[table.id] ?? 'days_30';
      const pref = uiToPreference(mode, customDays[table.id] ?? '30');
      if (!pref) return null;
      nextTables[table.id] = pref;
    }
    return {
      tables: nextTables,
      updatedAtMs: settings?.updatedAtMs,
    };
  }, [customDays, modes, settings?.updatedAtMs, tables]);

  const handleSaveSettings = useCallback(async () => {
    if (!serviceBase) {
      showNotification(
        t('config_management.cleanup.service_required', 'Usage Service URL is required'),
        'warning'
      );
      return;
    }
    const payload = buildSettingsPayload();
    if (!payload) {
      showNotification(
        t('config_management.cleanup.custom_days_invalid', 'Enter a valid number of days'),
        'warning'
      );
      return;
    }
    setSavingSettings(true);
    try {
      const saved = await usageServiceApi.saveCleanupSettings(serviceBase, payload, managementKey);
      setSettings(saved);
      applySettingsToState(tables, saved);
      showNotification(
        t('config_management.cleanup.settings_save_success', 'Cleanup preferences saved'),
        'success'
      );
    } catch (err) {
      const code = getUsageServiceErrorCode(err);
      showNotification(
        code
          ? t(`usage_service_errors.${code}`, {
              defaultValue: t(
                'config_management.cleanup.settings_save_failed',
                'Failed to save cleanup preferences'
              ),
            })
          : err instanceof Error
            ? err.message
            : t('config_management.cleanup.settings_save_failed', 'Failed to save cleanup preferences'),
        'error'
      );
    } finally {
      setSavingSettings(false);
    }
  }, [
    applySettingsToState,
    buildSettingsPayload,
    managementKey,
    serviceBase,
    showNotification,
    t,
    tables,
  ]);

  const handlePurge = (table: CleanupTableInfo) => {
    const mode = modes[table.id] ?? 'days_30';
    const days = resolveDays(table.id, mode);
    if (mode !== 'all' && (days == null || days <= 0)) {
      showNotification(
        t('config_management.cleanup.custom_days_invalid', 'Enter a valid number of days'),
        'warning'
      );
      return;
    }

    const estimate = estimateForMode(table, mode, days ?? 0);
    const estimateLabel =
      estimate < 0
        ? t('config_management.cleanup.estimate_unknown', 'unknown')
        : formatCount(estimate);

    const retentionLabel =
      mode === 'all'
        ? t('config_management.cleanup.retention_all', 'All data')
        : t('config_management.cleanup.retention_days', {
            days: days,
            defaultValue: '{{days}} days ago',
          });

    showConfirmation({
      title: t('config_management.cleanup.confirm_title', 'Confirm data cleanup'),
      message: t('config_management.cleanup.confirm_message', {
        table: tableTitle(table.id),
        retention: retentionLabel,
        count: estimateLabel,
        defaultValue:
          'Delete data from {{table}} ({{retention}}). Estimated rows: {{count}}. This cannot be undone.',
      }),
      confirmText: t('config_management.cleanup.confirm_action', 'Delete'),
      cancelText: t('common.cancel', 'Cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setBusyTable(table.id);
        try {
          const result = await usageServiceApi.purgeCleanupTable(
            serviceBase,
            mode === 'all'
              ? { table: table.id, mode: 'all' }
              : { table: table.id, mode: mode === 'custom' ? 'custom' : 'days', days: days ?? undefined },
            managementKey
          );
          showNotification(
            t('config_management.cleanup.success', {
              deleted: formatCount(result.deleted),
              remaining: formatCount(result.remaining),
              defaultValue: 'Deleted {{deleted}} rows. Remaining: {{remaining}}.',
            }),
            'success'
          );
          await loadTables();
        } catch (err) {
          const code = getUsageServiceErrorCode(err);
          showNotification(
            code
              ? t(`usage_service_errors.${code}`, {
                  defaultValue: t('config_management.cleanup.failed', 'Cleanup failed'),
                })
              : err instanceof Error
                ? err.message
                : t('config_management.cleanup.failed', 'Cleanup failed'),
            'error'
          );
        } finally {
          setBusyTable(null);
        }
      },
    });
  };

  return (
    <div className={styles.managerConfigPanel}>
      <div className={styles.managerConfigHeader}>
        <div>
          <h2>{t('config_management.cleanup.title', 'Data Cleanup')}</h2>
          <p>
            {t(
              'config_management.cleanup.description',
              'Manually purge historical log tables from Usage Service SQLite. Business tables are not listed here.'
            )}
          </p>
        </div>
        <div className={styles.cleanupHeaderActions}>
          <Button variant="secondary" size="sm" onClick={() => void loadTables()} loading={loading}>
            {t('common.refresh', 'Refresh')}
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSaveSettings()}
            loading={savingSettings}
            disabled={disabled || loading || !serviceBase || tables.length === 0}
          >
            {t('config_management.cleanup.save_settings', 'Save preferences')}
          </Button>
        </div>
      </div>

      <div className={styles.managerQueueNote}>
        {t(
          'config_management.cleanup.scope_note',
          'Only request logs and probe logs can be cleaned. Tables such as cpa_auth_detail, cpa_channel_info, cpa_provider_info, cpa_proxy_detail, settings, api_key_aliases, and model_prices are intentionally excluded.'
        )}
      </div>
      <div className={styles.managerMetaHint}>
        {t(
          'config_management.cleanup.settings_hint',
          'Cleanup ranges are saved to settings (key: setting.data.clean) and restored the next time you open this page. Cleaning a table also updates that table preference automatically.'
        )}
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className={styles.cleanupTableWrap}>
        <table className={styles.cleanupTable}>
          <thead>
            <tr>
              <th>{t('config_management.cleanup.col_table', 'Table')}</th>
              <th>{t('config_management.cleanup.col_category', 'Category')}</th>
              <th>{t('config_management.cleanup.col_rows', 'Rows')}</th>
              <th>{t('config_management.cleanup.col_range', 'Time range')}</th>
              <th>{t('config_management.cleanup.col_retention', 'Delete before')}</th>
              <th>{t('config_management.cleanup.col_estimate', 'Estimated')}</th>
              <th>{t('config_management.cleanup.col_actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {tables.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className={styles.cleanupEmpty}>
                  {t('config_management.cleanup.empty', 'No cleanup-eligible tables found')}
                </td>
              </tr>
            ) : null}
            {tables.map((table) => {
              const mode = modes[table.id] ?? 'days_30';
              const days = resolveDays(table.id, mode) ?? 0;
              const estimate = estimateForMode(table, mode, days);
              const estimateText =
                estimate < 0
                  ? t('config_management.cleanup.estimate_unknown', 'unknown')
                  : formatCount(estimate);
              return (
                <tr key={table.id}>
                  <td>
                    <div className={styles.cleanupTableName}>{tableTitle(table.id)}</div>
                    <div className={styles.cleanupTableMeta}>{table.name}</div>
                    {tableDescription(table.id) ? (
                      <div className={styles.cleanupTableDesc}>{tableDescription(table.id)}</div>
                    ) : null}
                  </td>
                  <td>{categoryLabel(table.category)}</td>
                  <td>{formatCount(table.totalRows)}</td>
                  <td>
                    <div className={styles.cleanupTableMeta}>
                      {formatTimestamp(table.oldestTimestampMs)}
                    </div>
                    <div className={styles.cleanupTableMeta}>
                      {formatTimestamp(table.newestTimestampMs)}
                    </div>
                  </td>
                  <td>
                    <div className={styles.cleanupRetentionControls}>
                      <Select
                        value={mode}
                        options={retentionOptions}
                        onChange={(value) =>
                          setModes((prev) => ({ ...prev, [table.id]: value as RetentionMode }))
                        }
                        disabled={disabled || loading || busyTable === table.id}
                        ariaLabel={t('config_management.cleanup.col_retention', 'Delete before')}
                      />
                      {mode === 'custom' ? (
                        <Input
                          type="number"
                          min="1"
                          value={customDays[table.id] ?? ''}
                          onChange={(event) =>
                            setCustomDays((prev) => ({
                              ...prev,
                              [table.id]: event.target.value,
                            }))
                          }
                          disabled={disabled || loading || busyTable === table.id}
                          placeholder={t(
                            'config_management.cleanup.custom_days_placeholder',
                            'Days'
                          )}
                        />
                      ) : null}
                    </div>
                  </td>
                  <td>{estimateText}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handlePurge(table)}
                      loading={busyTable === table.id}
                      disabled={
                        disabled ||
                        loading ||
                        !serviceBase ||
                        busyTable === table.id ||
                        (mode !== 'all' && (days == null || days <= 0))
                      }
                    >
                      {t('config_management.cleanup.action', 'Clean')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
