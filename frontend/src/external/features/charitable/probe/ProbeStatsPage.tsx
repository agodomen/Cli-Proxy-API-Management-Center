import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { GlyphPulse, MicroIcon } from '../debug/MicroIcon';
import { CharitableConfigActions } from '../components/CharitableConfigActions';
import pageStyles from '../CharitablePage.module.scss';
import styles from './ProbeStatsPage.module.scss';
import {
  getProbeStatus,
  getProbeSummary,
  listProbeActions,
  listProbeResults,
  listProbeStats,
  type ProbeActionLog,
  type ProbeKeyStat,
  type ProbeResult,
  type ProbeStatus,
  type ProbeSummary,
} from './api';

type View = 'health' | 'results' | 'actions';

const PAGE_SIZE = 20;

function formatTime(value?: number) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function formatLatency(value?: number | null) {
  return value == null ? '-' : `${value} ms`;
}

function healthTone(stat: ProbeKeyStat) {
  if (stat.last_failed || stat.success_rate < 80) return 'danger';
  if (stat.success_rate < 98) return 'warning';
  return 'success';
}

export function ProbeStatsPage({ headerCenter }: { headerCenter?: ReactNode }) {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore((state) => state.serviceBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const [view, setView] = useState<View>('health');
  const [windowSeconds, setWindowSeconds] = useState(3600);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<ProbeSummary | null>(null);
  const [status, setStatus] = useState<ProbeStatus | null>(null);
  const [stats, setStats] = useState<ProbeKeyStat[]>([]);
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [actions, setActions] = useState<ProbeActionLog[]>([]);
  const [totalItems, setTotalItems] = useState(0);

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const load = useCallback(async () => {
    if (!baseUrl) {
      setError(t('charitable.probe.serviceMissing'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [nextStatus, nextSummary] = await Promise.all([
        getProbeStatus(baseUrl, managementKey),
        getProbeSummary(baseUrl, windowSeconds, managementKey),
      ]);
      setStatus(nextStatus);
      setSummary(nextSummary);

      if (view === 'health') {
        const response = await listProbeStats(
          baseUrl,
          { page, page_size: PAGE_SIZE, search, window_seconds: windowSeconds },
          managementKey
        );
        setStats(response.items);
        setTotalItems(response.total_items);
      } else if (view === 'results') {
        const response = await listProbeResults(
          baseUrl,
          {
            page,
            page_size: PAGE_SIZE,
            search,
            since_ms: Date.now() - windowSeconds * 1000,
          },
          managementKey
        );
        setResults(response.items);
        setTotalItems(response.total_items);
      } else {
        const response = await listProbeActions(
          baseUrl,
          { page, page_size: PAGE_SIZE },
          managementKey
        );
        setActions(response.items);
        setTotalItems(response.total_items);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('charitable.probe.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, managementKey, page, search, t, view, windowSeconds]);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = useMemo(
    () => [
      { label: t('charitable.probe.totalProbes'), value: summary?.total_probes ?? 0 },
      { label: t('charitable.probe.successRate'), value: `${(summary?.success_rate ?? 0).toFixed(1)}%` },
      { label: t('charitable.probe.failureCount'), value: summary?.failure_count ?? 0 },
      { label: t('charitable.probe.uniqueAccounts'), value: summary?.unique_accounts ?? 0 },
      { label: t('charitable.probe.avgLatency'), value: formatLatency(summary?.avg_latency_ms) },
      { label: t('charitable.probe.actionsApplied'), value: summary?.actions_applied ?? 0 },
    ],
    [summary, t]
  );

  const changeView = (next: View) => {
    setView(next);
    setPage(1);
  };

  return (
    <div className={pageStyles.page}>
      <div className={pageStyles.header}>
        <div>
          <h1 className={pageStyles.title}>{t('charitable.probe.statsTitle')}</h1>
          <p className={pageStyles.pageDesc}>{t('charitable.probe.description')}</p>
        </div>
        {headerCenter}
        <div className={pageStyles.actions}>
          <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
            {t('charitable.refresh')}
          </Button>
        </div>
      </div>

      <div className={`${styles.serviceBanner} ${status?.enabled ? styles.serviceOnline : styles.serviceOffline}`}>
        <div className={styles.serviceIdentity}>
          <MicroIcon tone={status?.enabled ? 'green' : 'neutral'} active={Boolean(status?.enabled)}>
            <GlyphPulse />
          </MicroIcon>
          <div>
            <strong>{status?.enabled ? t('charitable.probe.running') : t('charitable.probe.stopped')}</strong>
            <span>
              {t('charitable.probe.queueStatus', {
                depth: status?.queue_depth ?? 0,
                dropped: status?.dropped_batches ?? 0,
              })}
            </span>
          </div>
        </div>
        <div className={styles.lastProbe}>
          <span>{t('charitable.probe.lastProbe')}</span>
          <strong>{formatTime(summary?.last_probe_at_ms)}</strong>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.summaryGrid}>
        {cards.map((card) => (
          <div className={styles.summaryCard} key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </div>
        ))}
      </div>

      <div className={styles.controlBar}>
        <div className={styles.viewTabs}>
          {(['health', 'results', 'actions'] as View[]).map((item) => (
            <button
              key={item}
              type="button"
              className={view === item ? styles.viewTabActive : styles.viewTab}
              onClick={() => changeView(item)}
            >
              {t(`charitable.probe.views.${item}`)}
            </button>
          ))}
        </div>
        <div className={styles.filters}>
          {view !== 'actions' && (
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={t('charitable.probe.search')}
            />
          )}
          <select
            value={windowSeconds}
            onChange={(event) => {
              setWindowSeconds(Number(event.target.value));
              setPage(1);
            }}
          >
            <option value={900}>{t('charitable.probe.window15m')}</option>
            <option value={3600}>{t('charitable.probe.window1h')}</option>
            <option value={21600}>{t('charitable.probe.window6h')}</option>
            <option value={86400}>{t('charitable.probe.window24h')}</option>
          </select>
        </div>
      </div>

      <div className={styles.tableWrap}>
        {view === 'health' && (
          <table>
            <thead><tr><th>{t('charitable.probe.account')}</th><th>{t('charitable.probe.provider')}</th><th>{t('charitable.probe.health')}</th><th>{t('charitable.probe.probes')}</th><th>{t('charitable.probe.latency')}</th><th>{t('charitable.probe.keyPolicy')}</th><th>{t('charitable.probe.lastProbe')}</th><th>{t('charitable.actions')}</th></tr></thead>
            <tbody>
              {stats.map((item) => (
                <tr key={`${item.auth_index}-${item.key_id ?? 'unknown'}`}>
                  <td><strong>{item.account || item.auth_label || item.auth_index || '-'}</strong><small>{item.auth_index || item.auth_file || '-'}</small></td>
                  <td>{item.provider_name || item.auth_provider || '-'}</td>
                  <td><span className={`${styles.healthBadge} ${styles[healthTone(item)]}`}>{item.last_failed ? t('charitable.probe.unhealthy') : t('charitable.probe.healthy')} · {item.success_rate.toFixed(1)}%</span>{item.last_error && <small className={styles.errorText}>{item.last_error}</small>}</td>
                  <td>{item.success_count}/{item.total_probes}<small>{t('charitable.probe.consecutive', { ok: item.consecutive_ok, fail: item.consecutive_fail })}</small></td>
                  <td>{formatLatency(item.avg_latency_ms)}</td>
                  <td>{t('charitable.probe.priorityValue', { value: item.key_priority ?? '-' })}<small>{t('charitable.probe.statusValue', { value: item.key_status ?? '-' })}</small>{item.last_action && <small>{item.last_action}</small>}</td>
                  <td>{formatTime(item.last_probe_at_ms)}</td>
                  <td><CharitableConfigActions keyId={item.key_id} providerId={item.provider_id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {view === 'results' && (
          <table>
            <thead><tr><th>{t('charitable.probe.time')}</th><th>{t('charitable.probe.account')}</th><th>{t('charitable.probe.request')}</th><th>{t('charitable.probe.result')}</th><th>{t('charitable.probe.latency')}</th><th>{t('charitable.probe.action')}</th><th>{t('charitable.actions')}</th></tr></thead>
            <tbody>
              {results.map((item) => (
                <tr key={item.id}>
                  <td>{formatTime(item.timestamp_ms)}</td>
                  <td><strong>{item.account || item.auth_label || item.auth_index || '-'}</strong><small>{item.provider_name || item.auth_provider || '-'}</small></td>
                  <td>{item.model || '-'}<small>{item.endpoint || item.request_id || '-'}</small></td>
                  <td><span className={`${styles.healthBadge} ${item.success ? styles.success : styles.danger}`}>{item.success ? t('charitable.probe.success') : t('charitable.probe.failed')} · {item.status_code || '-'}</span>{item.error_message && <small className={styles.errorText}>{item.error_message}</small>}</td>
                  <td>{formatLatency(item.latency_ms)}</td>
                  <td>{item.action_applied || '-'}</td>
                  <td><CharitableConfigActions keyId={item.key_id} providerId={item.provider_id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {view === 'actions' && (
          <table>
            <thead><tr><th>{t('charitable.probe.time')}</th><th>{t('charitable.probe.account')}</th><th>{t('charitable.probe.action')}</th><th>{t('charitable.probe.detail')}</th><th>{t('charitable.probe.result')}</th><th>{t('charitable.actions')}</th></tr></thead>
            <tbody>
              {actions.map((item) => (
                <tr key={item.id}>
                  <td>{formatTime(item.created_at_ms)}</td>
                  <td>{item.auth_index || `#${item.key_id ?? '-'}`}</td>
                  <td>{item.action}</td>
                  <td>{item.detail || '-'}</td>
                  <td><span className={`${styles.healthBadge} ${item.success ? styles.success : styles.danger}`}>{item.success ? t('charitable.probe.success') : t('charitable.probe.failed')}</span>{item.error && <small className={styles.errorText}>{item.error}</small>}</td>
                  <td><CharitableConfigActions keyId={item.key_id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && totalItems === 0 && <div className={styles.emptyState}>{t('charitable.probe.empty')}</div>}
      </div>

      <div className={styles.pagination}>
        <span>{t('charitable.totalItems', { count: totalItems })}</span>
        <div>
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t('common.previous')}</Button>
          <span>{page} / {totalPages}</span>
          <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>{t('common.next')}</Button>
        </div>
      </div>
    </div>
  );
}
