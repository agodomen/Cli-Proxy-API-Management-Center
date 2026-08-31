import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import {
  buildClashSubscriptionURL,
  createClashSubscription,
  deleteClashSubscription,
  importProxies,
  listClashSubscriptions,
  listProxies,
  resolveClashSubscriptionURLs,
  updateClashSubscription,
} from '../api';
import type { ClashSubscription, ProxyDetail } from '../types';
import { maskKey } from '../utils';
import { copyToClipboard } from '../../serviceProviders/utils/clipboard';
import { Sheet } from '../../serviceProviders/ui/Sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../serviceProviders/ui/Table';
import {
  IconCopy,
  IconCheckCircle2,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconRefreshCw,
  IconSearch,
  IconTrash2,
} from '../../serviceProviders/ui/icons';
import sharedStyles from '../CharitablePage.module.scss';
import styles from './ClashSubscriptionsPanel.module.scss';

interface ClashSubscriptionsPanelProps {
  baseUrl: string;
  managementKey?: string;
}

const PAGE_SIZE = 20;

function fuzzyTextScore(query: string, value: unknown) {
  const needle = query.trim().toLowerCase();
  const haystack = String(value || '').toLowerCase();
  if (!needle || !haystack) return needle ? -1 : 0;
  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 800 - haystack.length;
  const includedAt = haystack.indexOf(needle);
  if (includedAt >= 0) return 600 - includedAt;
  let cursor = 0;
  let gap = 0;
  for (const char of needle) {
    const next = haystack.indexOf(char, cursor);
    if (next < 0) return -1;
    gap += next - cursor;
    cursor = next + 1;
  }
  return 300 - gap;
}

function proxyFuzzyScore(query: string, proxy: ProxyDetail) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const values = [proxy.id, proxy.proxy_index, proxy.remark, proxy.proxy_info, proxy.proxy_value];
  let total = 0;
  for (const token of tokens) {
    const score = Math.max(...values.map((value) => fuzzyTextScore(token, value)));
    if (score < 0) return -1;
    total += score;
  }
  return total;
}

function parseLines(value: string) {
  return Array.from(new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)));
}

function toInputDate(value?: string | null) {
  const date = value
    ? new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
    : new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toAPIValue(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function parseStoredDate(value?: string | null) {
  if (!value) return null;
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

export function ClashSubscriptionsPanel({ baseUrl, managementKey }: ClashSubscriptionsPanelProps) {
  const { t, i18n } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const [items, setItems] = useState<ClashSubscription[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [proxies, setProxies] = useState<ProxyDetail[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ClashSubscription | null>(null);
  const [selectedProxyIDs, setSelectedProxyIDs] = useState<Set<number>>(new Set());
  const [subscriptionType, setSubscriptionType] = useState<2 | 3>(2);
  const [effectiveAt, setEffectiveAt] = useState(toInputDate());
  const [expiresAt, setExpiresAt] = useState('');
  const [proxySearch, setProxySearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [proxyURIInput, setProxyURIInput] = useState('');
  const [proxyURLsInput, setProxyURLsInput] = useState('');
  const [resolvedURLItems, setResolvedURLItems] = useState<ProxyDetail[]>([]);
  const [importingURIs, setImportingURIs] = useState(false);
  const [resolvingURLs, setResolvingURLs] = useState(false);
  const [statusNow, setStatusNow] = useState(0);

  const fetchSubscriptions = useCallback(async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const result = await listClashSubscriptions(
        baseUrl,
        { page, page_size: PAGE_SIZE },
        managementKey,
      );
      setItems(result.items || []);
      setTotalItems(result.total_items || 0);
    } catch {
      showNotification(t('charitable.proxy.subscription.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, managementKey, page, showNotification, t]);

  const fetchProxies = useCallback(async () => {
    if (!baseUrl) return;
    const collected: ProxyDetail[] = [];
    let nextPage = 1;
    while (collected.length < 500) {
      const result = await listProxies(baseUrl, { page: nextPage, page_size: 100 }, managementKey);
      const next = result.items || [];
      collected.push(...next);
      if (next.length === 0 || collected.length >= result.total_items) break;
      nextPage += 1;
    }
    setProxies(collected);
  }, [baseUrl, managementKey]);

  useEffect(() => { void fetchSubscriptions(); }, [fetchSubscriptions]);
  useEffect(() => {
    setStatusNow(Date.now());
    const timer = window.setInterval(() => setStatusNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    void fetchProxies().catch(() => showNotification(t('charitable.loadFailed'), 'error'));
  }, [fetchProxies, showNotification, t]);

  const openCreate = () => {
    setEditing(null);
    setSubscriptionType(2);
    setSelectedProxyIDs(new Set());
    setEffectiveAt(toInputDate());
    setExpiresAt('');
    setProxySearch('');
    setProxyURIInput('');
    setProxyURLsInput('');
    setResolvedURLItems([]);
    setSheetOpen(true);
  };

  const openEdit = (item: ClashSubscription) => {
    setEditing(item);
    setSubscriptionType(item.subscription_type || 2);
    setSelectedProxyIDs(new Set(item.proxy_ids));
    setEffectiveAt(toInputDate(item.effective_at));
    setExpiresAt(item.expires_at ? toInputDate(item.expires_at) : '');
    setProxySearch('');
    setProxyURIInput('');
    setProxyURLsInput((item.proxy_urls || []).join('\n'));
    setResolvedURLItems([]);
    setSheetOpen(true);
  };

  const visibleProxies = useMemo(() => {
    const query = proxySearch.trim().toLowerCase();
    if (!query) return proxies;
    return proxies
      .map((proxy, index) => ({ proxy, index, score: proxyFuzzyScore(query, proxy) }))
      .filter((item) => item.score >= 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((item) => item.proxy);
  }, [proxies, proxySearch]);

  const importProxyURIs = async () => {
    if (!proxyURIInput.trim() || importingURIs) return;
    setImportingURIs(true);
    try {
      const result = await importProxies(baseUrl, proxyURIInput, 'public', managementKey);
      setSelectedProxyIDs((current) => new Set([...current, ...(result.items || []).map((item) => item.id)]));
      await fetchProxies();
      setProxyURIInput('');
      showNotification(t('charitable.proxy.subscription.uriImportSummary', {
        selected: result.items?.length || 0,
        created: result.created,
        existing: result.skipped,
      }), result.failed > 0 ? 'warning' : 'success');
    } catch {
      showNotification(t('charitable.proxy.subscription.uriImportFailed'), 'error');
    } finally {
      setImportingURIs(false);
    }
  };

  const resolveProxyURLs = async () => {
    const urls = parseLines(proxyURLsInput);
    if (urls.length === 0 || resolvingURLs) return;
    setResolvingURLs(true);
    try {
      const result = await resolveClashSubscriptionURLs(baseUrl, urls, managementKey);
      setProxyURLsInput(result.urls.join('\n'));
      setResolvedURLItems(result.items || []);
      await fetchProxies();
      showNotification(t('charitable.proxy.subscription.urlResolveSummary', {
        urls: result.urls.length,
        nodes: result.items.length,
        created: result.created,
        existing: result.skipped,
      }), result.failed > 0 ? 'warning' : 'success');
    } catch {
      showNotification(t('charitable.proxy.subscription.urlResolveFailed'), 'error');
    } finally {
      setResolvingURLs(false);
    }
  };

  const toggleProxy = (id: number) => {
    setSelectedProxyIDs((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const proxyURLs = parseLines(proxyURLsInput);
    if (!effectiveAt || submitting) return;
    if (subscriptionType === 2 && selectedProxyIDs.size === 0) return;
    if (subscriptionType === 3 && proxyURLs.length === 0) return;
    setSubmitting(true);
    try {
      const input = {
        subscription_type: subscriptionType,
        proxy_ids: subscriptionType === 2 ? Array.from(selectedProxyIDs) : [],
        proxy_urls: subscriptionType === 3 ? proxyURLs : [],
        effective_at: toAPIValue(effectiveAt) || new Date().toISOString(),
        expires_at: toAPIValue(expiresAt),
      };
      if (editing) {
        await updateClashSubscription(baseUrl, editing.id, input, managementKey);
        showNotification(t('charitable.proxy.subscription.updateSuccess'), 'success');
      } else {
        await createClashSubscription(baseUrl, input, managementKey);
        showNotification(t('charitable.proxy.subscription.createSuccess'), 'success');
      }
      setSheetOpen(false);
      await fetchSubscriptions();
    } catch {
      showNotification(
        t(editing ? 'charitable.proxy.subscription.updateFailed' : 'charitable.proxy.subscription.createFailed'),
        'error',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const copyURL = async (item: ClashSubscription) => {
    const copied = await copyToClipboard(buildClashSubscriptionURL(baseUrl, item.token));
    showNotification(
      t(copied ? 'charitable.proxy.subscription.copySuccess' : 'charitable.proxy.subscription.copyFailed'),
      copied ? 'success' : 'error',
    );
  };

  const confirmDelete = (item: ClashSubscription) => {
    showConfirmation({
      title: t('charitable.proxy.subscription.deleteTitle'),
      message: t('charitable.proxy.subscription.deleteConfirm'),
      confirmText: t('charitable.confirm'),
      cancelText: t('charitable.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await deleteClashSubscription(baseUrl, item.id, managementKey);
          showNotification(t('charitable.deleteSuccess'), 'success');
          await fetchSubscriptions();
        } catch {
          showNotification(t('charitable.deleteFailed'), 'error');
        }
      },
    });
  };

  const formatDate = (value?: string | null) => {
    const date = parseStoredDate(value);
    return date ? date.toLocaleString(i18n.language) : t('charitable.proxy.subscription.never');
  };

  const statusFor = (item: ClashSubscription) => {
    const start = parseStoredDate(item.effective_at)?.getTime() ?? 0;
    const end = parseStoredDate(item.expires_at)?.getTime();
    if (statusNow < start) return { label: t('charitable.proxy.subscription.pending'), className: sharedStyles.badge_orange };
    if (end && statusNow >= end) return { label: t('charitable.proxy.subscription.expired'), className: sharedStyles.badge_red };
    return { label: t('charitable.proxy.subscription.active'), className: sharedStyles.badge_green };
  };

  const totalPages = Math.ceil(totalItems / PAGE_SIZE);

  return (
    <div className={styles.panel}>
      <div className={styles.panelActions}>
        <button className={sharedStyles.btnSecondary} onClick={() => void fetchSubscriptions()} disabled={loading}>
          <IconRefreshCw size={16} /> {t('charitable.refresh')}
        </button>
        <button className={sharedStyles.btnPrimary} onClick={openCreate}>
          <IconPlus size={16} /> {t('charitable.proxy.subscription.create')}
        </button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>{t('charitable.proxy.subscription.link')}</TableHead>
            <TableHead>{t('charitable.proxy.subscription.type')}</TableHead>
            <TableHead>{t('charitable.proxy.subscription.nodes')}</TableHead>
            <TableHead>{t('charitable.proxy.subscription.status')}</TableHead>
            <TableHead>{t('charitable.proxy.subscription.effectiveAt')}</TableHead>
            <TableHead>{t('charitable.proxy.subscription.expiresAt')}</TableHead>
            <TableHead>{t('charitable.proxy.subscription.accessCount')}</TableHead>
            <TableHead>{t('charitable.proxy.subscription.updatedAt')}</TableHead>
            <TableHead alignRight>{t('charitable.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && !loading ? (
            <TableRow>
              <TableCell colSpan={10} className={sharedStyles.emptyCell}>
                {t('charitable.proxy.subscription.empty')}
              </TableCell>
            </TableRow>
          ) : items.map((item) => {
            const status = statusFor(item);
            return (
              <TableRow key={item.id}>
                <TableCell className={sharedStyles.mono}>{item.id}</TableCell>
                <TableCell>
                  <button className={styles.linkButton} onClick={() => void copyURL(item)} title={t('charitable.proxy.subscription.copy')}>
                    <span className={sharedStyles.mono}>{maskKey(item.token)}</span>
                    <IconCopy size={14} />
                  </button>
                </TableCell>
                <TableCell>
                  <span className={item.subscription_type === 3 ? sharedStyles.badge_orange : sharedStyles.badge_green}>
                    {t(`charitable.proxy.subscription.types.${item.subscription_type === 3 ? 'composite' : 'nodes'}`)}
                  </span>
                </TableCell>
                <TableCell>
                  {item.subscription_type === 3
                    ? t('charitable.proxy.subscription.urlCount', { count: item.proxy_urls?.length || 0 })
                    : item.proxy_ids.length}
                </TableCell>
                <TableCell><span className={status.className}>{status.label}</span></TableCell>
                <TableCell>{formatDate(item.effective_at)}</TableCell>
                <TableCell>{formatDate(item.expires_at)}</TableCell>
                <TableCell>{item.access_count}</TableCell>
                <TableCell>{formatDate(item.update_at)}</TableCell>
                <TableCell alignRight>
                  <button className={sharedStyles.iconBtn} onClick={() => void copyURL(item)} title={t('charitable.proxy.subscription.copy')}>
                    <IconCopy size={16} />
                  </button>
                  <button className={sharedStyles.iconBtn} onClick={() => openEdit(item)} title={t('charitable.edit')}>
                    <IconPencil size={16} />
                  </button>
                  <button className={sharedStyles.iconBtnDanger} onClick={() => confirmDelete(item)} title={t('charitable.delete')}>
                    <IconTrash2 size={16} />
                  </button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className={sharedStyles.pagination}>
          <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Prev</button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
        </div>
      )}

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t(editing ? 'charitable.proxy.subscription.edit' : 'charitable.proxy.subscription.create')}
        description={t('charitable.proxy.subscription.formDescription')}
        size="lg"
        footer={(
          <>
            <button
              type="submit"
              form="clash-subscription-form"
              className={sharedStyles.btnPrimary}
              disabled={
                submitting
                || !effectiveAt
                || (subscriptionType === 2 && selectedProxyIDs.size === 0)
                || (subscriptionType === 3 && parseLines(proxyURLsInput).length === 0)
              }
            >
              {t('charitable.save')}
            </button>
            <button type="button" className={sharedStyles.btnGhost} onClick={() => setSheetOpen(false)}>
              {t('charitable.cancel')}
            </button>
          </>
        )}
      >
        <form id="clash-subscription-form" className={sharedStyles.form} onSubmit={submit}>
          <div className={sharedStyles.field}>
            <label className={sharedStyles.label}>{t('charitable.proxy.subscription.type')}</label>
            <div className={styles.typeSelector} role="radiogroup">
              {([2, 3] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={subscriptionType === value}
                  className={`${styles.typeOption} ${subscriptionType === value ? styles.typeOptionActive : ''}`}
                  onClick={() => setSubscriptionType(value)}
                >
                  <strong>{t(`charitable.proxy.subscription.types.${value === 2 ? 'nodes' : 'composite'}`)}</strong>
                  <span>{t(`charitable.proxy.subscription.typeHints.${value === 2 ? 'nodes' : 'composite'}`)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.timeGrid}>
            <div className={sharedStyles.field}>
              <label className={sharedStyles.label}>{t('charitable.proxy.subscription.effectiveAt')}</label>
              <input className={sharedStyles.input} type="datetime-local" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required />
            </div>
            <div className={sharedStyles.field}>
              <label className={sharedStyles.label}>{t('charitable.proxy.subscription.expiresAt')}</label>
              <input className={sharedStyles.input} type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} min={effectiveAt} />
              <span className={sharedStyles.fieldHint}>{t('charitable.proxy.subscription.noExpiryHint')}</span>
            </div>
          </div>

          {subscriptionType === 2 ? (
            <>
              <div className={styles.importBlock}>
                <label className={sharedStyles.label}>{t('charitable.proxy.subscription.importURIs')}</label>
                <textarea
                  className={sharedStyles.textarea}
                  value={proxyURIInput}
                  onChange={(event) => setProxyURIInput(event.target.value)}
                  rows={5}
                  placeholder={t('charitable.proxy.subscription.importURIsPlaceholder')}
                  spellCheck={false}
                />
                <div className={styles.importActions}>
                  <span>{t('charitable.proxy.subscription.importURIsHint')}</span>
                  <button type="button" className={sharedStyles.btnSecondary} onClick={() => void importProxyURIs()} disabled={!proxyURIInput.trim() || importingURIs}>
                    {importingURIs ? <IconLoader2 size={16} /> : <IconCheckCircle2 size={16} />}
                    {t('charitable.proxy.subscription.resolveAndSelect')}
                  </button>
                </div>
              </div>

              <div className={sharedStyles.field}>
                <label className={sharedStyles.label}>
                  {t('charitable.proxy.subscription.selectNodes', { count: selectedProxyIDs.size })}
                </label>
                <div className={styles.proxySearch}>
                  <IconSearch size={16} />
                  <input value={proxySearch} onChange={(event) => setProxySearch(event.target.value)} placeholder={t('charitable.proxy.subscription.searchNodes')} />
                </div>
                <div className={styles.proxyList}>
                  {visibleProxies.map((proxy) => (
                    <label key={proxy.id} className={styles.proxyOption}>
                      <SelectionCheckbox
                        checked={selectedProxyIDs.has(proxy.id)}
                        onChange={() => toggleProxy(proxy.id)}
                        ariaLabel={t('charitable.proxy.selectRow', { id: proxy.id })}
                      />
                      <span className={styles.proxyID}>#{proxy.id}</span>
                      <span className={styles.proxyName}>{proxy.remark || proxy.proxy_index}</span>
                      <span className={styles.proxyURI}>{maskKey(proxy.proxy_value)}</span>
                    </label>
                  ))}
                  {visibleProxies.length === 0 && (
                    <div className={styles.proxyEmpty}>{t('charitable.emptyList')}</div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className={styles.importBlock}>
              <label className={sharedStyles.label}>{t('charitable.proxy.subscription.proxyURLs')}</label>
              <textarea
                className={sharedStyles.textarea}
                value={proxyURLsInput}
                onChange={(event) => {
                  setProxyURLsInput(event.target.value);
                  setResolvedURLItems([]);
                }}
                rows={6}
                placeholder={t('charitable.proxy.subscription.proxyURLsPlaceholder')}
                spellCheck={false}
              />
              <div className={styles.importActions}>
                <span>{t('charitable.proxy.subscription.proxyURLsHint')}</span>
                <button type="button" className={sharedStyles.btnSecondary} onClick={() => void resolveProxyURLs()} disabled={parseLines(proxyURLsInput).length === 0 || resolvingURLs}>
                  {resolvingURLs ? <IconLoader2 size={16} /> : <IconCheckCircle2 size={16} />}
                  {t('charitable.proxy.subscription.resolveURLs')}
                </button>
              </div>
              {resolvedURLItems.length > 0 && (
                <div className={styles.resolvedSummary}>
                  <strong>{t('charitable.proxy.subscription.resolvedNodes', { count: resolvedURLItems.length })}</strong>
                  <div className={styles.resolvedNodes}>
                    {resolvedURLItems.slice(0, 50).map((proxy) => (
                      <span key={proxy.id}>#{proxy.id} {proxy.remark || proxy.proxy_index}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </form>
      </Sheet>
    </div>
  );
}
