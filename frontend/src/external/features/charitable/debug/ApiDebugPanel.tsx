import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { debugCharitableRequest, type CharitableDebugRequest, type CharitableDebugResponse } from '../api';
import { IconCheckCircle2, IconLoader2, IconRefreshCw } from '../../serviceProviders/ui/icons';
import styles from '../CharitablePage.module.scss';

type DebugMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type EndpointTemplate = {
  id: string;
  group: string;
  labelKey: string;
  method: DebugMethod;
  pathTemplate: string;
  queryDefaults?: Record<string, string>;
  bodyTemplate?: Record<string, unknown>;
  notesKey?: string;
};

const ENDPOINTS: EndpointTemplate[] = [
  {
    id: 'channels-list',
    group: 'channels',
    labelKey: 'charitable.debug.endpoints.channels_list',
    method: 'GET',
    pathTemplate: '/channels',
    queryDefaults: { page: '1', page_size: '20', search: '' },
    notesKey: 'charitable.debug.notes.list',
  },
  {
    id: 'channels-create',
    group: 'channels',
    labelKey: 'charitable.debug.endpoints.channels_create',
    method: 'POST',
    pathTemplate: '/channels',
    bodyTemplate: { channel_name: 'demo-channel', url: 'https://example.com', param: '{}' },
  },
  {
    id: 'channels-get',
    group: 'channels',
    labelKey: 'charitable.debug.endpoints.channels_get',
    method: 'GET',
    pathTemplate: '/channels/{channelId}',
  },
  {
    id: 'channels-update',
    group: 'channels',
    labelKey: 'charitable.debug.endpoints.channels_update',
    method: 'PUT',
    pathTemplate: '/channels/{channelId}',
    bodyTemplate: { channel_name: 'demo-channel-updated', url: 'https://example.com', param: '{"mode":"debug"}' },
  },
  {
    id: 'channels-delete',
    group: 'channels',
    labelKey: 'charitable.debug.endpoints.channels_delete',
    method: 'DELETE',
    pathTemplate: '/channels/{channelId}',
  },
  {
    id: 'providers-list',
    group: 'providers',
    labelKey: 'charitable.debug.endpoints.providers_list',
    method: 'GET',
    pathTemplate: '/providers',
    queryDefaults: { page: '1', page_size: '20', search: '', channel_id: '' },
    notesKey: 'charitable.debug.notes.list',
  },
  {
    id: 'providers-create',
    group: 'providers',
    labelKey: 'charitable.debug.endpoints.providers_create',
    method: 'POST',
    pathTemplate: '/providers',
    bodyTemplate: {
      provider_name: 'demo-provider',
      channel_id: 1,
      base_url: 'https://api.example.com',
      param: '{}',
    },
  },
  {
    id: 'providers-get',
    group: 'providers',
    labelKey: 'charitable.debug.endpoints.providers_get',
    method: 'GET',
    pathTemplate: '/providers/{providerId}',
  },
  {
    id: 'providers-update',
    group: 'providers',
    labelKey: 'charitable.debug.endpoints.providers_update',
    method: 'PUT',
    pathTemplate: '/providers/{providerId}',
    bodyTemplate: {
      provider_name: 'demo-provider-updated',
      channel_id: 1,
      base_url: 'https://api.example.com',
      param: '{"tier":"debug"}',
    },
  },
  {
    id: 'providers-delete',
    group: 'providers',
    labelKey: 'charitable.debug.endpoints.providers_delete',
    method: 'DELETE',
    pathTemplate: '/providers/{providerId}',
  },
  {
    id: 'keys-list',
    group: 'keys',
    labelKey: 'charitable.debug.endpoints.keys_list',
    method: 'GET',
    pathTemplate: '/keys',
    queryDefaults: { page: '1', page_size: '20', search: '', provider_id: '', status: '', api_type: '' },
    notesKey: 'charitable.debug.notes.list',
  },
  {
    id: 'keys-create',
    group: 'keys',
    labelKey: 'charitable.debug.endpoints.keys_create',
    method: 'POST',
    pathTemplate: '/keys',
    bodyTemplate: {
      api_key: 'sk-debug-demo-123456',
      api_type: 2,
      status: 1,
      priority: 0,
      provider_id: 1,
      content: 'debug content',
      remark: 'debug remark',
      param: '{}',
    },
  },
  {
    id: 'keys-get',
    group: 'keys',
    labelKey: 'charitable.debug.endpoints.keys_get',
    method: 'GET',
    pathTemplate: '/keys/{keyId}',
  },
  {
    id: 'keys-update',
    group: 'keys',
    labelKey: 'charitable.debug.endpoints.keys_update',
    method: 'PUT',
    pathTemplate: '/keys/{keyId}',
    bodyTemplate: {
      api_key: 'sk-debug-demo-123456',
      api_type: 6,
      status: 0,
      priority: 10,
      provider_id: 1,
      content: 'updated content',
      remark: 'updated remark',
      param: '{"source":"debug"}',
    },
  },
  {
    id: 'keys-delete',
    group: 'keys',
    labelKey: 'charitable.debug.endpoints.keys_delete',
    method: 'DELETE',
    pathTemplate: '/keys/{keyId}',
  },
  {
    id: 'keys-full-param',
    group: 'keys',
    labelKey: 'charitable.debug.endpoints.keys_full_param',
    method: 'GET',
    pathTemplate: '/keys/{keyId}/full_param',
    notesKey: 'charitable.debug.notes.full_param',
  },
  {
    id: 'keys-param-get',
    group: 'keys',
    labelKey: 'charitable.debug.endpoints.keys_param_get',
    method: 'GET',
    pathTemplate: '/keys/{keyId}/param',
  },
  {
    id: 'keys-param-put',
    group: 'keys',
    labelKey: 'charitable.debug.endpoints.keys_param_put',
    method: 'PUT',
    pathTemplate: '/keys/{keyId}/param',
    bodyTemplate: { env: 'debug', models: [{ name: 'gpt-4.1', alias: 'GPT-4.1' }] },
  },
  {
    id: 'keys-batch-delete',
    group: 'keys',
    labelKey: 'charitable.debug.endpoints.keys_batch_delete',
    method: 'POST',
    pathTemplate: '/keys/batch/delete',
    bodyTemplate: { ids: [1, 2] },
  },
  {
    id: 'keys-batch-disable',
    group: 'keys',
    labelKey: 'charitable.debug.endpoints.keys_batch_disable',
    method: 'POST',
    pathTemplate: '/keys/batch/disable',
    bodyTemplate: { ids: [1, 2], status: -2 },
    notesKey: 'charitable.debug.notes.batch_disable',
  },
];

const DEFAULT_PATH_PARAMS = {
  channelId: '1',
  providerId: '1',
  keyId: '1',
};

const DEFAULT_QUERY_TEXT = (queryDefaults?: Record<string, string>) =>
  JSON.stringify(queryDefaults ?? {}, null, 2);

const DEFAULT_BODY_TEXT = (bodyTemplate?: Record<string, unknown>) =>
  bodyTemplate ? JSON.stringify(bodyTemplate, null, 2) : '';

const cleanRecord = (value: Record<string, string>) => {
  const next: Record<string, string> = {};
  Object.entries(value).forEach(([key, item]) => {
    if (String(item ?? '').trim() !== '') {
      next[key] = String(item).trim();
    }
  });
  return next;
};

const tryParseObject = (raw: string): Record<string, string> => {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object');
  }
  const next: Record<string, string> = {};
  Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
    next[key] = value == null ? '' : String(value);
  });
  return next;
};

const tryParseBody = (raw: string): unknown => {
  if (!raw.trim()) return undefined;
  return JSON.parse(raw);
};

const resolvePath = (template: string, values: Record<string, string>) =>
  template.replace(/\{(channelId|providerId|keyId)\}/g, (_, key: keyof typeof DEFAULT_PATH_PARAMS) => {
    return encodeURIComponent(values[key] || DEFAULT_PATH_PARAMS[key]);
  });

const buildPreviewUrl = (base: string, path: string, query: Record<string, string>) => {
  const normalized = `${base.replace(/\/+$/, '')}/v0/cpamc/charitable${path.startsWith('/') ? path : `/${path}`}`;
  const search = new URLSearchParams(query).toString();
  return search ? `${normalized}?${search}` : normalized;
};

export function ApiDebugPanel() {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore((s) => s.serviceBase);
  const defaultManagementKey = useAuthStore((s) => s.managementKey);
  const showNotification = useNotificationStore((s) => s.showNotification);

  const [selectedEndpointId, setSelectedEndpointId] = useState(ENDPOINTS[0]?.id ?? '');
  const [pathParams, setPathParams] = useState(DEFAULT_PATH_PARAMS);
  const [queryText, setQueryText] = useState(DEFAULT_QUERY_TEXT(ENDPOINTS[0]?.queryDefaults));
  const [bodyText, setBodyText] = useState(DEFAULT_BODY_TEXT(ENDPOINTS[0]?.bodyTemplate));
  const [managementKey, setManagementKey] = useState(defaultManagementKey ?? '');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<CharitableDebugResponse | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);

  const endpoint = useMemo(
    () => ENDPOINTS.find((item) => item.id === selectedEndpointId) ?? ENDPOINTS[0],
    [selectedEndpointId]
  );

  const groupedEndpoints = useMemo(() => {
    const groups = new Map<string, EndpointTemplate[]>();
    ENDPOINTS.forEach((item) => {
      const list = groups.get(item.group) ?? [];
      list.push(item);
      groups.set(item.group, list);
    });
    return Array.from(groups.entries());
  }, []);

  const resolvedPath = useMemo(
    () => resolvePath(endpoint.pathTemplate, pathParams),
    [endpoint.pathTemplate, pathParams]
  );

  const previewUrl = useMemo(() => {
    try {
      const query = cleanRecord(tryParseObject(queryText));
      return buildPreviewUrl(baseUrl || '', resolvedPath, query);
    } catch {
      return buildPreviewUrl(baseUrl || '', resolvedPath, {});
    }
  }, [baseUrl, queryText, resolvedPath]);

  const handleTemplateChange = (id: string) => {
    const next = ENDPOINTS.find((item) => item.id === id);
    if (!next) return;
    setSelectedEndpointId(id);
    setQueryText(DEFAULT_QUERY_TEXT(next.queryDefaults));
    setBodyText(DEFAULT_BODY_TEXT(next.bodyTemplate));
    setResponse(null);
    setResponseError(null);
  };

  const resetCurrent = () => {
    setQueryText(DEFAULT_QUERY_TEXT(endpoint.queryDefaults));
    setBodyText(DEFAULT_BODY_TEXT(endpoint.bodyTemplate));
    setResponse(null);
    setResponseError(null);
  };

  const executeRequest = async () => {
    if (!baseUrl) {
      showNotification(t('charitable.debug.baseMissing'), 'error');
      return;
    }

    let query: Record<string, string> = {};
    let body: unknown = undefined;

    try {
      query = cleanRecord(tryParseObject(queryText));
    } catch (error) {
      setResponse(null);
      setResponseError(error instanceof Error ? error.message : String(error));
      showNotification(t('charitable.debug.invalidQuery'), 'error');
      return;
    }

    try {
      body = tryParseBody(bodyText);
    } catch (error) {
      setResponse(null);
      setResponseError(error instanceof Error ? error.message : String(error));
      showNotification(t('charitable.debug.invalidBody'), 'error');
      return;
    }

    const request: CharitableDebugRequest = {
      method: endpoint.method,
      path: resolvedPath,
      query,
      body,
      managementKey: managementKey.trim() || undefined,
    };

    setLoading(true);
    setResponseError(null);
    try {
      const result = await debugCharitableRequest(baseUrl, request);
      setResponse(result);
      showNotification(t('charitable.debug.requestDone', { status: result.status }), result.status >= 200 && result.status < 400 ? 'success' : 'warning');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResponse(null);
      setResponseError(message);
      showNotification(t('charitable.debug.requestFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.debugEmbed}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{t('charitable.debug.apiEntry')}</h2>
          <p className={styles.pageDesc}>{t('charitable.debug.workspaceApiDesc')}</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.btnSecondary} type="button" onClick={resetCurrent}>
            <IconRefreshCw size={16} /> {t('charitable.debug.resetCurrent')}
          </button>
          <button className={styles.btnPrimary} type="button" onClick={executeRequest} disabled={loading}>
            {loading ? <IconLoader2 size={16} /> : <IconCheckCircle2 size={16} />}
            {t('charitable.debug.execute')}
          </button>
        </div>
      </header>

      <div className={styles.debugLayout}>
        <aside className={styles.debugSidebar}>
          <div className={styles.debugSectionTitle}>{t('charitable.debug.templates')}</div>
          {groupedEndpoints.map(([group, entries]) => (
            <div key={group} className={styles.debugTemplateGroup}>
              <div className={styles.debugTemplateGroupTitle}>{t(`charitable.${group}`)}</div>
              <div className={styles.debugTemplateList}>
                {entries.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id == endpoint.id ? styles.debugTemplateBtnActive : styles.debugTemplateBtn}
                    onClick={() => handleTemplateChange(item.id)}
                  >
                    <span className={styles.debugMethod}>{item.method}</span>
                    <span className={styles.debugTemplateLabel}>{t(item.labelKey)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <section className={styles.debugMain}>
          <div className={styles.debugCard}>
            <div className={styles.debugCardHeader}>
              <div>
                <div className={styles.debugCardTitle}>{t(endpoint.labelKey)}</div>
                <div className={styles.debugCardSubline}>{endpoint.method} {endpoint.pathTemplate}</div>
              </div>
              {endpoint.notesKey ? <div className={styles.debugNote}>{t(endpoint.notesKey)}</div> : null}
            </div>

            <div className={styles.formRow}>
              <div className={styles.field}>
                <label className={styles.label}>{t('charitable.debug.baseUrl')}</label>
                <input className={styles.input} value={baseUrl} readOnly />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>{t('charitable.debug.managementKey')}</label>
                <input
                  className={styles.input}
                  value={managementKey}
                  onChange={(event) => setManagementKey(event.target.value)}
                  placeholder={t('charitable.debug.managementKeyPlaceholder')}
                />
              </div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.field}>
                <label className={styles.label}>{t('charitable.debug.channelId')}</label>
                <input
                  className={styles.input}
                  value={pathParams.channelId}
                  onChange={(event) => setPathParams((prev) => ({ ...prev, channelId: event.target.value }))}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>{t('charitable.debug.providerId')}</label>
                <input
                  className={styles.input}
                  value={pathParams.providerId}
                  onChange={(event) => setPathParams((prev) => ({ ...prev, providerId: event.target.value }))}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>{t('charitable.debug.keyId')}</label>
                <input
                  className={styles.input}
                  value={pathParams.keyId}
                  onChange={(event) => setPathParams((prev) => ({ ...prev, keyId: event.target.value }))}
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>{t('charitable.debug.previewUrl')}</label>
              <div className={styles.codeBlock}>{previewUrl}</div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.field}>
                <label className={styles.label}>{t('charitable.debug.query')}</label>
                <textarea
                  className={styles.textarea}
                  value={queryText}
                  onChange={(event) => setQueryText(event.target.value)}
                  rows={10}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>{t('charitable.debug.body')}</label>
                <textarea
                  className={styles.textarea}
                  value={bodyText}
                  onChange={(event) => setBodyText(event.target.value)}
                  rows={10}
                  disabled={endpoint.method === 'GET' || endpoint.method === 'DELETE'}
                />
              </div>
            </div>
          </div>

          <div className={styles.debugCard}>
            <div className={styles.debugCardHeader}>
              <div className={styles.debugCardTitle}>{t('charitable.debug.response')}</div>
              {response ? (
                <span className={response.status >= 200 && response.status < 400 ? styles.badge_green : styles.badge_red}>
                  HTTP {response.status}
                </span>
              ) : null}
            </div>

            {responseError ? <div className={styles.errorBox}>{responseError}</div> : null}

            <div className={styles.field}>
              <label className={styles.label}>{t('charitable.debug.responseHeaders')}</label>
              <pre className={styles.codeBlock}>{JSON.stringify(response?.headers ?? {}, null, 2)}</pre>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>{t('charitable.debug.responseBody')}</label>
              <pre className={styles.codeBlock}>{JSON.stringify(response?.data ?? null, null, 2)}</pre>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
