import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useNotificationStore } from '@/stores';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { Sheet } from '../../serviceProviders/ui/Sheet';
import { getKey, listProviders, updateKey } from '../api';
import type { APIKey, Provider } from '../types';
import { parseAuthInfo } from '../authInfo';
import {
  getAuthFileDisplayMeta,
  isAuthFileCredential,
  pushAuthDetailToAuthFile,
  stampAuthInfoPushedAt,
} from '../authFilePush';
import { AuthInfoEditor } from './AuthInfoEditor';
import { ParamEditor } from './ParamEditor/ParamEditor';
import styles from '../CharitablePage.module.scss';

interface KeyEditorSheetProps {
  keyId: number | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (key: APIKey) => void;
}

const formatMetaTime = (value: unknown) => {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '—';
  }
};

const credentialLabel = (authType?: number, authInfoRaw?: string) => {
  const meta = getAuthFileDisplayMeta({ auth_type: authType ?? 1, auth_info: authInfoRaw || '{}' });
  if (!meta.isAuthFile) return 'API Key';
  switch (meta.credentialType) {
    case 'service_account':
      return 'Service Account';
    case 'oidc':
      return 'OIDC';
    case 'api_key_set':
      return 'API Key Set';
    case 'api_key':
      return 'API Key';
    case 'oauth2':
    default:
      return 'OAuth2';
  }
};

const toLocalDateTime = (value?: number | null) => {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export function KeyEditorSheet({ keyId, open, onClose, onSaved }: KeyEditorSheetProps) {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore((state) => state.serviceBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [key, setKey] = useState<APIKey | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [paramValid, setParamValid] = useState(true);
  const [authInfoValid, setAuthInfoValid] = useState(true);
  const [authIndex, setAuthIndex] = useState('');
  const [authValue, setAuthValue] = useState('');
  const [authInfo, setAuthInfo] = useState('{}');
  const [providerId, setProviderId] = useState<number | ''>('');
  const [status, setStatus] = useState(0);
  const [priority, setPriority] = useState(0);
  const [expiresAt, setExpiresAt] = useState('');
  const [content, setContent] = useState('');
  const [remark, setRemark] = useState('');
  const [param, setParam] = useState('{}');

  const load = useCallback(async () => {
    if (!open || !keyId || !baseUrl) return;
    setLoading(true);
    try {
      const [nextKey, providerResult] = await Promise.all([
        getKey(baseUrl, keyId, managementKey),
        listProviders(baseUrl, { page: 1, page_size: 500, status: 'all' }, managementKey),
      ]);
      setKey(nextKey);
      setProviders(providerResult.items || []);
      setAuthIndex(nextKey.auth_index);
      setAuthValue(nextKey.auth_value || nextKey.api_key || '');
      setAuthInfo(nextKey.auth_info || '{}');
      setProviderId(nextKey.provider_id ?? '');
      setStatus(nextKey.status);
      setPriority(nextKey.priority);
      setExpiresAt(toLocalDateTime(nextKey.expires_at_ms));
      setContent(nextKey.content || '');
      setRemark(nextKey.remark || '');
      setParam(nextKey.param || '{}');
      setParamValid(true);
      setAuthInfoValid(true);
    } catch {
      showNotification(t('charitable.loadFailed'), 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [baseUrl, keyId, managementKey, onClose, open, showNotification, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const buildSavePayload = () => {
    if (!key) return null;
    const info = parseAuthInfo(authInfo);
    return {
      ...key,
      auth_index: authIndex.trim(),
      auth_value: authValue.trim(),
      api_key: authValue.trim(),
      auth_info: authInfo,
      api_type: info.api_type,
      provider_id: providerId === '' ? null : providerId,
      status,
      priority,
      expires_at_ms: expiresAt ? new Date(expiresAt).getTime() : null,
      content: content.trim() || undefined,
      remark: remark.trim() || undefined,
      param,
    };
  };

  const saveCurrentKey = async () => {
    if (!baseUrl || !key) throw new Error('missing_key');
    const payload = buildSavePayload();
    if (!payload) throw new Error('missing_payload');
    return updateKey(baseUrl, key.id, payload, managementKey);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!baseUrl || !key || !authIndex.trim() || !authValue.trim() || !paramValid || !authInfoValid) {
      return;
    }
    setSaving(true);
    try {
      const saved = await saveCurrentKey();
      onSaved?.(saved);
      showNotification(t('charitable.updateSuccess'), 'success');
      onClose();
    } catch {
      showNotification(t('charitable.updateFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndPush = async () => {
    if (!baseUrl || !key || !authIndex.trim() || !authValue.trim() || !paramValid || !authInfoValid) {
      return;
    }
    setPushing(true);
    try {
      const saved = await saveCurrentKey();
      if (!isAuthFileCredential(saved)) {
        onSaved?.(saved);
        showNotification(t('charitable.key.authFilePushNotAuthFile'), 'warning');
        onClose();
        return;
      }
      const provider = providers.find((item) => item.provider_id === (saved.provider_id ?? -1));
      const result = await pushAuthDetailToAuthFile({
        key: saved,
        provider,
        onPushed: async ({
          key: pushedKey,
          fileName,
          managedHeaderKeys,
          managedFields,
          sourceModified,
        }) => {
          if (!baseUrl) return;
          const nextInfo = stampAuthInfoPushedAt(pushedKey.auth_info, fileName, {
            managedHeaderKeys,
            managedFields,
            sourceModified,
          });
          const stamped = await updateKey(
            baseUrl,
            pushedKey.id,
            { ...pushedKey, auth_info: nextInfo },
            managementKey
          );
          setKey(stamped);
          setAuthInfo(nextInfo);
          onSaved?.(stamped);
        },
      });
      showNotification(
        t('charitable.key.authFileSaveAndPushSuccess', { name: result.fileName }),
        'success'
      );
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'auth_file_name_required') {
        showNotification(t('charitable.key.authFilePushMissingName'), 'error');
      } else if (message === 'auth_value_invalid_json') {
        showNotification(t('charitable.key.authFilePushInvalidValue'), 'error');
      } else {
        showNotification(t('charitable.key.authFileSaveAndPushFailed'), 'error');
      }
    } finally {
      setPushing(false);
    }
  };

  const canSave = !loading && !saving && !pushing && paramValid && authInfoValid;
  const authFileMode = Boolean(
    key && isAuthFileCredential({ auth_type: key.auth_type, auth_info: authInfo || key.auth_info })
  );
  const currentFileName = parseAuthInfo(authInfo || key?.auth_info).file_name || '';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title={t('charitable.operations.editKey')}
      description={key?.auth_index}
      closeDisabled={saving}
      footer={
        <>
          <button type="button" className={styles.btnGhost} onClick={onClose} disabled={saving || pushing}>
            {t('charitable.cancel')}
          </button>
          {authFileMode ? (
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={!canSave || !currentFileName}
              onClick={() => void handleSaveAndPush()}
            >
              {t('charitable.key.authFileSaveAndPush')}
            </button>
          ) : null}
          <button
            type="submit"
            form="inline-key-editor"
            className={styles.btnPrimary}
            disabled={!canSave}
          >
            {t('charitable.save')}
          </button>
        </>
      }
    >
      <form id="inline-key-editor" className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.key.authIndex')} *</label>
          <input
            className={styles.input}
            value={authIndex}
            onChange={(event) => setAuthIndex(event.target.value)}
            required
          />
        </div>
        {authFileMode ? (
          <div className={styles.formRow}>
            <div className={styles.field}>
              <label className={styles.label}>{t('charitable.key.credentialKind')}</label>
              <input className={styles.input} value={credentialLabel(key?.auth_type, authInfo)} readOnly />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>{t('charitable.key.authFileName')}</label>
              <input className={`${styles.input} ${styles.mono}`} value={currentFileName || '—'} readOnly />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>{t('charitable.key.lastSyncedAtLabel')}</label>
              <input
                className={styles.input}
                value={formatMetaTime(parseAuthInfo(authInfo).last_synced_at)}
                readOnly
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>{t('charitable.key.lastPushedAtLabel')}</label>
              <input
                className={styles.input}
                value={formatMetaTime(parseAuthInfo(authInfo).last_pushed_at)}
                readOnly
              />
            </div>
          </div>
        ) : null}
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.key.authValue')} *</label>
          <textarea
            className={styles.input}
            rows={5}
            value={authValue}
            onChange={(event) => setAuthValue(event.target.value)}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.key.authInfo')}</label>
          <AuthInfoEditor
            value={authInfo}
            onChange={setAuthInfo}
            onValidityChange={setAuthInfoValid}
            authType={key?.auth_type}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.key.providerId')}</label>
          <select
            className={styles.input}
            value={providerId}
            onChange={(event) => setProviderId(event.target.value === '' ? '' : Number(event.target.value))}
          >
            <option value="">{t('charitable.key.providerNone')}</option>
            {providers.map((provider) => (
              <option key={provider.provider_id} value={provider.provider_id}>
                {provider.provider_name} · {provider.base_url}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.status')}</label>
          <select
            className={styles.input}
            value={status}
            onChange={(event) => setStatus(Number(event.target.value))}
          >
            <option value={1}>{t('charitable.statusValid')}</option>
            <option value={0}>{t('charitable.statusUnknown')}</option>
            <option value={-1}>{t('charitable.statusInvalid')}</option>
            <option value={-2}>{t('charitable.statusDisabled')}</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.key.priority')}</label>
          <input
            className={styles.input}
            type="number"
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value))}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.policy.expiryTime')}</label>
          <input
            className={styles.input}
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.key.content')}</label>
          <textarea
            className={styles.input}
            rows={3}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.key.remark')}</label>
          <input
            className={styles.input}
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.key.param')}</label>
          <ParamEditor value={param} onChange={setParam} onValidityChange={setParamValid} />
        </div>
      </form>
    </Sheet>
  );
}
