import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import {
  commonParamsApi,
  DEFAULT_COMMON_PARAMS,
  type CommonParams,
  type CommonParamsField,
} from '@/external/services/api/commonParams';
import styles from './CharitablePage.module.scss';

interface CommonParamsPageProps {
  headerCenter?: ReactNode;
}

export function CommonParamsPage({ headerCenter }: CommonParamsPageProps) {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore((state) => state.serviceBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CommonParams>({ ...DEFAULT_COMMON_PARAMS });
  const [refreshingField, setRefreshingField] = useState<CommonParamsField | null>(null);

  const load = useCallback(async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const params = await commonParamsApi.get(baseUrl, managementKey);
      setForm({
        codexUserAgent: params.codexUserAgent || DEFAULT_COMMON_PARAMS.codexUserAgent,
        claudeUserAgent: params.claudeUserAgent || DEFAULT_COMMON_PARAMS.claudeUserAgent,
        xaiUserAgent: params.xaiUserAgent || DEFAULT_COMMON_PARAMS.xaiUserAgent,
        openCodeUserAgent: params.openCodeUserAgent || DEFAULT_COMMON_PARAMS.openCodeUserAgent,
      });
    } catch {
      showNotification(t('charitable.commonParams.loadFailed', 'Failed to load common params'), 'error');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, managementKey, showNotification, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefreshUserAgent = async (field: CommonParamsField) => {
    if (!baseUrl) return;
    setRefreshingField(field);
    try {
      const current = String(form[field] || DEFAULT_COMMON_PARAMS[field] || '');
      const refreshed = await commonParamsApi.refreshUserAgent(baseUrl, field, current, managementKey);
      const nextValue = String(refreshed.userAgent || '').trim();
      if (!nextValue) {
        throw new Error(t('charitable.commonParams.refreshFailed', 'Failed to refresh latest version'));
      }
      setForm((prev) => ({ ...prev, [field]: nextValue }));
      showNotification(t('charitable.commonParams.refreshSuccess', 'Refreshed to latest CLI version'), 'success');
    } catch {
      showNotification(t('charitable.commonParams.refreshFailed', 'Failed to refresh latest version'), 'error');
    } finally {
      setRefreshingField(null);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!baseUrl) return;
    setSaving(true);
    try {
      const saved = await commonParamsApi.save(
        baseUrl,
        {
          codexUserAgent: (form.codexUserAgent || '').trim() || DEFAULT_COMMON_PARAMS.codexUserAgent,
          claudeUserAgent:
            (form.claudeUserAgent || '').trim() || DEFAULT_COMMON_PARAMS.claudeUserAgent,
          xaiUserAgent: (form.xaiUserAgent || '').trim() || DEFAULT_COMMON_PARAMS.xaiUserAgent,
          openCodeUserAgent: (form.openCodeUserAgent || '').trim() || DEFAULT_COMMON_PARAMS.openCodeUserAgent,
        },
        managementKey
      );
      setForm({
        codexUserAgent: saved.codexUserAgent || DEFAULT_COMMON_PARAMS.codexUserAgent,
        claudeUserAgent: saved.claudeUserAgent || DEFAULT_COMMON_PARAMS.claudeUserAgent,
        xaiUserAgent: saved.xaiUserAgent || DEFAULT_COMMON_PARAMS.xaiUserAgent,
        openCodeUserAgent: saved.openCodeUserAgent || DEFAULT_COMMON_PARAMS.openCodeUserAgent,
      });
      showNotification(t('charitable.commonParams.saveSuccess', 'Common params saved'), 'success');
    } catch {
      showNotification(t('charitable.commonParams.saveFailed', 'Failed to save common params'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('charitable.commonParams.title', 'Common Params')}</h1>
          <p className={styles.pageDesc}>
            {t(
              'charitable.commonParams.description',
              'Configure reusable header presets such as Codex / Claude User-Agent values.'
            )}
          </p>
        </div>
        {headerCenter}
        <div className={styles.actions} />
      </header>

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.commonParams.codexUserAgent', 'Codex User-Agent')}</label>
          <div className={styles.uaInputRow}>
            <input
              className={styles.input}
              value={form.codexUserAgent || ''}
              onChange={(event) => setForm((prev) => ({ ...prev, codexUserAgent: event.target.value }))}
              placeholder={DEFAULT_COMMON_PARAMS.codexUserAgent}
              disabled={loading || saving}
            />
            <button type="button" className={styles.btnGhost} onClick={() => void handleRefreshUserAgent('codexUserAgent')} disabled={loading || saving || !baseUrl || refreshingField === 'codexUserAgent'} title={t('charitable.commonParams.refreshLatest', 'Refresh to latest version')}>{refreshingField === 'codexUserAgent' ? '…' : '↻'}</button>
          </div>
          <span className={styles.fieldHint}>
            {t(
              'charitable.commonParams.codexHint',
              'Applied by the "Codex header" preset button in request header editors.'
            )}
          </span>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.commonParams.claudeUserAgent', 'Claude User-Agent')}</label>
          <div className={styles.uaInputRow}>
            <input
              className={styles.input}
              value={form.claudeUserAgent || ''}
              onChange={(event) => setForm((prev) => ({ ...prev, claudeUserAgent: event.target.value }))}
              placeholder={DEFAULT_COMMON_PARAMS.claudeUserAgent}
              disabled={loading || saving}
            />
            <button type="button" className={styles.btnGhost} onClick={() => void handleRefreshUserAgent('claudeUserAgent')} disabled={loading || saving || !baseUrl || refreshingField === 'claudeUserAgent'} title={t('charitable.commonParams.refreshLatest', 'Refresh to latest version')}>{refreshingField === 'claudeUserAgent' ? '…' : '↻'}</button>
          </div>
          <span className={styles.fieldHint}>
            {t(
              'charitable.commonParams.claudeHint',
              'Applied by the "Claude header" preset button in request header editors.'
            )}
          </span>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.commonParams.xaiUserAgent', 'xAI / Grok User-Agent')}</label>
          <div className={styles.uaInputRow}>
            <input
              className={styles.input}
              value={form.xaiUserAgent || ''}
              onChange={(event) => setForm((prev) => ({ ...prev, xaiUserAgent: event.target.value }))}
              placeholder={DEFAULT_COMMON_PARAMS.xaiUserAgent}
              disabled={loading || saving}
            />
            <button type="button" className={styles.btnGhost} onClick={() => void handleRefreshUserAgent('xaiUserAgent')} disabled={loading || saving || !baseUrl || refreshingField === 'xaiUserAgent'} title={t('charitable.commonParams.refreshLatest', 'Refresh to latest version')}>{refreshingField === 'xaiUserAgent' ? '…' : '↻'}</button>
          </div>
          <span className={styles.fieldHint}>
            {t(
              'charitable.commonParams.xaiHint',
              'Reserved for xAI / Grok request presets.'
            )}
          </span>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.commonParams.openCodeUserAgent', 'Open Code User-Agent')}</label>
          <div className={styles.uaInputRow}>
            <input
              className={styles.input}
              value={form.openCodeUserAgent || ''}
              onChange={(event) => setForm((prev) => ({ ...prev, openCodeUserAgent: event.target.value }))}
              placeholder={DEFAULT_COMMON_PARAMS.openCodeUserAgent}
              disabled={loading || saving}
            />
            <button type="button" className={styles.btnGhost} onClick={() => void handleRefreshUserAgent('openCodeUserAgent')} disabled={loading || saving || !baseUrl || refreshingField === 'openCodeUserAgent'} title={t('charitable.commonParams.refreshLatest', 'Refresh to latest version')}>{refreshingField === 'openCodeUserAgent' ? '…' : '↻'}</button>
          </div>
          <span className={styles.fieldHint}>
            {t(
              'charitable.commonParams.openCodeHint',
              'Open Code agent User-Agent preset for request headers and batch probe.'
            )}
          </span>
        </div>

        <div className={styles.formActions}>
          <button type="submit" className={styles.btnPrimary} disabled={loading || saving || !baseUrl}>
            {saving
              ? t('charitable.commonParams.saving', 'Saving...')
              : t('charitable.commonParams.save', 'Save')}
          </button>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() => void load()}
            disabled={loading || saving || !baseUrl}
          >
            {t('charitable.commonParams.reload', 'Reload')}
          </button>
        </div>
      </form>
    </div>
  );
}
