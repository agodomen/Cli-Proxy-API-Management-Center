import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { Sheet } from '../../serviceProviders/ui/Sheet';
import {
  IconCheckCircle2,
  IconLoader2,
  IconRefreshCw,
  IconSearch,
} from '../../serviceProviders/ui/icons';
import {
  debugMetaApiRequest,
  listMetaAPI,
  type DebugMethod,
  type MetaAPIEntry,
  type MetaDebugResponse,
} from './metaApi';
import styles from '../CharitablePage.module.scss';

const DEFAULT_QUERY_TEXT = '{\n  "page": "1",\n  "page_size": "20"\n}';
const DEFAULT_BODY_TEXT = '{\n  \n}';

const METHOD_OPTIONS: DebugMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const METHOD_COLORS: Record<string, string> = {
  GET: '#16a34a',
  POST: '#3b82f6',
  PUT: '#f59e0b',
  DELETE: '#dc2626',
  PATCH: '#8b5cf6',
  ROUTE: '#6b7280',
};

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

function resolveMetaPath(template: string, params: Record<string, string>): string {
  return template.replace(/:(\w+)/g, (_, key: string) => {
    const value = params[key];
    return value ? encodeURIComponent(value) : `:${key}`;
  });
}

function extractPathParams(template: string): string[] {
  const matches = template.match(/:(\w+)/g) ?? [];
  return Array.from(new Set(matches.map((m) => m.slice(1))));
}

export function ApiDebugPanel() {
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
  const [menuFilter, setMenuFilter] = useState<string>('all');

  // Drawer state
  const [drawerEntry, setDrawerEntry] = useState<MetaAPIEntry | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
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

  const menus = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => set.add(e.menu));
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (sideFilter !== 'all' && e.side !== sideFilter) return false;
      if (sourceFilter !== 'all' && e.source !== sourceFilter) return false;
      if (groupFilter !== 'all' && e.group !== groupFilter) return false;
      if (menuFilter !== 'all' && e.menu !== menuFilter) return false;
      if (term) {
        const haystack = `${e.method} ${e.path} ${e.group} ${e.menu} ${e.description} ${e.fileRef}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [entries, search, sideFilter, sourceFilter, groupFilter, menuFilter]);

  const stats = useMemo(() => ({
    total: entries.length,
    backend: entries.filter((e) => e.side === 'backend').length,
    frontend: entries.filter((e) => e.side === 'frontend').length,
    secondary: entries.filter((e) => e.source === 'secondary').length,
    community: entries.filter((e) => e.source === 'community').length,
  }), [entries]);

  const pathParamNames = useMemo(
    () => (drawerEntry ? extractPathParams(drawerEntry.path) : []),
    [drawerEntry]
  );

  const resolvedPath = useMemo(
    () => (drawerEntry ? resolveMetaPath(drawerEntry.path, pathParams) : ''),
    [drawerEntry, pathParams]
  );

  const previewUrl = useMemo(() => {
    if (!drawerEntry) return '';
    const normalized = baseUrl.replace(/\/+$/, '');
    return `${normalized}${resolvedPath.startsWith('/') ? resolvedPath : `/${resolvedPath}`}`;
  }, [drawerEntry, baseUrl, resolvedPath]);

  const isBodyDisabled = method === 'GET' || method === 'DELETE';

  const openDrawer = (entry: MetaAPIEntry) => {
    setDrawerEntry(entry);
    setDrawerOpen(true);
    const methods = entry.method.split(',').map((m) => m.trim().toUpperCase());
    const first = methods.find((m) => METHOD_OPTIONS.includes(m as DebugMethod)) as DebugMethod | undefined;
    setMethod(first ?? 'GET');
    setPathParams({});
    setQueryText(DEFAULT_QUERY_TEXT);
    setBodyText(DEFAULT_BODY_TEXT);
    setResponse(null);
    setResponseError(null);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  const resetCurrent = () => {
    setQueryText(DEFAULT_QUERY_TEXT);
    setBodyText(DEFAULT_BODY_TEXT);
    setResponse(null);
    setResponseError(null);
  };

  const executeRequest = async () => {
    if (!drawerEntry) return;
    if (!baseUrl) {
      showNotification(t('charitable.debug.baseMissing'), 'error');
      return;
    }

    let query: Record<string, string>;
    try {
      query = parseQueryRecord(queryText);
    } catch (error) {
      setResponse(null);
      setResponseError(error instanceof Error ? error.message : String(error));
      showNotification(t('charitable.debug.invalidQuery'), 'error');
      return;
    }

    let body: unknown;
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

  return (
    <div className={styles.debugEmbed}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{t('charitable.debug.apiEntry')}</h2>
          <p className={styles.pageDesc}>{t('charitable.debug.workspaceApiDesc')}</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.btnSecondary} type="button" onClick={() => void loadCatalog()} disabled={loading}>
            {loading ? <IconLoader2 size={16} /> : <IconRefreshCw size={16} />}
            {t('charitable.debug.refreshCatalog')}
          </button>
        </div>
      </header>

      {/* Filter bar */}
      <div className={styles.debugCard}>
        <div className={styles.formRow}>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.debug.metaSearch')}</label>
            <div className={styles.searchRow}>
              <IconSearch size={16} />
              <input
                className={styles.input}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('charitable.debug.metaSearchPlaceholder')}
              />
            </div>
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
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.debug.metaFilterMenu')}</label>
            <select className={styles.input} value={menuFilter} onChange={(e) => setMenuFilter(e.target.value)}>
              <option value="all">{t('charitable.debug.metaFilterAll')}</option>
              {menus.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.fieldHint}>
          {t('charitable.debug.metaStats', { total: stats.total, backend: stats.backend, frontend: stats.frontend, secondary: stats.secondary, community: stats.community, shown: filtered.length })}
        </div>
      </div>

      {loadError ? <div className={styles.errorBox}>{loadError}</div> : null}

      {/* API catalog table */}
      <div className={styles.debugCard}>
        <div className={styles.debugCardHeader}>
          <div className={styles.debugCardTitle}>
            {t('charitable.debug.metaCatalog')} ({filtered.length})
          </div>
        </div>
        <div className={styles.apiCatalogTable}>
          <div className={styles.apiCatalogHeader}>
            <div className={styles.apiColMethod}>{t('charitable.debug.apiColMethod')}</div>
            <div className={styles.apiColPath}>{t('charitable.debug.apiColPath')}</div>
            <div className={styles.apiColGroup}>{t('charitable.debug.apiColGroup')}</div>
            <div className={styles.apiColMenu}>{t('charitable.debug.apiColMenu')}</div>
            <div className={styles.apiColSide}>{t('charitable.debug.apiColSide')}</div>
            <div className={styles.apiColSource}>{t('charitable.debug.apiColSource')}</div>
            <div className={styles.apiColDesc}>{t('charitable.debug.apiColDesc')}</div>
          </div>
          <div className={styles.apiCatalogBody}>
            {filtered.length === 0 ? (
              <div className={styles.apiCatalogEmpty}>
                {loading ? t('charitable.debug.metaLoading') : t('charitable.debug.metaEmpty')}
              </div>
            ) : (
              filtered.map((entry) => {
                const methods = entry.method.split(',').map((m) => m.trim());
                const primaryMethod = methods[0] ?? 'GET';
                const color = METHOD_COLORS[primaryMethod] ?? '#6b7280';
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={styles.apiCatalogRow}
                    onClick={() => openDrawer(entry)}
                    title={entry.fileRef}
                  >
                    <div className={styles.apiColMethod}>
                      <span className={styles.apiMethodBadge} style={{ color, borderColor: color }}>
                        {primaryMethod}
                      </span>
                    </div>
                    <div className={styles.apiColPath}>
                      <code className={styles.apiPathCode}>{entry.path}</code>
                    </div>
                    <div className={styles.apiColGroup}>{entry.group}</div>
                    <div className={styles.apiColMenu}>{entry.menu}</div>
                    <div className={styles.apiColSide}>
                      <span className={entry.side === 'backend' ? styles.apiSideBackend : styles.apiSideFrontend}>
                        {entry.side}
                      </span>
                    </div>
                    <div className={styles.apiColSource}>
                      <span className={entry.source === 'secondary' ? styles.apiSourceSecondary : styles.apiSourceCommunity}>
                        {entry.source}
                      </span>
                    </div>
                    <div className={styles.apiColDesc}>{entry.description}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Debug drawer */}
      <Sheet
        open={drawerOpen}
        onClose={closeDrawer}
        size="xl"
        eyebrow={
          drawerEntry ? (
            <span className={styles.apiMethodBadge} style={{ color: METHOD_COLORS[method] ?? '#6b7280', borderColor: METHOD_COLORS[method] ?? '#6b7280' }}>
              {method}
            </span>
          ) : null
        }
        title={drawerEntry?.description ?? ''}
        description={
          drawerEntry ? (
            <code className={styles.apiPathCode}>{drawerEntry.path}</code>
          ) : null
        }
        footer={
          <div className={styles.drawerFooter}>
            <button className={styles.btnSecondary} type="button" onClick={resetCurrent}>
              <IconRefreshCw size={16} /> {t('charitable.debug.resetCurrent')}
            </button>
            <button className={styles.btnPrimary} type="button" onClick={executeRequest} disabled={sending}>
              {sending ? <IconLoader2 size={16} /> : <IconCheckCircle2 size={16} />}
              {t('charitable.debug.execute')}
            </button>
          </div>
        }
      >
        {drawerEntry && (
          <div className={styles.drawerBody}>
            <div className={styles.debugCard}>
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
                    rows={6}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>{t('charitable.debug.body')}</label>
                  <textarea
                    className={styles.textarea}
                    value={bodyText}
                    onChange={(e) => setBodyText(e.target.value)}
                    rows={6}
                    disabled={isBodyDisabled}
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
          </div>
        )}
      </Sheet>
    </div>
  );
}
