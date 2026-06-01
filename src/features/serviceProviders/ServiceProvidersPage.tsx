import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconCheckCircle2,
  IconAlertTriangle,
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconPencil,
  IconSearch,
  IconTransfer,
  IconTrash2,
} from '@/components/ui/icons';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
} from '@/components/ui/Table';
import { Sheet } from '@/components/ui/Sheet/Sheet';
import { BaseProviderForm } from '@/features/providers/sheets/forms/BaseProviderForm';
import { providersApi } from '@/services/api/providers';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { buildOpenAIChatCompletionsEndpoint } from '@/components/providers/utils';
import { buildHeaderObject, hasHeader } from '@/utils/headers';
import { useNotificationStore } from '@/stores/useNotificationStore';
import type { OpenAIProviderConfig, ApiKeyEntry } from '@/types/provider';
import type { ProviderEntryFormInput, ProviderResource } from '@/features/providers/types';
import styles from './ServiceProvidersPage.module.scss';

/* ─── helpers ──────────────────────────────────────────────────────────────── */

const maskKey = (key: string | undefined): string => {
  if (!key) return '—';
  if (key.length <= 8) return '••••••' + key.slice(-4);
  return key.slice(0, 4) + '••••' + key.slice(-4);
};

const keyOf = (provider: OpenAIProviderConfig, entryIdx: number): string =>
  `${provider.name}__${entryIdx}`;

/**
 * Build a minimal ProviderResource from an OpenAIProviderConfig for edit mode.
 * This allows BaseProviderForm to read raw config and pre-fill existing values.
 */
const buildEditResource = (provider: OpenAIProviderConfig, index: number): ProviderResource => ({
  id: `sp-${provider.name}`,
  brand: 'openaiCompatibility',
  originalIndex: index,
  name: provider.name ?? null,
  identifier: provider.name,
  apiKeyPreview: null,
  apiKey: null,
  authIndex: null,
  baseUrl: provider.baseUrl ?? null,
  proxyUrl: (provider.proxyUrl as string) ?? null,
  prefix: provider.prefix ?? null,
  modelCount: provider.models?.length ?? 0,
  headerCount: 0,
  excludedModelCount: 0,
  apiKeyEntryCount: provider.apiKeyEntries?.length ?? 0,
  disabled: provider.disabled === true,
  flags: {},
  selector: { brand: 'openaiCompatibility', name: provider.name, index },
  raw: provider,
});

/* ─── MoveDropdown ──────────────────────────────────────────────────────────── */

function MoveDropdown({
  provider,
  allProviders,
  onMove,
  disabled,
}: {
  provider: OpenAIProviderConfig;
  allProviders: OpenAIProviderConfig[];
  onMove: (target: OpenAIProviderConfig) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  /* Target: same baseUrl, different name */
  const targets = allProviders.filter(
    (p) => p.baseUrl === provider.baseUrl && p.name !== provider.name
  );

  return (
    <div className={styles.moveDropdownWrap} ref={ref}>
      <button
        type="button"
        className={styles.iconBtn}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={t('serviceProviders.move.action')}
        aria-label={t('serviceProviders.move.action')}
      >
        <IconTransfer size={16} />
      </button>
      {open && (
        <div className={styles.moveDropdown}>
          {targets.length === 0 ? (
            <div className={styles.moveDropdownEmpty}>{t('serviceProviders.move.noTarget')}</div>
          ) : (
            targets.map((tgt) => (
              <button
                key={tgt.name}
                type="button"
                className={styles.moveDropdownItem}
                onClick={() => {
                  onMove(tgt);
                  setOpen(false);
                }}
              >
                <span className={styles.moveDropdownItemName}>{tgt.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ─── ServiceProvidersPage ──────────────────────────────────────────────────── */

export function ServiceProvidersPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((s) => s.showNotification);
  const showConfirmation = useNotificationStore((s) => s.showConfirmation);

  const [providers, setProviders] = useState<OpenAIProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [showAllKeys, setShowAllKeys] = useState(false);
  const [filter, setFilter] = useState<'all' | 'valid' | 'invalid'>('all');
  const [testStatuses, setTestStatuses] = useState<
    Record<string, 'loading' | 'success' | 'error' | undefined>
  >({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [testingAny, setTestingAny] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    provider: OpenAIProviderConfig;
    providerIdx: number;
  } | null>(null);

  /* ── data fetching ─────────────────────────────────────────────────────── */

  const fetchProviders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await providersApi.getOpenAIProviders();
      setProviders(data);
      if (data.length > 0 && !selectedName) {
        setSelectedName(data[0].name);
      }
    } catch {
      showNotification('Failed to load providers', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedName, showNotification]);

  useEffect(() => {
    void fetchProviders();
  }, [fetchProviders]);

  /* ── duplicate name detection ───────────────────────────────────────────── */

  const duplicateNames = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const p of providers) {
      if (seen.has(p.name)) {
        dupes.add(p.name);
      }
      seen.add(p.name);
    }
    return dupes;
  }, [providers]);

  useEffect(() => {
    if (duplicateNames.size > 0) {
      showNotification(
        t(
          'serviceProviders.toast.duplicateNames',
          'Duplicate provider names detected: {{names}}, please modify before proceeding',
          { names: [...duplicateNames].join(', ') }
        ),
        'error'
      );
    }
  }, [duplicateNames, showNotification, t]);

  /* ── derived state ─────────────────────────────────────────────────────── */

  const selectedProvider = useMemo(
    () => providers.find((p) => p.name === selectedName) ?? null,
    [providers, selectedName]
  );

  /* ── sidebar filtering ────────────────────────────────────────────────── */

  const filteredProviders = useMemo(() => {
    if (!sidebarSearch.trim()) return providers;
    const q = sidebarSearch.toLowerCase();
    return providers.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.baseUrl ?? '').toLowerCase().includes(q)
    );
  }, [providers, sidebarSearch]);

  const filteredEntries = useMemo(() => {
    if (!selectedProvider) return [];
    let entries = selectedProvider.apiKeyEntries ?? [];
    if (search) {
      const q = search.toLowerCase();
      entries = entries.filter((e) => (e.apiKey ?? '').toLowerCase().includes(q));
    }
    if (filter !== 'all') {
      entries = entries.filter((e) => {
        const k = keyOf(selectedProvider, (selectedProvider.apiKeyEntries ?? []).indexOf(e));
        const st = testStatuses[k];
        return filter === 'valid' ? st === 'success' : st === 'error';
      });
    }
    return entries;
  }, [selectedProvider, search, filter, testStatuses]);

  /* ── actions ───────────────────────────────────────────────────────────── */

  const openEditSheet = useCallback(
    (provider: OpenAIProviderConfig) => {
      const providerIdx = providers.indexOf(provider);
      setEditTarget({ provider, providerIdx });
      setSheetOpen(true);
    },
    [providers]
  );

  const handleDelete = useCallback(
    async (provider: OpenAIProviderConfig, entryIdx: number) => {
      showConfirmation({
        message: t('serviceProviders.toast.deleteConfirm', 'Delete this API key entry?'),
        onConfirm: async () => {
          try {
            const next = {
              ...provider,
              apiKeyEntries: [...(provider.apiKeyEntries ?? [])],
            };
            next.apiKeyEntries.splice(entryIdx, 1);
            const all = providers.map((p) => (p.name === provider.name ? next : p));
            await providersApi.saveOpenAIProviders(all);
            setProviders(all);
            showNotification(t('serviceProviders.toast.deleteSuccess'), 'success');
          } catch {
            showNotification(t('serviceProviders.toast.deleteFailed'), 'error');
          }
        },
      });
    },
    [providers, showConfirmation, showNotification, t]
  );

  /**
   * Move entry: check if target already has a duplicate apiKey
   * - Duplicate found: confirm dialog, only remove from source on confirm (do not add to target)
   * - No duplicate: normal move
   */
  const handleMove = useCallback(
    async (provider: OpenAIProviderConfig, entryIdx: number, target: OpenAIProviderConfig) => {
      try {
        const entry = (provider.apiKeyEntries ?? [])[entryIdx];
        if (!entry) return;

        /* Duplicate detection */
        const isDuplicate = (target.apiKeyEntries ?? []).some((e) => e.apiKey === entry.apiKey);

        const doRemoveOnly = async () => {
          const srcNext = {
            ...provider,
            apiKeyEntries: (provider.apiKeyEntries ?? []).filter((_, i) => i !== entryIdx),
          };
          const all = providers.map((p) => (p.name === provider.name ? srcNext : p));
          await providersApi.saveOpenAIProviders(all);
          setProviders(all);
          showNotification(
            t('serviceProviders.move.removeSuccess', 'Removed from current provider'),
            'success'
          );
        };

        if (isDuplicate) {
          showConfirmation({
            message: t(
              'serviceProviders.move.duplicateKeyConfirm',
              'This API key already exists in target provider "{{name}}", remove from current provider only?',
              { name: target.name }
            ),
            onConfirm: doRemoveOnly,
          });
          return;
        }

        /* Normal move */
        const srcNext = {
          ...provider,
          apiKeyEntries: (provider.apiKeyEntries ?? []).filter((_, i) => i !== entryIdx),
        };
        const tgtNext = {
          ...target,
          apiKeyEntries: [...(target.apiKeyEntries ?? []), entry],
        };
        const all = providers.map((p) => {
          if (p.name === provider.name) return srcNext;
          if (p.name === target.name) return tgtNext;
          return p;
        });
        await providersApi.saveOpenAIProviders(all);
        setProviders(all);
        showNotification(t('serviceProviders.toast.moveSuccess'), 'success');
      } catch {
        showNotification(t('serviceProviders.toast.moveFailed'), 'error');
      }
    },
    [providers, showConfirmation, showNotification, t]
  );

  const handleMoveFromDrawer = useCallback(
    async (realIdx: number, target: OpenAIProviderConfig) => {
      if (!editTarget) return;
      try {
        const { provider, providerIdx } = editTarget;
        const entry = (provider.apiKeyEntries ?? [])[realIdx];
        if (!entry) return;

        /* Duplicate detection */
        const isDuplicate = (target.apiKeyEntries ?? []).some((e) => e.apiKey === entry.apiKey);

        const doRemoveOnly = async () => {
          const srcNext = {
            ...provider,
            apiKeyEntries: (provider.apiKeyEntries ?? []).filter((_, i) => i !== realIdx),
          };
          const all = providers.map((p) => (p.name === provider.name ? srcNext : p));
          await providersApi.saveOpenAIProviders(all);
          setProviders(all);
          setEditTarget({ provider: srcNext, providerIdx });
          showNotification(
            t('serviceProviders.move.removeSuccess', 'Removed from current provider'),
            'success'
          );
        };

        if (isDuplicate) {
          showConfirmation({
            message: t(
              'serviceProviders.move.duplicateKeyConfirm',
              'This API key already exists in target provider "{{name}}", remove from current provider only?',
              { name: target.name }
            ),
            onConfirm: doRemoveOnly,
          });
          return;
        }

        /* Normal move */
        const srcNext = {
          ...provider,
          apiKeyEntries: (provider.apiKeyEntries ?? []).filter((_, i) => i !== realIdx),
        };
        const tgtNext = {
          ...target,
          apiKeyEntries: [...(target.apiKeyEntries ?? []), entry],
        };
        const all = providers.map((p) => {
          if (p.name === provider.name) return srcNext;
          if (p.name === target.name) return tgtNext;
          return p;
        });
        await providersApi.saveOpenAIProviders(all);
        setProviders(all);
        setEditTarget({ provider: srcNext, providerIdx });
        showNotification(t('serviceProviders.toast.moveSuccess'), 'success');
      } catch {
        showNotification(t('serviceProviders.toast.moveFailed'), 'error');
      }
    },
    [editTarget, providers, showConfirmation, showNotification, t]
  );

  const testEntry = useCallback(
    async (provider: OpenAIProviderConfig, entry: ApiKeyEntry, entryIdx: number) => {
      const k = keyOf(provider, entryIdx);
      setTestStatuses((prev) => ({ ...prev, [k]: 'loading' }));
      setTestErrors((prev) => {
        const n = { ...prev };
        delete n[k];
        return n;
      });
      try {
        const trimmedBase = (provider.baseUrl ?? '').replace(/\/+$/, '');
        const endpoint = buildOpenAIChatCompletionsEndpoint(trimmedBase);
        if (!endpoint) {
          setTestStatuses((prev) => ({ ...prev, [k]: 'error' }));
          setTestErrors((prev) => ({ ...prev, [k]: 'Invalid base URL' }));
          return;
        }
        const entryKey = (entry.apiKey ?? '').trim();
        const resolvedAuthIndex =
          (entry.authIndex ?? '').trim() || (provider.authIndex ?? '').trim() || undefined;
        if (!entryKey && !resolvedAuthIndex) {
          setTestStatuses((prev) => ({ ...prev, [k]: 'error' }));
          setTestErrors((prev) => ({ ...prev, [k]: 'API key or authIndex required' }));
          return;
        }
        const testModel = provider.testModel || provider.models?.[0]?.name || 'gpt-3.5-turbo';
        const headerObj: Record<string, string> = {
          'Content-Type': 'application/json',
          ...buildHeaderObject(provider.headers),
        };
        if (!hasHeader(headerObj, 'authorization')) {
          if (entryKey) {
            headerObj.Authorization = `Bearer ${entryKey}`;
          } else if (resolvedAuthIndex) {
            headerObj.Authorization = 'Bearer $TOKEN$';
          }
        }
        const result = await apiCallApi.request(
          {
            authIndex: resolvedAuthIndex,
            method: 'POST',
            url: endpoint,
            header: headerObj,
            data: JSON.stringify({
              model: testModel,
              messages: [{ role: 'user', content: 'Hi' }],
              stream: false,
              max_tokens: 5,
            }),
          },
          { timeout: 30000 }
        );
        if (result.statusCode < 200 || result.statusCode >= 300) {
          throw new Error(getApiCallErrorMessage(result));
        }
        setTestStatuses((prev) => ({ ...prev, [k]: 'success' }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setTestStatuses((prev) => ({ ...prev, [k]: 'error' }));
        setTestErrors((prev) => ({ ...prev, [k]: msg }));
      }
    },
    []
  );

  const handleTestAll = useCallback(async () => {
    if (!selectedProvider) return;
    setTestingAny(true);
    const entries = selectedProvider.apiKeyEntries ?? [];
    for (let i = 0; i < entries.length; i++) {
      await testEntry(selectedProvider, entries[i], i);
    }
    setTestingAny(false);
  }, [selectedProvider, testEntry]);

  const handleFormSubmit = useCallback(
    async (input: ProviderEntryFormInput) => {
      if (!editTarget) return;
      try {
        const { provider, providerIdx } = editTarget;

        /* Rebuild apiKeyEntries from form input */
        const apiKeyEntries: ApiKeyEntry[] = (input.apiKeyEntries ?? [])
          .map((e) => ({
            apiKey: (e.apiKey ?? '').trim() || (e.existingApiKey ?? '').trim(),
            proxyUrl: e.proxyUrl || undefined,
            authIndex: e.authIndex || undefined,
          }))
          .filter((e) => !!e.apiKey);

        /* Rebuild models from form input */
        const models = (input.models ?? [])
          .filter((m) => m.name.trim())
          .map((m) => ({
            name: m.name.trim(),
            ...(m.alias?.trim() ? { alias: m.alias.trim() } : {}),
          }));

        /* Rebuild headers from form input */
        const headers: Record<string, string> = {};
        (input.headers ?? []).forEach((h) => {
          if (h.key.trim()) headers[h.key.trim()] = h.value;
        });

        const next: OpenAIProviderConfig = {
          ...provider,
          name: input.name?.trim() || provider.name,
          baseUrl: (input.baseUrl?.trim() || provider.baseUrl).replace(/\/+$/, ''),
          apiKeyEntries,
          models: models.length ? models : provider.models,
          headers: Object.keys(headers).length ? headers : undefined,
          testModel: input.testModel?.trim() || provider.testModel,
          prefix: input.prefix?.trim() || provider.prefix,
          disabled: input.disabled ?? provider.disabled,
        };

        const all = [...providers];
        all[providerIdx] = next;
        await providersApi.saveOpenAIProviders(all);
        setProviders(all);
        setSelectedName(next.name);
        setSheetOpen(false);
        showNotification(t('serviceProviders.toast.updateSuccess', 'Provider updated'), 'success');
      } catch {
        showNotification(t('serviceProviders.toast.updateFailed', 'Update failed'), 'error');
      }
    },
    [editTarget, providers, showNotification, t]
  );

  /* ── render ────────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className={styles.page}>
        <h2 className={styles.title}>{t('serviceProviders.header.title')}</h2>
        <p>{t('common.loading', 'Loading...')}</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>{t('serviceProviders.header.title')}</h2>

      <div className={styles.layout}>
        {/* ─── sidebar ─────────────────────────────────────────────────── */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarEyebrow}>{t('serviceProviders.sidebar.baseUrl')}</div>
          <div className={styles.sidebarSearchWrap}>
            <span className={styles.searchIcon}>
              <IconSearch size={14} />
            </span>
            <input
              className={styles.sidebarSearchInput}
              placeholder={t('serviceProviders.sidebar.searchPlaceholder')}
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
            />
          </div>
          <div className={styles.sidebarList}>
            {filteredProviders.map((p) => (
              <button
                key={p.name}
                type="button"
                className={`${styles.sidebarItem}${
                  p.name === selectedName ? ` ${styles.sidebarItemActive}` : ''
                }${duplicateNames.has(p.name) ? ` ${styles.sidebarItemError}` : ''}`}
                onClick={() => setSelectedName(p.name)}
              >
                <div className={styles.sidebarItemText}>
                  <span className={styles.sidebarItemName}>{p.name}</span>
                  <span className={styles.sidebarItemUrl}>{p.baseUrl}</span>
                </div>
                <span className={styles.sidebarBadge}>{(p.apiKeyEntries ?? []).length}</span>
              </button>
            ))}
            {filteredProviders.length === 0 && (
              <div className={styles.sidebarEmpty}>{t('common.noData', 'No results')}</div>
            )}
          </div>
        </aside>

        {/* ─── main panel ──────────────────────────────────────────────── */}
        <div className={styles.mainPanel}>
          {selectedProvider ? (
            <>
              <div className={styles.panelHeader}>
                <div className={styles.panelTitleRow}>
                  <h3 className={styles.panelTitle}>{selectedProvider.name}</h3>
                  <span className={styles.panelSubtitle}>{selectedProvider.baseUrl}</span>
                </div>
                <div className={styles.panelToolbar}>
                  <div className={styles.searchWrap}>
                    <span className={styles.searchIcon}>
                      <IconSearch size={14} />
                    </span>
                    <input
                      className={styles.searchInput}
                      placeholder={t('serviceProviders.search.placeholder')}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className={styles.filterGroup}>
                    {(['all', 'valid', 'invalid'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        className={`${styles.filterBtn}${
                          filter === f ? ` ${styles.filterBtnActive}` : ''
                        }`}
                        onClick={() => setFilter(f)}
                      >
                        {t(`serviceProviders.filter.${f}`)}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={styles.testAllBtn}
                    onClick={handleTestAll}
                    disabled={testingAny}
                  >
                    {testingAny ? (
                      <IconLoader2 size={14} className="spin" />
                    ) : (
                      <IconCheckCircle2 size={14} />
                    )}
                    {t('serviceProviders.actions.testAll')}
                  </button>
                  <button
                    type="button"
                    className={styles.testAllBtn}
                    onClick={() => setShowAllKeys((v) => !v)}
                  >
                    {showAllKeys ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                    {showAllKeys
                      ? t('serviceProviders.actions.hideAllKeys')
                      : t('serviceProviders.actions.showAllKeys')}
                  </button>
                  <button
                    type="button"
                    className={styles.editBtn}
                    onClick={() => openEditSheet(selectedProvider)}
                    title={t('providersPage.detail.title')}
                  >
                    <IconPencil size={14} />
                    {t('serviceProviders.actions.editProvider', 'Edit')}
                  </button>
                </div>
              </div>

              {/* ─── table ─────────────────────────────────────────────── */}
              <Table
                cols={
                  <>
                    {['5%', '22%', '20%', '12%', '25%', '16%'].map((w, i) => (
                      <col key={i} style={{ width: w }} />
                    ))}
                  </>
                }
              >
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>{t('serviceProviders.table.apiKey')}</TableHead>
                    <TableHead>{t('serviceProviders.table.proxyUrl')}</TableHead>
                    <TableHead>{t('serviceProviders.table.status')}</TableHead>
                    <TableHead>{t('serviceProviders.table.statusDesc')}</TableHead>
                    <TableHead alignRight>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        style={{
                          textAlign: 'center',
                          color: 'var(--muted-foreground)',
                        }}
                      >
                        No entries
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredEntries.map((entry, visualIdx) => {
                      const realIdx = (selectedProvider.apiKeyEntries ?? []).indexOf(entry);
                      const k = keyOf(selectedProvider, realIdx);
                      const status = testStatuses[k];
                      const error = testErrors[k];
                      return (
                        <TableRow key={k}>
                          <TableCell>
                            <span className={styles.idxCell}>{visualIdx + 1}</span>
                          </TableCell>
                          <TableCell>
                            <span className={styles.apiKeyCell}>
                              {showAllKeys ? entry.apiKey : maskKey(entry.apiKey)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={styles.proxyCell}>
                              {(selectedProvider.proxyUrl as string | undefined) || '—'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={styles.statusCell}>
                              {status === 'loading' && (
                                <span className={`${styles.statusBadge} ${styles.statusLoading}`}>
                                  <IconLoader2 size={12} className="spin" />
                                  Testing...
                                </span>
                              )}
                              {status === 'success' && (
                                <span className={`${styles.statusBadge} ${styles.statusSuccess}`}>
                                  <IconCheckCircle2 size={12} />
                                  {t('serviceProviders.status.valid')}
                                </span>
                              )}
                              {status === 'error' && (
                                <span
                                  className={`${styles.statusBadge} ${styles.statusError}`}
                                  title={error}
                                >
                                  <IconAlertTriangle size={12} />
                                  {t('serviceProviders.status.invalid')}
                                </span>
                              )}
                              {!status && <span className={styles.statusIdle}>—</span>}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={styles.statusDescCell} title={error || ''}>
                              {error || '—'}
                            </span>
                          </TableCell>
                          <TableCell alignRight>
                            <div className={styles.actions}>
                              <button
                                type="button"
                                className={styles.iconBtn}
                                onClick={() => testEntry(selectedProvider, entry, realIdx)}
                                disabled={testingAny}
                                title="Test"
                              >
                                <IconCheckCircle2 size={16} />
                              </button>
                              <MoveDropdown
                                provider={selectedProvider}
                                allProviders={providers}
                                onMove={(target) => handleMove(selectedProvider, realIdx, target)}
                                disabled={testingAny}
                              />
                              <button
                                type="button"
                                className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                                onClick={() => handleDelete(selectedProvider, realIdx)}
                                title="Delete"
                              >
                                <IconTrash2 size={16} />
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </>
          ) : (
            <div className={styles.emptyState}>Select a provider from the sidebar</div>
          )}
        </div>
      </div>

      {/* ─── Edit sheet ──────────────────────────────────────────────────── */}
      {editTarget && (
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={t('providersPage.detail.title')}
        >
          <BaseProviderForm
            brand="openaiCompatibility"
            resource={buildEditResource(editTarget.provider, editTarget.providerIdx)}
            mode="edit"
            mutating={false}
            formId="sp-edit-form"
            onSubmit={handleFormSubmit}
            renderEntryCardExtra={(realIdx) => (
              <MoveDropdown
                provider={editTarget.provider}
                allProviders={providers}
                onMove={(target) => handleMoveFromDrawer(realIdx, target)}
                disabled={false}
              />
            )}
          />
        </Sheet>
      )}
    </div>
  );
}