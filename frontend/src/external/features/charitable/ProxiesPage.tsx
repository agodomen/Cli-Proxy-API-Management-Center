import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import {
  batchDeleteProxies,
  createProxy,
  deleteProxy,
  listProxies,
  probeProxies,
  testProxySites,
  updateProxy,
  type ProxyConnectivityTestResult,
  type ProxyProbeResult,
} from './api';
import {
  detectProxyType,
  getProxyTypeLabel,
  getStatusInfo,
  PROXY_TYPE_OPTIONS,
} from './types';
import type { ProxyDetail, ListParams } from './types';
import { maskKey } from './utils';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../serviceProviders/ui/Table';
import { Sheet } from '../serviceProviders/ui/Sheet';
import { Modal } from '@/components/ui/Modal';
import {
  IconCheckCircle2,
  IconCopy,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconRefreshCw,
  IconSearch,
  IconTrash2,
} from '../serviceProviders/ui/icons';
import { copyToClipboard } from '../serviceProviders/utils/clipboard';
import { ParamEditor } from './components/ParamEditor/ParamEditor';
import { ProxyCopyModal } from './components/ProxyCopyModal';
import { ProxySiteTestDrawer } from './components/ProxySiteTestDrawer';
import styles from './CharitablePage.module.scss';
import { buildClashVergeScript } from './clashVergeExport';
import {
  DEFAULT_PROXY_PRIVACY,
  formatProxyInfoPreview,
  prettyProxyInfo,
  PROXY_PRIVACY_OPTIONS,
  resolveProxyPrivacy,
  stringifyProxyInfo,
  type ProxyPrivacy,
  withProxyPrivacy,
} from './proxyInfo';

export function ProxiesPage() {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore(s => s.serviceBase);
  const managementKey = useAuthStore(s => s.managementKey);
  const { showNotification, showConfirmation } = useNotificationStore();

  const [items, setItems] = useState<ProxyDetail[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<number | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copyingClash, setCopyingClash] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [probeResults, setProbeResults] = useState<Record<number, ProxyProbeResult | undefined>>({});
  const [probingIDs, setProbingIDs] = useState<Set<number>>(new Set());
  const [siteTestingIDs, setSiteTestingIDs] = useState<Set<number>>(new Set());
  const [siteTestOpen, setSiteTestOpen] = useState(false);
  const [siteTestLoading, setSiteTestLoading] = useState(false);
  const [siteTestResults, setSiteTestResults] = useState<ProxyConnectivityTestResult[]>([]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit'>('create');
  const [editTarget, setEditTarget] = useState<ProxyDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formProxyValue, setFormProxyValue] = useState('');
  const [formProxyType, setFormProxyType] = useState(1);
  const [formProxyTypeQuery, setFormProxyTypeQuery] = useState('');
  const [formProxyPrivacy, setFormProxyPrivacy] = useState<ProxyPrivacy>(DEFAULT_PROXY_PRIVACY);
  const [formProxyInfoRaw, setFormProxyInfoRaw] = useState('');
  const [formStatus, setFormStatus] = useState(1);
  const [formPriority, setFormPriority] = useState(0);
  const [formContent, setFormContent] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formParam, setFormParam] = useState('{}');
  const [formParamValid, setFormParamValid] = useState(true);
  const [copyTargets, setCopyTargets] = useState<ProxyDetail[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<ProxyDetail | null>(null);

  const pageSize = 20;

  const fetchData = useCallback(async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const params: ListParams = { page, page_size: pageSize };
      if (search) params.search = search;
      if (statusFilter !== 'all') params.status = statusFilter;
      if (typeFilter !== 'all') params.proxy_type = typeFilter;
      const result = await listProxies(baseUrl, params, managementKey);
      const nextItems = result.items || [];
      const visibleIDs = new Set(nextItems.map(item => item.id));
      setItems(nextItems);
      setSelected(prev => new Set(Array.from(prev).filter(id => visibleIDs.has(id))));
      setTotalItems(result.total_items);
    } catch {
      showNotification(t('charitable.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, managementKey, page, search, statusFilter, typeFilter, showNotification, t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const selectedTypeLabel = useMemo(() => getProxyTypeLabel(formProxyType), [formProxyType]);
  const proxyTypeOptions = useMemo(
    () => PROXY_TYPE_OPTIONS.map((option) => ({
      value: String(option.value),
      label: t(`charitable.proxy.types.${option.key}`),
    })),
    [t],
  );
  const proxyTypeDisplay = useMemo(
    () => t(`charitable.proxy.types.${selectedTypeLabel}`),
    [selectedTypeLabel, t],
  );

  useEffect(() => {
    const query = formProxyTypeQuery.trim().toLowerCase();
    if (!query) return;
    const option = PROXY_TYPE_OPTIONS.find((candidate) => (
      String(candidate.value) === query
      || candidate.key === query
      || t(`charitable.proxy.types.${candidate.key}`).toLowerCase() === query
    ));
    if (option && option.value !== formProxyType) {
      setFormProxyType(option.value);
    }
  }, [formProxyType, formProxyTypeQuery, t]);

  const applyProxyType = (value: string) => {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 1) return;
    setFormProxyType(next);
    setFormProxyTypeQuery(t(`charitable.proxy.types.${getProxyTypeLabel(next)}`));
  };

  const handleProxyValueChange = (value: string) => {
    setFormProxyValue(value);
    // Unknown is the auto mode. Do not override a type explicitly selected by the user.
    if (formProxyType !== 1) return;
    const detected = detectProxyType(value);
    if (detected !== 1) {
      setFormProxyType(detected);
      setFormProxyTypeQuery(t(`charitable.proxy.types.${getProxyTypeLabel(detected)}`));
    }
  };

  const openCreate = () => {
    setSheetMode('create');
    setEditTarget(null);
    setFormProxyValue('');
    setFormProxyType(1);
    setFormProxyTypeQuery(t('charitable.proxy.types.unknown'));
    setFormProxyPrivacy(DEFAULT_PROXY_PRIVACY);
    setFormProxyInfoRaw(stringifyProxyInfo({ privacy: DEFAULT_PROXY_PRIVACY }));
    setFormStatus(1);
    setFormPriority(0);
    setFormContent('');
    setFormRemark('');
    setFormParam('{}');
    setFormParamValid(true);
    setSheetOpen(true);
  };

  const openEdit = (item: ProxyDetail) => {
    setSheetMode('edit');
    setEditTarget(item);
    setFormProxyValue(item.proxy_value || '');
    setFormProxyType(item.proxy_type || 1);
    setFormProxyTypeQuery(t(`charitable.proxy.types.${getProxyTypeLabel(item.proxy_type || 1)}`));
    setFormProxyPrivacy(resolveProxyPrivacy(item));
    setFormProxyInfoRaw(item.proxy_info || '');
    setFormStatus(item.status);
    setFormPriority(item.priority);
    setFormContent(item.content || '');
    setFormRemark(item.remark || '');
    setFormParam(item.param || '{}');
    setFormParamValid(true);
    setSheetOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!baseUrl || !formParamValid) return;
    if (!formProxyValue.trim() && !formContent.trim()) return;
    setSubmitting(true);
    try {
      const input = {
        proxy_type: formProxyType,
        proxy_value: formProxyValue.trim(),
        // proxy_info stores JSON metadata; privacy is the editable form field.
        proxy_info: withProxyPrivacy(formProxyInfoRaw, formProxyPrivacy),
        status: formStatus,
        priority: formPriority,
        content: formContent.trim() || undefined,
        remark: formRemark.trim() || undefined,
        param: formParam,
      };
      if (sheetMode === 'create') {
        await createProxy(baseUrl, input, managementKey);
        showNotification(t('charitable.createSuccess'), 'success');
      } else if (editTarget) {
        await updateProxy(baseUrl, editTarget.id, input, managementKey);
        showNotification(t('charitable.updateSuccess'), 'success');
      }
      setSheetOpen(false);
      fetchData();
    } catch {
      showNotification(sheetMode === 'create' ? t('charitable.createFailed') : t('charitable.updateFailed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!baseUrl || !deleteTarget) return;
    try {
      await deleteProxy(baseUrl, deleteTarget.id, managementKey);
      showNotification(t('charitable.deleteSuccess'), 'success');
      setDeleteTarget(null);
      fetchData();
    } catch {
      showNotification(t('charitable.deleteFailed'), 'error');
    }
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelected(checked ? new Set(items.map(item => item.id)) : new Set());
  };

  const runProbe = async (ids: number[]) => {
    if (!baseUrl || ids.length === 0) return;
    const uniqueIDs = Array.from(new Set(ids));
    setProbingIDs(prev => new Set([...prev, ...uniqueIDs]));
    try {
      const results = await probeProxies(baseUrl, uniqueIDs, managementKey);
      setProbeResults(prev => {
        const next = { ...prev };
        results.forEach(result => { next[result.id] = result; });
        return next;
      });
      const ok = results.filter(result => result.ok).length;
      showNotification(
        t('charitable.proxy.probeSummary', { ok, fail: results.length - ok, total: results.length }),
        ok === results.length ? 'success' : 'warning',
      );
    } catch {
      showNotification(t('charitable.proxy.probeFailed'), 'error');
    } finally {
      setProbingIDs(prev => {
        const next = new Set(prev);
        uniqueIDs.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  const runSiteTest = async (ids: number[]) => {
    if (!baseUrl || ids.length === 0) return;
    const uniqueIDs = Array.from(new Set(ids));
    setSiteTestingIDs(new Set(uniqueIDs));
    setSiteTestResults([]);
    setSiteTestOpen(true);
    setSiteTestLoading(true);
    try {
      setSiteTestResults(await testProxySites(baseUrl, uniqueIDs, managementKey));
    } catch {
      showNotification(t('charitable.proxy.siteTestFailed'), 'error');
      setSiteTestOpen(false);
    } finally {
      setSiteTestingIDs(new Set());
      setSiteTestLoading(false);
    }
  };

  const openCopyModal = (targets: ProxyDetail[]) => {
    const copyableTargets = targets.filter((item) => item.proxy_value.trim());
    if (copyableTargets.length === 0) return;
    setCopyTargets(copyableTargets);
  };

  const buildFilteredClashScript = useCallback(async () => {
    if (!baseUrl) throw new Error('usage_service_required');
    const filters: ListParams = { page: 1, page_size: 500 };
    if (search) filters.search = search;
    if (statusFilter !== 'all') filters.status = statusFilter;
    if (typeFilter !== 'all') filters.proxy_type = typeFilter;
    const allItems: ProxyDetail[] = [];
    let exportPage = 1;
    while (true) {
      const result = await listProxies(baseUrl, { ...filters, page: exportPage }, managementKey);
      allItems.push(...(result.items || []));
      if (allItems.length >= result.total_items || result.items.length === 0) break;
      exportPage += 1;
    }
    return buildClashVergeScript(allItems);
  }, [baseUrl, managementKey, search, statusFilter, typeFilter]);

  const handleExportClash = async () => {
    if (!baseUrl || exporting || copyingClash) return;
    setExporting(true);
    try {
      const result = await buildFilteredClashScript();
      const blob = new Blob([result.code], { type: 'text/javascript;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `clash-verge-proxies-${new Date().toISOString().slice(0, 10)}.js`;
      link.click();
      URL.revokeObjectURL(url);
      showNotification(t('charitable.proxy.clashExportSuccess', { personal: result.personalCount, public: result.publicCount, skipped: result.skippedCount }), result.skippedCount ? 'warning' : 'success');
    } catch {
      showNotification(t('charitable.proxy.clashExportFailed'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleCopyClash = async () => {
    if (!baseUrl || exporting || copyingClash) return;
    setCopyingClash(true);
    try {
      const result = await buildFilteredClashScript();
      const copied = await copyToClipboard(result.code);
      if (!copied) {
        showNotification(t('charitable.proxy.clashCopyFailed'), 'error');
        return;
      }
      showNotification(
        t('charitable.proxy.clashCopySuccess', {
          personal: result.personalCount,
          public: result.publicCount,
          skipped: result.skippedCount,
        }),
        result.skippedCount ? 'warning' : 'success',
      );
    } catch {
      showNotification(t('charitable.proxy.clashCopyFailed'), 'error');
    } finally {
      setCopyingClash(false);
    }
  };

  const handleBatchDelete = () => {
    if (!baseUrl || selected.size === 0) return;
    const ids = Array.from(selected);
    showConfirmation({
      title: t('charitable.batchDelete'),
      message: t('charitable.proxy.batchDeleteConfirm', { count: ids.length }),
      confirmText: t('charitable.confirm'),
      cancelText: t('charitable.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await batchDeleteProxies(baseUrl, ids, managementKey);
          setSelected(new Set());
          setProbeResults(prev => {
            const next = { ...prev };
            ids.forEach(id => delete next[id]);
            return next;
          });
          showNotification(t('charitable.deleteSuccess'), 'success');
          await fetchData();
        } catch {
          showNotification(t('charitable.deleteFailed'), 'error');
        }
      },
    });
  };

  const toggleReveal = (id: number) => {
    setRevealed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalPages = Math.ceil(totalItems / pageSize);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('charitable.proxies')}</h1>
        <div className={styles.actions}>
          <button className={styles.btnSecondary} onClick={() => void handleCopyClash()} disabled={exporting || copyingClash || totalItems === 0}>
            {copyingClash ? <IconLoader2 size={16} /> : <IconCopy size={16} />}
            {t('charitable.proxy.copyClash')}
          </button>
          <button className={styles.btnSecondary} onClick={() => void handleExportClash()} disabled={exporting || copyingClash || totalItems === 0}>
            {exporting ? <IconLoader2 size={16} /> : <IconDownload size={16} />}
            {t('charitable.proxy.exportClash')}
          </button>
          <button
            className={styles.btnSecondary}
            onClick={() => runSiteTest(items.map(item => item.id))}
            disabled={items.length === 0 || siteTestLoading}
          >
            {siteTestLoading ? <IconLoader2 size={16} /> : <IconCheckCircle2 size={16} />}
            {t('charitable.proxy.testAll')}
          </button>
          <button className={styles.btnSecondary} onClick={fetchData} disabled={loading}>
            <IconRefreshCw size={16} /> {t('charitable.refresh')}
          </button>
          <button className={styles.btnPrimary} onClick={openCreate}>
            <IconPlus size={16} /> {t('charitable.create')}
          </button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <IconSearch size={16} />
          <input
            type="text"
            placeholder={t('charitable.proxy.searchPlaceholder')}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          className={styles.filterSelect}
          value={typeFilter}
          onChange={e => { const v = e.target.value; setTypeFilter(v === 'all' ? 'all' : Number(v)); setPage(1); }}
        >
          <option value="all">{t('charitable.proxy.typeAll')}</option>
          {PROXY_TYPE_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{t(`charitable.proxy.types.${option.key}`)}</option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={e => { const v = e.target.value; setStatusFilter(v === 'all' ? 'all' : Number(v)); setPage(1); }}
        >
          <option value="all">{t('charitable.statusAll')}</option>
          <option value={1}>{t('charitable.statusValid')}</option>
          <option value={0}>{t('charitable.statusUnknown')}</option>
          <option value={-2}>{t('charitable.statusDisabled')}</option>
          <option value={-1}>{t('charitable.statusInvalid')}</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className={styles.batchBar}>
          <span>{t('charitable.proxy.selectedCount', { count: selected.size })}</span>
          <button
            className={styles.btnSecondary}
            onClick={() => runProbe(Array.from(selected))}
            disabled={Array.from(selected).some(id => probingIDs.has(id))}
          >
            <IconCheckCircle2 size={16} /> {t('charitable.proxy.batchProbe')}
          </button>
          <button
            className={styles.btnSecondary}
            onClick={() => openCopyModal(items.filter(item => selected.has(item.id)))}
          >
            <IconCopy size={16} /> {t('charitable.proxy.batchCopy')}
          </button>
          <button className={styles.btnDanger} onClick={handleBatchDelete}>
            <IconTrash2 size={16} /> {t('charitable.batchDelete')}
          </button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <SelectionCheckbox
                checked={items.length > 0 && selected.size === items.length}
                onChange={toggleSelectAll}
                ariaLabel={t('charitable.proxy.selectAll')}
              />
            </TableHead>
            <TableHead>#</TableHead>
            <TableHead>{t('charitable.proxy.proxyIndex')}</TableHead>
            <TableHead>{t('charitable.proxy.proxyValue')}</TableHead>
            <TableHead>{t('charitable.proxy.proxyType')}</TableHead>
            <TableHead>{t('charitable.proxy.proxyInfo')}</TableHead>
            <TableHead>{t('charitable.status')}</TableHead>
            <TableHead>{t('charitable.proxy.probeStatus')}</TableHead>
            <TableHead>{t('charitable.proxy.priority')}</TableHead>
            <TableHead alignRight>{t('charitable.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && !loading ? (
            <TableRow><TableCell colSpan={10} className={styles.emptyCell}>{t('charitable.emptyList')}</TableCell></TableRow>
          ) : items.map(item => {
            const si = getStatusInfo(item.status);
            const typeKey = getProxyTypeLabel(item.proxy_type);
            const isVisible = revealed.has(item.id);
            const isProbing = probingIDs.has(item.id);
            const isSiteTesting = siteTestingIDs.has(item.id);
            const probeResult = probeResults[item.id];
            return (
              <TableRow key={item.id} selected={selected.has(item.id)}>
                <TableCell>
                  <SelectionCheckbox
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    ariaLabel={t('charitable.proxy.selectRow', { id: item.id })}
                  />
                </TableCell>
                <TableCell className={styles.mono}>{item.id}</TableCell>
                <TableCell className={styles.mono}>{item.proxy_index || '-'}</TableCell>
                <TableCell className={styles.mono}>
                  <span className={styles.keyCell}>
                    <span>{isVisible ? item.proxy_value : maskKey(item.proxy_value)}</span>
                    <button className={styles.iconBtnSmall} onClick={() => toggleReveal(item.id)} title={t('charitable.toggleVisibility')}>
                      {isVisible ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                    </button>
                  </span>
                </TableCell>
                <TableCell>{t(`charitable.proxy.types.${typeKey}`)}</TableCell>
                <TableCell>
                  <span
                    className={styles.proxyInfoPreview}
                    title={prettyProxyInfo(item.proxy_info)}
                  >
                    <span className={styles.proxyPrivacyBadge}>
                      {t(`charitable.proxy.privacy.${resolveProxyPrivacy(item)}`)}
                    </span>
                    <span className={styles.proxyInfoPreviewText}>
                      {formatProxyInfoPreview(item.proxy_info)}
                    </span>
                  </span>
                </TableCell>
                <TableCell><span className={styles[`badge_${si.color}`]}>{t(si.label)}</span></TableCell>
                <TableCell>
                  {isProbing ? (
                    <span className={styles.probePending} title={t('charitable.proxy.probing')}>
                      <IconLoader2 size={16} />
                    </span>
                  ) : probeResult?.ok ? (
                    <span className={styles.badge_green} title={probeResult.target}>
                      {t('charitable.proxy.reachable', { latency: probeResult.latency_ms })}
                    </span>
                  ) : probeResult ? (
                    <span className={styles.badge_red} title={probeResult.error || probeResult.target}>
                      {t('charitable.proxy.unreachable')}
                    </span>
                  ) : (
                    <span className={styles.mutedCell}>-</span>
                  )}
                </TableCell>
                <TableCell>{item.priority}</TableCell>
                <TableCell alignRight>
                  <button
                    className={styles.iconBtn}
                    onClick={() => runProbe([item.id])}
                    disabled={isProbing}
                    title={t('charitable.proxy.probe')}
                  >
                    {isProbing ? <IconLoader2 className={styles.probePending} size={16} /> : <IconCheckCircle2 size={16} />}
                  </button>
                  <button
                    className={styles.iconBtn}
                    onClick={() => runSiteTest([item.id])}
                    disabled={isSiteTesting}
                    title={t('charitable.proxy.siteTest')}
                  >
                    {isSiteTesting ? <IconLoader2 className={styles.probePending} size={16} /> : <IconSearch size={16} />}
                  </button>
                  <button className={styles.iconBtn} onClick={() => openCopyModal([item])} title={t('charitable.proxy.copy')}>
                    <IconCopy size={16} />
                  </button>
                  <button className={styles.iconBtn} onClick={() => openEdit(item)} title={t('charitable.edit')}>
                    <IconPencil size={16} />
                  </button>
                  <button className={styles.iconBtnDanger} onClick={() => setDeleteTarget(item)} title={t('charitable.delete')}>
                    <IconTrash2 size={16} />
                  </button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={sheetMode === 'create' ? t('charitable.create') : t('charitable.edit')}
        size="lg"
        footer={
          <>
            <button type="submit" form="proxy-form" className={styles.btnPrimary} disabled={submitting || !formParamValid}>
              {t('charitable.save')}
            </button>
            <button type="button" className={styles.btnGhost} onClick={() => setSheetOpen(false)}>
              {t('charitable.cancel')}
            </button>
          </>
        }
      >
        <form id="proxy-form" className={styles.form} onSubmit={handleSubmit}>
          {sheetMode === 'edit' && editTarget?.proxy_index ? (
            <div className={styles.field}>
              <label className={styles.label}>{t('charitable.proxy.proxyIndex')}</label>
              <input className={styles.input} value={editTarget.proxy_index} readOnly />
            </div>
          ) : null}

          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.proxy.proxyValue')} *</label>
            <input
              className={styles.input}
              value={formProxyValue}
              onChange={e => handleProxyValueChange(e.target.value)}
              placeholder={t('charitable.proxy.proxyValuePlaceholder')}
            />
            <span className={styles.fieldHint}>{t('charitable.proxy.proxyValueHint')}</span>
          </div>

          <div className={styles.formRow}>
            <div className={styles.field}>
              <label className={styles.label}>{t('charitable.proxy.proxyType')}</label>
              <AutocompleteInput
                value={formProxyTypeQuery}
                onChange={setFormProxyTypeQuery}
                options={proxyTypeOptions}
                placeholder={t('charitable.proxy.proxyTypePlaceholder')}
                className={styles.input}
                wrapperClassName={styles.proxyTypeAutocomplete}
                rightElement={<span className={styles.proxyTypeValue}>{formProxyType}</span>}
              />
              <div className={styles.proxyTypeMatches}>
                {PROXY_TYPE_OPTIONS
                  .filter((option) => {
                    const query = formProxyTypeQuery.trim().toLowerCase();
                    if (!query) return true;
                    const label = t(`charitable.proxy.types.${option.key}`).toLowerCase();
                    return label.includes(query) || option.key.includes(query) || String(option.value) === query;
                  })
                  .slice(0, 1)
                  .map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={styles.proxyTypeMatch}
                      onClick={() => applyProxyType(String(option.value))}
                    >
                      {t(`charitable.proxy.types.${option.key}`)}
                    </button>
                  ))}
              </div>
              <span className={styles.fieldHint}>
                {t('charitable.proxy.proxyTypeHint')} {formProxyType === 1 ? t('charitable.proxy.proxyTypeAuto') : `${formProxyType}: ${proxyTypeDisplay}`}
              </span>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>{t('charitable.status')}</label>
              <select className={styles.input} value={formStatus} onChange={e => setFormStatus(Number(e.target.value))}>
                <option value={1}>{t('charitable.statusValid')}</option>
                <option value={0}>{t('charitable.statusUnknown')}</option>
                <option value={-2}>{t('charitable.statusDisabled')}</option>
                <option value={-1}>{t('charitable.statusInvalid')}</option>
              </select>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.proxy.privacyLabel')}</label>
            <div className={styles.proxyPrivacyGroup} role="radiogroup" aria-label={t('charitable.proxy.privacyLabel')}>
              {PROXY_PRIVACY_OPTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={formProxyPrivacy === value}
                  className={`${styles.proxyPrivacyOption} ${formProxyPrivacy === value ? styles.proxyPrivacyOptionActive : ''}`}
                  onClick={() => {
                    setFormProxyPrivacy(value);
                    setFormProxyInfoRaw(withProxyPrivacy(formProxyInfoRaw, value));
                  }}
                >
                  {t(`charitable.proxy.privacy.${value}`)}
                </button>
              ))}
            </div>
            <span className={styles.fieldHint}>{t('charitable.proxy.privacyHint')}</span>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.proxy.proxyInfo')}</label>
            <textarea
              className={`${styles.textarea} ${styles.proxyInfoReadonly}`}
              value={prettyProxyInfo(withProxyPrivacy(formProxyInfoRaw, formProxyPrivacy))}
              readOnly
              rows={6}
              spellCheck={false}
            />
            <span className={styles.fieldHint}>{t('charitable.proxy.proxyInfoReadonlyHint')}</span>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.proxy.priority')}</label>
            <input className={styles.input} type="number" value={formPriority} onChange={e => setFormPriority(Number(e.target.value))} />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.proxy.content')}</label>
            <textarea
              className={styles.textarea}
              value={formContent}
              onChange={e => setFormContent(e.target.value)}
              placeholder={t('charitable.proxy.contentPlaceholder')}
              rows={3}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.proxy.remark')}</label>
            <input
              className={styles.input}
              value={formRemark}
              onChange={e => setFormRemark(e.target.value)}
              placeholder={t('charitable.proxy.remarkPlaceholder')}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.proxy.param')}</label>
            <ParamEditor value={formParam} onChange={setFormParam} onValidityChange={setFormParamValid} />
          </div>
        </form>
      </Sheet>

      <ProxySiteTestDrawer
        open={siteTestOpen}
        loading={siteTestLoading}
        results={siteTestResults}
        onClose={() => setSiteTestOpen(false)}
      />

      <ProxyCopyModal
        open={copyTargets.length > 0}
        values={copyTargets.map((item) => item.proxy_value)}
        onClose={() => setCopyTargets([])}
      />

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t('charitable.delete')}>
        <p>{t('charitable.deleteConfirm')}</p>
        {deleteTarget && <p className={styles.mono}>{deleteTarget.proxy_index || maskKey(deleteTarget.proxy_value)}</p>}
        <div className={styles.modalActions}>
          <button className={styles.btnDanger} onClick={handleDelete}>{t('charitable.confirm')}</button>
          <button className={styles.btnGhost} onClick={() => setDeleteTarget(null)}>{t('charitable.cancel')}</button>
        </div>
      </Modal>
    </div>
  );
}
