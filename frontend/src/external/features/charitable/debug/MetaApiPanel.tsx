import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import {
  debugMetaApiRequest,
  listMetaAPI,
  type DebugMethod,
  type MetaAPIEntry,
  type MetaDebugResponse,
} from './metaApi';
import { IconCheckCircle2, IconLoader2, IconRefreshCw } from '../../serviceProviders/ui/icons';
import styles from '../CharitablePage.module.scss';

const DEFAULT_QUERY_TEXT = '{\n  "page": "1",\n  "page_size": "20"\n}';
const DEFAULT_BODY_TEXT = '{\n  \n}';

function parseQueryRecord(raw: string): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object');
  }
  const next: Record<string, string> = {};
  Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
    next[key] = value == null ? '' : String(value);
  });
  return next;
}

function parseBody(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed);
}

/**
 * Replaces :param placeholders in a catalog path template with values from the
 * pathParams map, so the debug request targets a concrete URL.
 */
function resolveMetaPath(template: string, params: Record<string, string>): string {
  return template.replace(/:(\w+)/g, (_, key: string) => {
    const value = params[key];
    return value ? encodeURIComponent(value) : `:${key}`;
  });
}

/** Extracts :param names from a path template for dynamic input fields. */
function extractPathParams(template: string): string[] {
  const matches = template.match(/:(\w+)/g) ?? [];
  return Array.from(new Set(matches.map((m) => m.slice(1))));
}

const METHOD_OPTIONS: DebugMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

export function MetaApiPanel() {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore((s) => s.serviceBase);
  const defaultManagementKey = useAuthStore((s) => s.managementKey) ?? '';
  const showNotification = useNotificationStore((s) => s.showNotification);

  const [entries, setEntries] = useState<MetaAPIEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [sideFilter, setSideFilter] = useState<'all' | 'frontend' | 'backend'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'secondary' | 'community'>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');

  // Selected entry for debugging
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [method, setMethod] = useState<DebugMethod>('GET');
  const [pathParams, setPathParams] = useState<Record<string, string>>({});
  const [queryText, setQueryText] = useState(DEFAULT_QUERY_TEXT);
  const [bodyText, setBodyText] = useState(DEFAULT_BODY_TEXT);
  const [managementKey, setManagementKey] = useState(defaultManagementKey);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<MetaDebugResponse | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    if (!baseUrl) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listMetaAPI(baseUrl, managementKey || undefined);
      setEntries(result.items ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLoadError(message);
      showNotification(t('charitable.debug.metaLoadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, managementKey, showNotification, t]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => set.add(e.group));
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (sideFilter !== 'all' && e.side !== sideFilter) return false;
      if (sourceFilter !== 'all' && e.source !== sourceFilter) return false;
      if (groupFilter !== 'all' && e.group !== groupFilter) return false;
      if (term) {
        const haystack = `${e.method} ${e.path} ${e.group} ${e.description} ${e.fileRef}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [entries, search, sideFilter, sourceFilter, groupFilter]);

  const selected = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? null,
    [entries, selectedId]
  );

  const pathParamNames = useMemo(
    () => (selected ? extractPathParams(selected.path) : []),
    [selected]
  );

  const resolvedPath = useMemo(
    () => (selected ? resolveMetaPath(selected.path, pathParams) : ''),
    [selected, pathParams]
  );

  const previewUrl = useMemo(() => {
    if (!selected) return '';
    const normalized = baseUrl.replace(/\/+$/, '');
    return `${normalized}${resolvedPath.startsWith('/') ? resolvedPath : `/${resolvedPath}`}`;
  }, [selected, baseUrl, resolvedPath]);

  const startDebug = (entry: MetaAPIEntry) => {
    setSelectedId(entry.id);
    const methods = entry.method.split(',').map((m) => m.trim().toUpperCase());
    const first = methods.find((m) => METHOD_OPTIONS.includes(m as DebugMethod)) as DebugMethod | undefined;
    setMethod(first ?? 'GET');
    setPathParams({});
    setQueryText(DEFAULT_QUERY_TEXT);
    setBodyText(DEFAULT_BODY_TEXT);
    setResponse(null);
    setResponseError(null);
  };

  const executeRequest = async () => {
    if (!selected) return;
    if (!baseUrl) {
      showNotification(t('charitable.debug.baseMissing'), 'error');
      return;
    }

    let query: Record<string, string> = {};
    let body: unknown = undefined;

    try {
      query = parseQueryRecord(queryText);
    } catch (error) {
      setResponse(null);
      setResponseError(error instanceof Error ? error.message : String(error));
      showNotification(t('charitable.debug.invalidQuery'), 'error');
      return;
    }

    try {
      body = parseBody(bodyText);
    } catch (error) {
      setResponse(null);
      setResponseError(error instanceof Error ? error.message : String(error));
      showNotification(t('charitable.debug.invalidBody'), 'error');
      return;
    }

    setSending(true);
    setResponseError(null);
    try {
      const result = await debugMetaApiRequest(baseUrl, {
        method,
        path: resolvedPath,
        query,
        body,
        managementKey: managementKey.trim() || undefined,
      });
      setResponse(result);
      showNotification(
        t('charitable.debug.requestDone', { status: result.status }),
        result.status >= 200 && result.status < 400 ? 'success' : 'warning'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResponse(null);
      setResponseError(message);
      showNotification(t('charitable.debug.requestFailed'), 'error');
    } finally {
      setSending(false);
    }
  };

  const resetCurrent = () => {
    setQueryText(DEFAULT_QUERY_TEXT);
    setBodyText(DEFAULT_BODY_TEXT);
    setResponse(null);
    setResponseError(null);
  };

  const stats = useMemo(() => {
    return {
      total: entries.length,
      backend: entries.filter((e) => e.side === 'backend').length,
      frontend: entries.filter((e) => e.side === 'frontend').length,
      secondary: entries.filter((e) => e.source === 'secondary').length,
      community: entries.filter((e) => e.source === 'community').length,
    };
  }, [entries]);

  const isBodyDisabled = method === 'GET' || method === 'DELETE';

  return (
    <div className={styles.debugEmbed}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{t('charitable.debug.metaEntry')}</h2>
          <p className={styles.pageDesc}>{t('charitable.debug.workspaceMetaDesc')}</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.btnSecondary} type="button" onClick={() => void loadCatalog()} disabled={loading}>
            {loading ? <IconLoader2 size={16} /> : <IconRefreshCw size={16} />}
            {t('charitable.debug.refreshCatalog')}
          </button>
        </div>
      </header>

      <div className={styles.debugCard}>
        <div className={styles.formRow}>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.debug.metaSearch')}</label>
            <input
              className={styles.input}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('charitable.debug.metaSearchPlaceholder')}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.debug.metaFilterSide')}</label>
            <select className={styles.input} value={sideFilter} onChange={(e) => setSideFilter(e.target.value as 'all' | 'frontend' | 'backend')}>
              <option value="all">{t('charitable.debug.metaFilterAll')}</option>
              <option value="backend">{t('charitable.debug.metaFilterBackend')}</option>
              <option value="frontend">{t('charitable.debug.metaFilterFrontend')}</option>
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.debug.metaFilterSource')}</label>
            <select className={styles.input} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as 'all' | 'secondary' | 'community')}>
              <option value="all">{t('charitable.debug.metaFilterAll')}</option>
              <option value="secondary">{t('charitable.debug.metaFilterSecondary')}</option>
              <option value="community">{t('charitable.debug.metaFilterCommunity')}</option>
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.debug.metaFilterGroup')}</label>
            <select className={styles.input} value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
              <option value="all">{t('charitable.debug.metaFilterAll')}</option>
              {groups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.fieldHint}>
          {t('charitable.debug.metaStats', { total: stats.total, backend: stats.backend, frontend: stats.frontend, secondary: stats.secondary, community: stats.community, shown: filtered.length })}
        </div>
      </div>

      {loadError ? <div className={styles.errorBox}>{loadError}</div> : null}

      <div className={styles.debugLayout}>
        <aside className={styles.debugSidebar}>
          <div className={styles.debugSectionTitle}>
            {t('charitable.debug.metaCatalog')} ({filtered.length})
          </div>
          <div className={styles.debugTemplateList}>
            {filtered.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === selectedId ? styles.debugTemplateBtnActive : styles.debugTemplateBtn}
                onClick={() => startDebug(entry)}
                title={entry.fileRef}
              >
                <span className={styles.debugMethod}>{entry.method}</span>
                <span className={styles.debugTemplateLabel}>
                  {entry.path}
                  <span className={styles.fieldHint}> · {entry.group}</span>
                </span>
              </button>
            ))}
            {filtered.length === 0 ? (
              <div className={styles.fieldHint}>{t('charitable.debug.metaEmpty')}</div>
            ) : null}
          </div>
        </aside>

        <section className={styles.debugMain}>
          {selected ? (
            <>
              <div className={styles.debugCard}>
                <div className={styles.debugCardHeader}>
                  <div>
                    <div className={styles.debugCardTitle}>{selected.description || selected.path}</div>
                    <div className={styles.debugCardSubline}>
                      <span className={styles.debugMethod}>{selected.method}</span> {selected.path}
                    </div>
                    <div className={styles.fieldHint}>
                      {selected.side} · {selected.source} · {selected.fileRef}
                    </div>
                  </div>
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
                      onChange={(e) => setManagementKey(e.target.value)}
                      placeholder={t('charitable.debug.managementKeyPlaceholder')}
                    />
                  </div>
                </div>

                <div className={styles.formRow}>
                  <div className={styles.field}>
                    <label className={styles.label}>{t('charitable.debug.metaMethod')}</label>
                    <select
                      className={styles.input}
                      value={method}
                      onChange={(e) => setMethod(e.target.value as DebugMethod)}
                    >
                      {METHOD_OPTIONS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  {pathParamNames.map((name) => (
                    <div key={name} className={styles.field}>
                      <label className={styles.label}>:{name}</label>
                      <input
                        className={styles.input}
                        value={pathParams[name] ?? ''}
                        onChange={(e) => setPathParams((prev) => ({ ...prev, [name]: e.target.value }))}
                      />
                    </div>
                  ))}
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
                      onChange={(e) => setQueryText(e.target.value)}
                      rows={8}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>{t('charitable.debug.body')}</label>
                    <textarea
                      className={styles.textarea}
                      value={bodyText}
                      onChange={(e) => setBodyText(e.target.value)}
                      rows={8}
                      disabled={isBodyDisabled}
                    />
                  </div>
                </div>

                <div className={styles.actions}>
                  <button className={styles.btnSecondary} type="button" onClick={resetCurrent}>
                    <IconRefreshCw size={16} /> {t('charitable.debug.resetCurrent')}
                  </button>
                  <button className={styles.btnPrimary} type="button" onClick={executeRequest} disabled={sending}>
                    {sending ? <IconLoader2 size={16} /> : <IconCheckCircle2 size={16} />}
                    {t('charitable.debug.execute')}
                  </button>
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
            </>
          ) : (
            <div className={styles.debugCard}>
              <div className={styles.fieldHint}>{t('charitable.debug.metaSelectHint')}</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
