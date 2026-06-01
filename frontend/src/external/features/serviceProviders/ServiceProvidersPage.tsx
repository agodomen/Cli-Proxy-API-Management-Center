import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconCheckCircle2,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFileText,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconRefreshCw,
  IconSearch,
  IconTransfer,
  IconTrash2,
} from './ui/icons';
import { copyToClipboard, readFromClipboard } from './utils/clipboard';
import { downloadBlob } from './utils/download';
import { Modal } from '@/components/ui/Modal';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
} from './ui/Table';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { Sheet } from './ui/Sheet';
import { BaseProviderForm } from './ui/BaseProviderForm';
import { providersApi } from '@/services/api/providers';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { modelsApi } from '@/services/api/models';
import { buildOpenAIChatCompletionsEndpoint } from '@/external/components/providers/utils';
import { buildHeaderObject, hasHeader } from '@/utils/headers';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { syncServiceProvidersToKeys } from '@/external/features/charitable/api';
import { updateOpenAIProvider } from '@/external/services/api/openaiProviderAdapter';
import type { OpenAIProviderConfig, ApiKeyEntry } from '@/types/provider';
import type { ProviderEntryFormInput, ProviderResource, ApiKeyEntryInput } from './types';
import formStyles from './styles/sharedForm.module.scss';
import styles from './ServiceProvidersPage.module.scss';

/* ─── helpers ──────────────────────────────────────────────────────────────── */

type ExportEntry = { apiKey: string; baseUrl: string; type: string };

const buildExportJson = (entries: ApiKeyEntry[], baseUrl: string): string => {
  const data: ExportEntry[] = entries.map((entry) => ({
    apiKey: entry.apiKey ?? '',
    baseUrl,
    type: 'openai-compatibility',
  }));
  return JSON.stringify(data, null, 2);
};

const isValidImportData = (data: unknown): data is ExportEntry[] => {
  if (!Array.isArray(data) || data.length === 0) return false;
  const first = data[0];
  return (
    typeof first === 'object' &&
    first !== null &&
    'apiKey' in first &&
    'baseUrl' in first &&
    'type' in first
  );
};

const parseImportJson = (text: string): ExportEntry[] => {
  const data: unknown = JSON.parse(text);
  if (!isValidImportData(data)) {
    throw new Error('invalid format');
  }
  return data.filter((entry) => typeof entry.apiKey === 'string' && entry.apiKey.trim().length > 0);
};

const mergeEntries = (
  existing: ApiKeyEntry[],
  imported: ExportEntry[]
): { added: number; skipped: number } => {
  const seen = new Set(existing.map((entry) => entry.apiKey));
  let added = 0;
  let skipped = 0;

  for (const item of imported) {
    if (seen.has(item.apiKey)) {
      skipped += 1;
      continue;
    }

    existing.push({ apiKey: item.apiKey });
    seen.add(item.apiKey);
    added += 1;
  }

  return { added, skipped };
};

const maskKey = (key: string | undefined): string => {
  if (!key) return '—';
  if (key.length <= 8) return '••••••' + key.slice(-4);
  return key.slice(0, 4) + '••••' + key.slice(-4);
};

const keyOf = (provider: OpenAIProviderConfig, entry: ApiKeyEntry): string =>
  `${provider.name}__${entry.apiKey}`;

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

function BatchMoveDropdown({
  provider,
  allProviders,
  onMove,
  disabled,
  selectedCount,
}: {
  provider: OpenAIProviderConfig;
  allProviders: OpenAIProviderConfig[];
  onMove: (target: OpenAIProviderConfig) => void;
  disabled: boolean;
  selectedCount: number;
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

  const targets = allProviders.filter(
    (p) => p.baseUrl === provider.baseUrl && p.name !== provider.name
  );

  return (
    <div className={styles.moveDropdownWrap} ref={ref}>
      <button
        type="button"
        className={styles.testAllBtn}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <IconTransfer size={14} />
        {t('serviceProviders.actions.moveSelected', 'Move Selected ({{count}})', {
          count: selectedCount,
        })}
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
  const baseUrl = useUsageServiceStore((s) => s.serviceBase);
  const managementKey = useAuthStore((s) => s.managementKey) ?? '';
  type ProviderVisibilityFilter = 'enabled' | 'disabled' | 'all';

  const [providers, setProviders] = useState<OpenAIProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; skipped: number; total: number } | null>(null);
  const [search, setSearch] = useState('');
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [showAllKeys, setShowAllKeys] = useState(false);
  const [providerVisibilityFilter, setProviderVisibilityFilter] = useState<ProviderVisibilityFilter>('enabled');
  const [filter, setFilter] = useState<string>('all');
  const [selectedEntryIndices, setSelectedEntryIndices] = useState<Set<number>>(new Set());
  const [testStatuses, setTestStatuses] = useState<
    Record<string, 'loading' | 'success' | 'error' | undefined>
  >({});
  const [testStatusCodes, setTestStatusCodes] = useState<Record<string, number | undefined>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [testingAny, setTestingAny] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit'>('edit');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const editFormId = useId();
  const [editTarget, setEditTarget] = useState<{
    provider: OpenAIProviderConfig;
    providerIdx: number;
    originalApiKeyEntries?: ApiKeyEntryInput[];
  } | null>(null);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  /* ── duplicate key resolution modal ──────────────────────────────────────── */
  const [dupModalOpen, setDupModalOpen] = useState(false);
  const [dupPendingInput, setDupPendingInput] = useState<ProviderEntryFormInput | null>(null);

  /* ── 编辑抽屉内的测试和拉取模型状态 ────────────────────────────────── */
  const [apiKeyTestStatuses, setApiKeyTestStatuses] = useState<
    Record<number, { state: 'idle' | 'loading' | 'success' | 'error'; message?: string; statusCode?: number }>
  >({});
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testingAnyInDrawer, setTestingAnyInDrawer] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<Array<{ name: string; alias?: string }> | undefined>(undefined);

  /* ── data fetching ─────────────────────────────────────────────────────── */

  const fetchProviders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await providersApi.getOpenAIProviders();
      setProviders(data);
      setSelectedName((prev) => prev ?? (data.length > 0 ? data[0].name : null));
    } catch {
      showNotification('Failed to load providers', 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    void fetchProviders();
  }, [fetchProviders]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const data = await providersApi.getOpenAIProviders();
      setProviders(data);
      setSelectedName((prev) => {
        if (prev && data.some((p) => p.name === prev)) return prev;
        return data.length > 0 ? data[0].name : null;
      });
      showNotification(t('serviceProviders.toast.refreshed', 'Data refreshed'), 'success');
    } catch {
      showNotification(t('serviceProviders.toast.refreshFailed', 'Refresh failed'), 'error');
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, showNotification, t]);

  const syncProvidersToKeys = useCallback(async (targetProviders: OpenAIProviderConfig[]) => {
    if (!baseUrl || syncBusy) return;

    const seen = new Set<string>();
    const entries: {
      base_url: string;
      api_key: string;
      protocols: string[];
      provider_name?: string;
      models?: Array<{ name: string; alias?: string }>;
      test_model?: string;
    }[] = [];

    for (const provider of targetProviders) {
      const base = (provider.baseUrl ?? '').trim();
      if (!base) continue;
      const protos = ['openai'];
      const models = (provider.models ?? [])
        .map((model) => {
          const name = (model.name ?? '').trim();
          if (!name) return null;
          const alias = (model.alias ?? '').trim();
          return {
            name,
            alias: alias || name,
          };
        })
        .filter((model): model is { name: string; alias: string } => model !== null);
      const testModel = (provider.testModel ?? '').trim() || models[0]?.name;

      for (const entry of provider.apiKeyEntries ?? []) {
        const key = (entry.apiKey ?? '').trim();
        if (!key) continue;
        const dedupKey = `${base}::${key}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        entries.push({
          base_url: base,
          api_key: key,
          protocols: protos,
          provider_name: (provider.name ?? '').trim() || undefined,
          models: models.length ? models : undefined,
          test_model: testModel || undefined,
        });
      }
    }

    if (entries.length === 0) {
      showNotification(t('serviceProviders.toast.syncNoEntries', 'No API keys to sync'), 'warning');
      return;
    }

    setSyncBusy(true);
    setSyncResult(null);
    try {
      const result = await syncServiceProvidersToKeys(baseUrl, entries, managementKey);
      setSyncResult(result);
      if (result.synced > 0 || (result.updated_keys ?? 0) > 0 || (result.updated ?? 0) > 0) {
        showNotification(
          t(
            'serviceProviders.toast.syncSuccess',
            'Created {{synced}} keys, overwritten {{updatedKeys}} keys ({{skipped}} skipped, {{updated}} providers updated)',
            {
              synced: result.synced,
              updatedKeys: result.updated_keys ?? 0,
              skipped: result.skipped,
              updated: result.updated ?? 0,
            },
          ),
          'success',
        );
      } else {
        showNotification(
          t('serviceProviders.toast.syncAllSkipped', 'All {{total}} keys failed or were skipped', { total: result.total }),
          'warning',
        );
      }
    } catch {
      showNotification(t('serviceProviders.toast.syncFailed', 'Sync failed'), 'error');
    } finally {
      setSyncBusy(false);
    }
  }, [baseUrl, managementKey, showNotification, syncBusy, t]);

  const handleSyncToKeys = useCallback(async () => {
    void syncProvidersToKeys(providers);
  }, [providers, syncProvidersToKeys]);

  const handleSyncProviderToKeys = useCallback(async (provider: OpenAIProviderConfig) => {
    void syncProvidersToKeys([provider]);
  }, [syncProvidersToKeys]);

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

  const providerVisibilityCounts = useMemo(
    () => ({
      enabled: providers.filter((provider) => !provider.disabled).length,
      disabled: providers.filter((provider) => provider.disabled).length,
      all: providers.length,
    }),
    [providers]
  );

  /* ── derived state ─────────────────────────────────────────────────────── */

  const selectedProvider = useMemo(
    () => providers.find((p) => p.name === selectedName) ?? null,
    [providers, selectedName]
  );

  const clearSelection = useCallback(() => {
    setSelectedEntryIndices(new Set());
  }, []);

  /* ── sidebar filtering ────────────────────────────────────────────────── */

  const filteredProviders = useMemo(() => {
    let result = providers;

    if (sidebarSearch.trim()) {
      const q = sidebarSearch.toLowerCase();
      result = result.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.baseUrl ?? '').toLowerCase().includes(q)
      );
    }

    if (providerVisibilityFilter === 'enabled') {
      result = result.filter((p) => !p.disabled);
    } else if (providerVisibilityFilter === 'disabled') {
      result = result.filter((p) => p.disabled);
    }

    return [...result].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    );
  }, [providerVisibilityFilter, providers, sidebarSearch]);

  useEffect(() => {
    if (!selectedProvider) return;
    if (providerVisibilityFilter === 'all') return;
    if (providerVisibilityFilter === 'enabled' && !selectedProvider.disabled) return;
    if (providerVisibilityFilter === 'disabled' && selectedProvider.disabled) return;
    setSelectedName(filteredProviders[0]?.name ?? null);
  }, [filteredProviders, providerVisibilityFilter, selectedProvider]);

  // Reset search/filter/selection whenever the selected provider changes
  useEffect(() => {
    setSearch('');
    setFilter('all');
    clearSelection();
  }, [selectedName, clearSelection]);

  useEffect(() => {
    const maxIdx = (selectedProvider?.apiKeyEntries ?? []).length;
    setSelectedEntryIndices((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const idx of prev) {
        if (idx < maxIdx) next.add(idx);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [selectedProvider]);

  useEffect(() => {
    const validKeys = new Set(
      providers.flatMap((provider) =>
        (provider.apiKeyEntries ?? []).map((entry) => keyOf(provider, entry))
      )
    );
    const prune = <T extends Record<string, unknown>>(state: T): T => {
      const entries = Object.entries(state).filter(([key]) => validKeys.has(key));
      if (entries.length === Object.keys(state).length) {
        return state;
      }
      return Object.fromEntries(entries) as T;
    };
    setTestStatuses(prune);
    setTestStatusCodes(prune);
    setTestErrors(prune);
  }, [providers]);

  const handleToggleProviderDisabled = useCallback(
    async (enabled: boolean) => {
      if (!selectedProvider) return;
      const next: OpenAIProviderConfig = {
        ...selectedProvider,
        priority: enabled ? 0 : selectedProvider.priority,
        disabled: !enabled,
      };
      setProviders((prev) => {
        const idx = prev.findIndex((p) => p.name === selectedProvider.name);
        if (idx !== -1) void updateOpenAIProvider(idx, next);
        return prev.map((p) => (p.name === selectedProvider.name ? next : p));
      });
      showNotification(
        enabled
          ? t('serviceProviders.toast.enabled', 'Provider enabled')
          : t('serviceProviders.toast.disabled', 'Provider disabled'),
        'success'
      );
    },
    [selectedProvider, showNotification, t]
  );

  const handleDeleteProvider = useCallback(async () => {
    if (!selectedProvider) return;
    showConfirmation({
      message: t(
        'serviceProviders.toast.deleteProviderConfirm',
        'Delete provider "{name}"?',
        { name: selectedProvider.name }
      ),
      onConfirm: async () => {
        try {
          const name = selectedProvider.name;
          setProviders((prev) => {
            const idx = prev.findIndex((p) => p.name === name);
            if (idx !== -1) {
              const removed = prev.filter((_, i) => i !== idx);
              void providersApi.saveOpenAIProviders(removed);
            }
            return prev.filter((p) => p.name !== name);
          });
          setSelectedName((prev) => (prev === name ? '' : prev));
          showNotification(t('serviceProviders.toast.deleteProviderSuccess', 'Provider deleted'), 'success');
        } catch {
          showNotification(t('serviceProviders.toast.deleteProviderFailed', 'Failed to delete provider'), 'error');
        }
      },
    });
  }, [selectedProvider, showConfirmation, showNotification, t]);

  const statusFilterOptions = useMemo(() => {
    if (!selectedProvider) return [];
    const entries = selectedProvider.apiKeyEntries ?? [];
    const codeSet = new Set<string>();
    for (const entry of entries) {
      const k = keyOf(selectedProvider, entry);
      const code = testStatusCodes[k];
      if (code !== undefined) {
        codeSet.add(String(code));
      }
    }
    return [...codeSet].sort((a, b) => Number(a) - Number(b));
  }, [selectedProvider, testStatusCodes]);

  const filteredEntries = useMemo(() => {
    if (!selectedProvider) return [];
    let entries = selectedProvider.apiKeyEntries ?? [];
    if (search) {
      const q = search.toLowerCase();
      entries = entries.filter((e) => (e.apiKey ?? '').toLowerCase().includes(q));
    }
    if (filter !== 'all') {
      entries = entries.filter((e) => {
        const k = keyOf(selectedProvider, e);
        const code = testStatusCodes[k];
        if (code === undefined) return false;
        return String(code) === filter;
      });
    }
    const seen = new Set<string>();
    const unique = (Array.isArray(entries) ? entries : []).filter((entry) => {
      const k = entry.apiKey ?? '';
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return unique;
  }, [selectedProvider, search, filter, testStatusCodes]);

  const filteredEntryIndices = useMemo(() => {
    if (!selectedProvider) return [];
    return filteredEntries
      .map((entry) => (selectedProvider.apiKeyEntries ?? []).indexOf(entry))
      .filter((idx) => idx >= 0);
  }, [filteredEntries, selectedProvider]);

  const selectedIndices = useMemo(
    () => Array.from(selectedEntryIndices).sort((a, b) => a - b),
    [selectedEntryIndices]
  );

  const allVisibleSelected =
    filteredEntryIndices.length > 0 && filteredEntryIndices.every((idx) => selectedEntryIndices.has(idx));
  const selectedCount = selectedEntryIndices.size;

  /* ── actions ───────────────────────────────────────────────────────────── */

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setApiKeyTestStatuses({});
    setFetchedModels(undefined);
    setFetchingModels(false);
    setTestingAnyInDrawer(false);
  }, []);

  const openEditSheet = useCallback(
    (provider: OpenAIProviderConfig) => {
      setSheetMode('edit');
      setApiKeyTestStatuses({});
      setFetchedModels(undefined);
      setProviders((prev) => {
        const idx = prev.indexOf(provider);
        setEditTarget({ provider, providerIdx: idx });
        return prev;
      });
      setSheetOpen(true);
    },
    []
  );

  const openCreateSheet = useCallback(() => {
    setSheetMode('create');
    setEditTarget(null);
    setApiKeyTestStatuses({});
    setFetchedModels(undefined);
    setSheetOpen(true);
  }, []);

  const toggleEntrySelection = useCallback((entryIdx: number, checked: boolean) => {
    setSelectedEntryIndices((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(entryIdx);
      } else {
        next.delete(entryIdx);
      }
      return next;
    });
  }, []);

  const handleToggleAllVisible = useCallback(
    (checked: boolean) => {
      setSelectedEntryIndices((prev) => {
        const next = new Set(prev);
        filteredEntryIndices.forEach((idx) => {
          if (checked) {
            next.add(idx);
          } else {
            next.delete(idx);
          }
        });
        return next;
      });
    },
    [filteredEntryIndices]
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
            setProviders((prev) => {
              const idx = prev.findIndex((p) => p.name === provider.name);
              if (idx !== -1) void updateOpenAIProvider(idx, next);
              return prev.map((p) => (p.name === provider.name ? next : p));
            });
            setSearch('');
            setFilter('all');
            showNotification(t('serviceProviders.toast.deleteSuccess'), 'success');
          } catch {
            showNotification(t('serviceProviders.toast.deleteFailed'), 'error');
          }
        },
      });
    },
    [showConfirmation, showNotification, t]
  );


  const handleBatchDelete = useCallback(async () => {
    if (!selectedProvider || selectedIndices.length === 0) return;

    showConfirmation({
      message: t(
        'serviceProviders.toast.deleteSelectedConfirm',
        'Delete {{count}} selected API key entries?',
        { count: selectedIndices.length }
      ),
      onConfirm: async () => {
        try {
          const removeSet = new Set(selectedIndices);
          const next = {
            ...selectedProvider,
            apiKeyEntries: (selectedProvider.apiKeyEntries ?? []).filter((_, idx) => !removeSet.has(idx)),
          };
          setProviders((prev) => {
            const idx = prev.findIndex((p) => p.name === selectedProvider.name);
            if (idx !== -1) void updateOpenAIProvider(idx, next);
            return prev.map((p) => (p.name === selectedProvider.name ? next : p));
          });
          clearSelection();
          setSearch('');
          setFilter('all');
          showNotification(
            t(
              'serviceProviders.toast.deleteSelectedSuccess',
              'Deleted {{count}} API key entries',
              { count: selectedIndices.length }
            ),
            'success'
          );
        } catch {
          showNotification(t('serviceProviders.toast.deleteFailed'), 'error');
        }
      },
    });
  }, [clearSelection, selectedIndices, selectedProvider, showConfirmation, showNotification, t]);

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
          setProviders((prev) => {
            const srcIdx = prev.findIndex((p) => p.name === provider.name);
            if (srcIdx !== -1) void updateOpenAIProvider(srcIdx, srcNext);
            return prev.map((p) => (p.name === provider.name ? srcNext : p));
          });
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
        setProviders((prev) => {
          const srcIdx = prev.findIndex((p) => p.name === provider.name);
          const tgtIdx = prev.findIndex((p) => p.name === target.name);
          if (srcIdx !== -1) void updateOpenAIProvider(srcIdx, srcNext);
          if (tgtIdx !== -1) void updateOpenAIProvider(tgtIdx, tgtNext);
          return prev.map((p) => {
            if (p.name === provider.name) return srcNext;
            if (p.name === target.name) return tgtNext;
            return p;
          });
        });
        showNotification(t('serviceProviders.toast.moveSuccess'), 'success');
      } catch {
        showNotification(t('serviceProviders.toast.moveFailed'), 'error');
      }
    },
    [showConfirmation, showNotification, t]
  );

  const handleBatchMove = useCallback(
    async (target: OpenAIProviderConfig) => {
      if (!selectedProvider || selectedIndices.length === 0) return;

      const sourceEntries = selectedProvider.apiKeyEntries ?? [];
      const selectedEntries = selectedIndices
        .map((idx) => sourceEntries[idx])
        .filter((entry): entry is ApiKeyEntry => Boolean(entry));
      if (selectedEntries.length === 0) return;

      const duplicateEntries = selectedEntries.filter((entry) =>
        (target.apiKeyEntries ?? []).some((targetEntry) => targetEntry.apiKey === entry.apiKey)
      );
      const uniqueEntries = selectedEntries.filter(
        (entry) => !(target.apiKeyEntries ?? []).some((targetEntry) => targetEntry.apiKey === entry.apiKey)
      );

      const doMove = async () => {
        try {
          const removeSet = new Set(selectedIndices);
          const srcNext = {
            ...selectedProvider,
            apiKeyEntries: sourceEntries.filter((_, idx) => !removeSet.has(idx)),
          };
          const tgtNext = {
            ...target,
            apiKeyEntries: [...(target.apiKeyEntries ?? []), ...uniqueEntries],
          };
          setProviders((prev) => {
            const srcIdx = prev.findIndex((p) => p.name === selectedProvider.name);
            const tgtIdx = prev.findIndex((p) => p.name === target.name);
            if (srcIdx !== -1) void updateOpenAIProvider(srcIdx, srcNext);
            if (tgtIdx !== -1) void updateOpenAIProvider(tgtIdx, tgtNext);
            return prev.map((p) => {
              if (p.name === selectedProvider.name) return srcNext;
              if (p.name === target.name) return tgtNext;
              return p;
            });
          });
          clearSelection();
          showNotification(
            duplicateEntries.length > 0
              ? t(
                  'serviceProviders.toast.moveSelectedPartialSuccess',
                  'Moved {{movedCount}} entries and removed {{removedOnlyCount}} duplicates from the current provider',
                  {
                    movedCount: uniqueEntries.length,
                    removedOnlyCount: duplicateEntries.length,
                  }
                )
              : t(
                  'serviceProviders.toast.moveSelectedSuccess',
                  'Moved {{count}} selected API key entries',
                  { count: selectedEntries.length }
                ),
            'success'
          );
        } catch {
          showNotification(t('serviceProviders.toast.moveFailed'), 'error');
        }
      };

      if (duplicateEntries.length > 0) {
        showConfirmation({
          message: t(
            'serviceProviders.move.batchDuplicateKeyConfirm',
            '{{count}} selected API keys already exist in target provider "{{name}}". Continue moving the remaining keys and only remove duplicates from the current provider?',
            {
              count: duplicateEntries.length,
              name: target.name,
            }
          ),
          onConfirm: doMove,
        });
        return;
      }

      await doMove();
    },
    [clearSelection, selectedIndices, selectedProvider, showConfirmation, showNotification, t]
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
          setProviders((prev) => {
            const idx = prev.findIndex((p) => p.name === provider.name);
            if (idx !== -1) void updateOpenAIProvider(idx, srcNext);
            return prev.map((p) => (p.name === provider.name ? srcNext : p));
          });
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
        setProviders((prev) => {
          const srcIdx = prev.findIndex((p) => p.name === provider.name);
          const tgtIdx = prev.findIndex((p) => p.name === target.name);
          if (srcIdx !== -1) void updateOpenAIProvider(srcIdx, srcNext);
          if (tgtIdx !== -1) void updateOpenAIProvider(tgtIdx, tgtNext);
          return prev.map((p) => {
            if (p.name === provider.name) return srcNext;
            if (p.name === target.name) return tgtNext;
            return p;
          });
        });
        setEditTarget({ provider: srcNext, providerIdx });
        showNotification(t('serviceProviders.toast.moveSuccess'), 'success');
      } catch {
        showNotification(t('serviceProviders.toast.moveFailed'), 'error');
      }
    },
    [editTarget, showConfirmation, showNotification, t]
  );

  const testEntry = useCallback(
    async (provider: OpenAIProviderConfig, entry: ApiKeyEntry) => {
      const k = keyOf(provider, entry);
      setTestStatuses((prev) => ({ ...prev, [k]: 'loading' }));
      setTestStatusCodes((prev) => ({ ...prev, [k]: undefined }));
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
          setTestStatusCodes((prev) => ({ ...prev, [k]: 504 }));
          setTestErrors((prev) => ({ ...prev, [k]: 'Invalid base URL' }));
          return;
        }
        const entryKey = (entry.apiKey ?? '').trim();
        const resolvedAuthIndex =
          (entry.authIndex ?? '').trim() || (provider.authIndex ?? '').trim() || undefined;
        if (!entryKey && !resolvedAuthIndex) {
          setTestStatuses((prev) => ({ ...prev, [k]: 'error' }));
          setTestStatusCodes((prev) => ({ ...prev, [k]: 504 }));
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
        setTestStatusCodes((prev) => ({ ...prev, [k]: result.statusCode }));
        if (result.statusCode < 200 || result.statusCode >= 300) {
          setTestStatuses((prev) => ({ ...prev, [k]: 'error' }));
          setTestErrors((prev) => ({ ...prev, [k]: getApiCallErrorMessage(result) }));
        } else {
          setTestStatuses((prev) => ({ ...prev, [k]: 'success' }));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setTestStatuses((prev) => ({ ...prev, [k]: 'error' }));
        setTestStatusCodes((prev) => ({ ...prev, [k]: 504 }));
        setTestErrors((prev) => ({ ...prev, [k]: msg }));
      }
    },
    []
  );

  const runBatchTests = useCallback(
    async (provider: OpenAIProviderConfig, entryIndices: number[]) => {
      const entries = provider.apiKeyEntries ?? [];
      const validIndices = [...new Set(entryIndices)].filter((idx) => idx >= 0 && idx < entries.length);
      if (validIndices.length === 0) return;

      setTestingAny(true);
      try {
        await Promise.allSettled(
          validIndices.map((idx) => {
            const entry = entries[idx];
            return testEntry(provider, entry);
          })
        );
      } finally {
        setTestingAny(false);
      }
    },
    [testEntry]
  );

  const handleTestSelected = useCallback(async () => {
    if (!selectedProvider || selectedIndices.length === 0) return;
    await runBatchTests(selectedProvider, selectedIndices);
  }, [runBatchTests, selectedIndices, selectedProvider]);

  const handleTestAll = useCallback(async () => {
    if (!selectedProvider) return;
    const entries = selectedProvider.apiKeyEntries ?? [];
    await runBatchTests(
      selectedProvider,
      entries.map((_, idx) => idx)
    );
  }, [runBatchTests, selectedProvider]);

  /* ── 编辑抽屉：测试单条密钥 ───────────────────────────────────────── */
  const handleTestApiKeyInDrawer = useCallback(
    async (
      realIdx: number,
      params: { baseUrl: string; apiKey: string; headers: Record<string, string>; authIndex?: string }
    ) => {
      setApiKeyTestStatuses((prev) => ({ ...prev, [realIdx]: { state: 'loading' } }));
      try {
        const trimmedBase = params.baseUrl.replace(/\/+$/, '');
        const endpoint = buildOpenAIChatCompletionsEndpoint(trimmedBase);
        if (!endpoint) {
          setApiKeyTestStatuses((prev) => ({ ...prev, [realIdx]: { state: 'error', message: 'Invalid base URL', statusCode: 504 } }));
          return;
        }
        const entryKey = params.apiKey.trim();
        const resolvedAuthIndex = params.authIndex?.trim() || undefined;
        if (!entryKey && !resolvedAuthIndex) {
          setApiKeyTestStatuses((prev) => ({ ...prev, [realIdx]: { state: 'error', message: 'API key or authIndex required', statusCode: 504 } }));
          return;
        }
        // 使用抽屉中当前选中的提供商的 testModel 或第一个模型名
        const tm = editTarget?.provider.testModel || editTarget?.provider.models?.[0]?.name || 'gpt-3.5-turbo';
        const headerObj: Record<string, string> = {
          'Content-Type': 'application/json',
          ...params.headers,
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
              model: tm,
              messages: [{ role: 'user', content: 'Hi' }],
              stream: false,
              max_tokens: 5,
            }),
          },
          { timeout: 30000 }
        );
        if (result.statusCode < 200 || result.statusCode >= 300) {
          setApiKeyTestStatuses((prev) => ({ ...prev, [realIdx]: { state: 'error', message: getApiCallErrorMessage(result), statusCode: result.statusCode } }));
        } else {
          setApiKeyTestStatuses((prev) => ({ ...prev, [realIdx]: { state: 'success', statusCode: result.statusCode } }));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setApiKeyTestStatuses((prev) => ({ ...prev, [realIdx]: { state: 'error', message: msg, statusCode: 504 } }));
      }
    },
    [editTarget]
  );

  /* ── 编辑抽屉：测试全部密钥 ───────────────────────────────────────── */
  const handleTestAllApiKeysInDrawer = useCallback(
    async (
      params: { baseUrl: string; apiKeyEntries: ApiKeyEntryInput[]; headers: Record<string, string> }
    ) => {
      setTestingAnyInDrawer(true);
      try {
        await Promise.allSettled(
          params.apiKeyEntries.map((entry, idx) => {
            const entryKey = (entry.existingApiKey ?? entry.apiKey) || '';
            if (!entryKey && !entry.authIndex) {
              setApiKeyTestStatuses((prev) => ({ ...prev, [idx]: { state: 'error', message: 'No API key', statusCode: 504 } }));
              return Promise.resolve();
            }
            return handleTestApiKeyInDrawer(idx, {
              baseUrl: params.baseUrl,
              apiKey: entryKey,
              headers: params.headers,
              authIndex: entry.authIndex || undefined,
            });
          })
        );
      } finally {
        setTestingAnyInDrawer(false);
      }
    },
    [handleTestApiKeyInDrawer]
  );

  /* ── 编辑抽屉：拉取模型列表 ───────────────────────────────────────── */
  const handleFetchModelsInDrawer = useCallback(
    async (
      params: { baseUrl: string; apiKey: string; headers: Record<string, string>; authIndex?: string }
    ) => {
      setFetchingModels(true);
      setFetchedModels(undefined);
      try {
        const entryKey = params.apiKey.trim();
        const resolvedAuthIndex = params.authIndex?.trim() || undefined;
        const headerObj: Record<string, string> = { ...params.headers };

        const modelInfos = await modelsApi.fetchV1ModelsViaApiCall(
          params.baseUrl,
          entryKey,
          headerObj,
          resolvedAuthIndex
        );

        if (!modelInfos || modelInfos.length === 0) {
          showNotification(t('providersPage.form.modelsFetchFailed', 'Failed to fetch models'), 'warning');
          return;
        }

        const models = modelInfos.map((m) => ({
          name: m.name,
          alias: m.alias || undefined,
        }));

        setFetchedModels(models);
        showNotification(
          t('providersPage.form.modelsFetched', 'Fetched {{count}} models', { count: models.length }),
          'success'
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        showNotification(
          t('providersPage.form.modelsFetchFailed', 'Failed to fetch models') + ': ' + msg,
          'error'
        );
      } finally {
        setFetchingModels(false);
      }
    },
    [showNotification, t]
  );

  /**
   * Detect duplicates among resolved form entries and check whether any duplicate
   * involves a newly added entry (i.e. the modal should be shown).
   */
  const analyzeDuplicates = useCallback(
    (resolved: Array<{ key: string; isExisting: boolean }>) => {
      const keyIndexMap = new Map<string, number>();
      const duplicateKeys = new Set<string>();
      let involvesNew = false;

      for (let i = 0; i < resolved.length; i++) {
        const { key, isExisting } = resolved[i];
        if (keyIndexMap.has(key)) {
          duplicateKeys.add(key);
          // Check if ANY occurrence of this duplicate involves a new entry
          if (!isExisting || !resolved[keyIndexMap.get(key)!].isExisting) {
            involvesNew = true;
          }
        } else {
          keyIndexMap.set(key, i);
        }
      }

      return { hasDuplicates: duplicateKeys.size > 0, involvesNew };
    },
    []
  );

  /**
   * Build the final ApiKeyEntry[] from form input with a given duplicate resolution strategy.
   */
  const buildFinalEntries = useCallback(
    (
      input: ProviderEntryFormInput,
      strategy: 'keep' | 'dedupAll' | 'dedupNew'
    ): ApiKeyEntry[] => {
      const formEntries = input.apiKeyEntries ?? [];

      if (strategy === 'keep') {
        // Default: keep all as-is
        return formEntries
          .map((e) => ({
            apiKey: (e.apiKey ?? '').trim() || (e.existingApiKey ?? '').trim(),
            proxyUrl: e.proxyUrl || undefined,
            authIndex: e.authIndex || undefined,
          }))
          .filter((e) => !!e.apiKey);
      }

      // Build resolved list with original form index preserved
      const resolved = formEntries
        .map((e, idx) => {
          const key = (e.apiKey ?? '').trim() || (e.existingApiKey ?? '').trim();
          if (!key) return null;
          return { key, formIdx: idx, isExisting: !!e.existingApiKey };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      let keepIndices: Set<number>;

      if (strategy === 'dedupAll') {
        // Strategy 2: Deduplicate ALL entries, first occurrence wins
        const seen = new Set<string>();
        keepIndices = new Set<number>();
        for (const r of resolved) {
          if (!seen.has(r.key)) {
            seen.add(r.key);
            keepIndices.add(r.formIdx);
          }
        }
      } else {
        // Strategy 3 (dedupNew): Keep all existing entries; deduplicate new entries
        // against each other AND against existing entries' keys
        const existingKeys = new Set<string>();
        keepIndices = new Set<number>();
        const newSeen = new Set<string>();

        for (const r of resolved) {
          if (r.isExisting) {
            keepIndices.add(r.formIdx);
            existingKeys.add(r.key);
          }
        }

        for (const r of resolved) {
          if (r.isExisting) continue;
          // Skip if this new key already exists in the existing set or was already added as new
          if (existingKeys.has(r.key) || newSeen.has(r.key)) continue;
          newSeen.add(r.key);
          keepIndices.add(r.formIdx);
        }
      }

      const result: ApiKeyEntry[] = [];
      for (let idx = 0; idx < formEntries.length; idx++) {
        if (!keepIndices.has(idx)) continue;
        const e = formEntries[idx];
        const apiKey = (e.apiKey ?? '').trim() || (e.existingApiKey ?? '').trim();
        if (!apiKey) continue;
        result.push({
          apiKey,
          ...(e.proxyUrl ? { proxyUrl: e.proxyUrl } : {}),
          ...(e.authIndex ? { authIndex: e.authIndex } : {}),
        });
      }
      return result;
    },
    []
  );

  /**
   * Persist the provider update after the form submit (with dedup strategy applied).
   */
  const persistEdit = useCallback(
    async (input: ProviderEntryFormInput, strategy: 'keep' | 'dedupAll' | 'dedupNew') => {
      if (!editTarget) return;
      const { provider, providerIdx } = editTarget;

      const apiKeyEntries = buildFinalEntries(input, strategy);

      const models = (input.models ?? [])
        .filter((m) => m.name.trim())
        .map((m) => ({
          name: m.name.trim(),
          ...(m.alias?.trim() ? { alias: m.alias.trim() } : {}),
        }));

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
        priority: input.priority,
        disabled: input.disabled ?? provider.disabled,
      };

      await updateOpenAIProvider(providerIdx, next);
      setProviders((prev) => prev.map((p, i) => (i === providerIdx ? next : p)));
      setSelectedName(next.name);
      closeSheet();
      showNotification(t('serviceProviders.toast.updateSuccess', 'Provider updated'), 'success');
    },
    [editTarget, buildFinalEntries, closeSheet, showNotification, t]
  );

  const handleFormSubmit = useCallback(
    async (input: ProviderEntryFormInput) => {
      if (!editTarget) return;
      try {
        /* Build resolved entries to detect duplicates */
        const resolved: Array<{ key: string; isExisting: boolean }> = (input.apiKeyEntries ?? [])
          .map((e) => {
            const key = (e.apiKey ?? '').trim() || (e.existingApiKey ?? '').trim();
            if (!key) return null;
            return { key, isExisting: !!e.existingApiKey };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        const { hasDuplicates, involvesNew } = analyzeDuplicates(resolved);

        if (hasDuplicates && involvesNew) {
          // Show the duplicate resolution modal
          setDupPendingInput(input);
          setDupModalOpen(true);
          return;
        }

        // Default strategy: keep duplicates (no new entries involved, or no duplicates at all)
        await persistEdit(input, 'keep');
      } catch {
        showNotification(t('serviceProviders.toast.updateFailed', 'Update failed'), 'error');
      }
    },
    [editTarget, analyzeDuplicates, persistEdit, showNotification, t]
  );

  const handleDupResolve = useCallback(
    async (strategy: 'keep' | 'dedupAll' | 'dedupNew') => {
      setDupModalOpen(false);
      if (!dupPendingInput) return;
      try {
        await persistEdit(dupPendingInput, strategy);
      } catch {
        showNotification(t('serviceProviders.toast.updateFailed', 'Update failed'), 'error');
      } finally {
        setDupPendingInput(null);
      }
    },
    [dupPendingInput, persistEdit, showNotification, t]
  );

  const handleCreateSubmit = useCallback(
    async (input: ProviderEntryFormInput) => {
      const providerName = input.name?.trim() || 'new-provider';
      const normalizedProviderName = providerName.toLocaleLowerCase();
      const duplicateProvider = providers.find(
        (provider) => (provider.name ?? '').trim().toLocaleLowerCase() === normalizedProviderName
      );
      if (duplicateProvider) {
        showNotification(
          t('serviceProviders.toast.duplicateNames', 'Duplicate provider names detected: {{names}}, please modify before proceeding', {
            names: providerName,
          }),
          'warning'
        );
        return;
      }

      try {
        const apiKeyEntries: ApiKeyEntry[] = (input.apiKeyEntries ?? [])
          .map((e) => ({
            apiKey: (e.apiKey ?? '').trim() || (e.existingApiKey ?? '').trim(),
            proxyUrl: e.proxyUrl || undefined,
            authIndex: e.authIndex || undefined,
          }))
          .filter((e) => !!e.apiKey);

        const models = (input.models ?? [])
          .filter((m) => m.name.trim())
          .map((m) => ({
            name: m.name.trim(),
            ...(m.alias?.trim() ? { alias: m.alias.trim() } : {}),
          }));

        const headers: Record<string, string> = {};
        (input.headers ?? []).forEach((h) => {
          if (h.key.trim()) headers[h.key.trim()] = h.value;
        });

        const newProvider: OpenAIProviderConfig = {
          name: providerName,
          baseUrl: (input.baseUrl?.trim() || '').replace(/\/+$/, ''),
          apiKeyEntries,
          models: models.length ? models : undefined,
          headers: Object.keys(headers).length ? headers : undefined,
          testModel: input.testModel?.trim() || undefined,
          prefix: input.prefix?.trim() || undefined,
          disabled: input.disabled ?? false,
        };

        setProviders((prev) => {
          const nextList = [...prev, newProvider];
          void providersApi.saveOpenAIProviders(nextList);
          return nextList;
        });
        setSelectedName(newProvider.name);
        closeSheet();
        showNotification(t('serviceProviders.toast.createSuccess', 'Provider created'), 'success');
      } catch {
        showNotification(t('serviceProviders.toast.createFailed', 'Creation failed'), 'error');
      }
    },
    [closeSheet, providers, showNotification, t]
  );

  const getSelectedExportEntries = useCallback((): ApiKeyEntry[] => {
    if (!selectedProvider) return [];
    const entries = selectedProvider.apiKeyEntries ?? [];
    return selectedIndices.map((idx) => entries[idx]).filter((entry): entry is ApiKeyEntry => Boolean(entry));
  }, [selectedIndices, selectedProvider]);

  const handleImportText = useCallback(
    async (text: string) => {
      if (!selectedProvider) return;
      try {
        const imported = parseImportJson(text);
        const nextEntries = [...(selectedProvider.apiKeyEntries ?? [])];
        const { added, skipped } = mergeEntries(nextEntries, imported);
        const next: OpenAIProviderConfig = { ...selectedProvider, apiKeyEntries: nextEntries };
        setProviders((prev) => {
          const idx = prev.findIndex((p) => p.name === selectedProvider.name);
          if (idx !== -1) void updateOpenAIProvider(idx, next);
          return prev.map((p) => (p.name === selectedProvider.name ? next : p));
        });
        showNotification(
          t('serviceProviders.toast.importSuccess', 'Imported {{added}}, skipped {{skipped}}', {
            added,
            skipped,
          }),
          added > 0 ? 'success' : 'warning'
        );
      } catch (error) {
        showNotification(
          t(
            'serviceProviders.toast.importFailed',
            'Import failed: {{error}}',
            { error: error instanceof Error ? error.message : String(error) }
          ),
          'error'
        );
      }
    },
    [selectedProvider, showNotification, t]
  );

  const handleCopy = useCallback(async () => {
    const entries = getSelectedExportEntries();
    if (!selectedProvider || entries.length === 0) return;
    const json = buildExportJson(entries, selectedProvider.baseUrl ?? '');
    const ok = await copyToClipboard(json);
    if (ok) {
      showNotification(
        t('serviceProviders.toast.copySuccess', 'Copied {{count}} records to clipboard', {
          count: entries.length,
        }),
        'success'
      );
    } else {
      showNotification(t('notification.copy_failed', 'Copy failed'), 'error');
    }
  }, [getSelectedExportEntries, selectedProvider, showNotification, t]);

  const handleExport = useCallback(() => {
    const entries = getSelectedExportEntries();
    if (!selectedProvider || entries.length === 0) return;
    const json = buildExportJson(entries, selectedProvider.baseUrl ?? '');
    const blob = new Blob([json], { type: 'application/json' });
    const safeName = (selectedProvider.name || 'provider').replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadBlob({
      filename: `${safeName}-api-keys-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      blob,
    });
    showNotification(
      t('serviceProviders.toast.exportSuccess', 'Exported {{count}} records', {
        count: entries.length,
      }),
      'success'
    );
  }, [getSelectedExportEntries, selectedProvider, showNotification, t]);

  const handlePaste = useCallback(async () => {
    const text = await readFromClipboard();
    if (text) {
      await handleImportText(text);
      return;
    }
    setPasteText('');
    setPasteModalOpen(true);
  }, [handleImportText]);

  const handleImportFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        await handleImportText(text);
      } catch {
        showNotification(t('serviceProviders.toast.importFailed', 'Import failed'), 'error');
      } finally {
        event.target.value = '';
      }
    },
    [handleImportText, showNotification, t]
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
      <div className={styles.headerRow}>
        <h2 className={styles.title}>{t('serviceProviders.header.title')}</h2>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.headerBtn}
            onClick={() => void handleRefresh()}
            disabled={refreshing}
          >
            {refreshing ? (
              <IconLoader2 size={16} className="spin" />
            ) : (
              <IconRefreshCw size={16} />
            )}
            {refreshing
              ? t('serviceProviders.actions.syncing', 'Syncing...')
              : t('serviceProviders.actions.refresh', 'Refresh')}
          </button>
          <button
            type="button"
            className={styles.headerBtn}
            onClick={openCreateSheet}
          >
            <IconPlus size={16} />
            {t('serviceProviders.actions.newProvider', 'New Provider')}
          </button>
          <button
            type="button"
            className={styles.headerBtn}
            onClick={() => void handleSyncToKeys()}
            disabled={syncBusy}
          >
            {syncBusy ? (
              <IconLoader2 size={16} className="spin" />
            ) : (
              <IconDownload size={16} />
            )}
            {syncBusy
              ? t('serviceProviders.actions.syncing', 'Syncing...')
              : t('serviceProviders.actions.syncToKeys', 'Sync to Key Management')}
          </button>
        </div>
      </div>

      {syncResult && (
        <div className={styles.syncResultBar}>
          {t('serviceProviders.toast.syncSuccess', 'Synced {{synced}} keys ({{skipped}} skipped)', syncResult)}
        </div>
      )}

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
          <div className={styles.sidebarFilterBar}>
            {([
              ['enabled', t('serviceProviders.sidebar.enabledOnly', 'Enabled')],
              ['disabled', t('serviceProviders.sidebar.disabledOnly', 'Disabled')],
              ['all', t('serviceProviders.sidebar.allProviders', 'All')],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`${styles.sidebarFilterBtn}${providerVisibilityFilter === value ? ` ${styles.sidebarFilterBtnActive}` : ''}`}
                onClick={() => setProviderVisibilityFilter(value)}
                aria-pressed={providerVisibilityFilter === value}
              >
                <span className={styles.sidebarFilterLabel}>{label}</span>
                <span className={styles.sidebarFilterCount}>{providerVisibilityCounts[value]}</span>
              </button>
            ))}
          </div>
          <div className={styles.sidebarList}>
            {filteredProviders.map((p) => (
              <button
                key={p.name}
                type="button"
                className={`${styles.sidebarItem}${
                  p.name === selectedName ? ` ${styles.sidebarItemActive}` : ''
                }${duplicateNames.has(p.name) ? ` ${styles.sidebarItemError}` : ''}${p.disabled ? ` ${styles.sidebarItemDisabled}` : ''}`}
                onClick={() => {
                  setSelectedName(p.name);
                }}
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
                <div className={styles.panelDeleteToggle}>
                  <div className={styles.panelDangerGroup}>
                    <button
                      type="button"
                      className={styles.deleteProviderBtn}
                      disabled={testingAny}
                      onClick={handleDeleteProvider}
                      aria-label={t('serviceProviders.actions.deleteProvider', 'Delete provider')}
                      title={t('serviceProviders.actions.deleteProvider', 'Delete provider')}
                    >
                      <IconTrash2 size={14} />
                    </button>
                    <button
                      type="button"
                      className={styles.syncProviderBtn}
                      disabled={syncBusy}
                      onClick={() => handleSyncProviderToKeys(selectedProvider)}
                      title={t('serviceProviders.actions.syncProviderToKeys', 'Sync this provider to Key Management')}
                    >
                      {syncBusy ? (
                        <IconLoader2 size={14} className="spin" />
                      ) : (
                        <IconDownload size={14} />
                      )}
                    </button>
                  </div>
                  <ToggleSwitch
                    checked={!selectedProvider.disabled}
                    onChange={handleToggleProviderDisabled}
                    label={
                      selectedProvider.disabled
                        ? t('serviceProviders.panel.disabled', 'Disabled')
                        : t('serviceProviders.panel.enabled', 'Enabled')
                    }
                    ariaLabel={t('serviceProviders.panel.toggleDisable', 'Toggle provider status')}
                    disabled={testingAny}
                  />
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
                  <select
                    className={styles.filterSelect}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">{t('serviceProviders.filter.all', 'All')}</option>
                    {statusFilterOptions.map((code) => (
                      <option key={code} value={code}>{code}</option>
                    ))}
                  </select>
                  {selectedCount > 0 && (
                    <div className={styles.selectionSummary}>
                      <span className={styles.selectionBadge}>
                        {t('serviceProviders.panel.selectedCount', '{{count}} selected', {
                          count: selectedCount,
                        })}
                      </span>
                      <button
                        type="button"
                        className={styles.selectionClearBtn}
                        onClick={clearSelection}
                      >
                        {t('serviceProviders.actions.clearSelection', 'Clear Selection')}
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className={styles.testAllBtn}
                    onClick={handleTestSelected}
                    disabled={testingAny || selectedCount === 0}
                  >
                    {testingAny ? (
                      <IconLoader2 size={14} className="spin" />
                    ) : (
                      <IconCheckCircle2 size={14} />
                    )}
                    {t('serviceProviders.actions.testSelected', 'Test Selected ({{count}})', {
                      count: selectedCount,
                    })}
                  </button>
                  <BatchMoveDropdown
                    provider={selectedProvider}
                    allProviders={providers}
                    onMove={handleBatchMove}
                    disabled={testingAny || selectedCount === 0}
                    selectedCount={selectedCount}
                  />
                  <button
                    type="button"
                    className={`${styles.testAllBtn} ${styles.toolbarDangerBtn}`}
                    onClick={handleBatchDelete}
                    disabled={testingAny || selectedCount === 0}
                  >
                    <IconTrash2 size={14} />
                    {t('serviceProviders.actions.deleteSelected', 'Delete Selected ({{count}})', {
                      count: selectedCount,
                    })}
                  </button>
                  {selectedCount > 0 && (
                    <>
                      <button
                        type="button"
                        className={styles.testAllBtn}
                        onClick={handleCopy}
                        disabled={testingAny || selectedCount === 0}
                      >
                        <IconFileText size={14} />
                        {t('serviceProviders.actions.copy', 'Copy ({{count}})', {
                          count: selectedCount,
                        })}
                      </button>
                      <button
                        type="button"
                        className={styles.testAllBtn}
                        onClick={handleExport}
                        disabled={testingAny || selectedCount === 0}
                      >
                        <IconDownload size={14} />
                        {t('serviceProviders.actions.export', 'Export ({{count}})', {
                          count: selectedCount,
                        })}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={styles.testAllBtn}
                    onClick={handlePaste}
                    disabled={testingAny}
                  >
                    <IconFileText size={14} />
                    {t('serviceProviders.actions.paste', 'Paste')}
                  </button>
                  <button
                    type="button"
                    className={styles.testAllBtn}
                    onClick={() => importFileInputRef.current?.click()}
                    disabled={testingAny}
                  >
                    <IconDownload size={14} />
                    {t('serviceProviders.actions.import', 'Import')}
                  </button>
                  <input
                    ref={importFileInputRef}
                    type="file"
                    accept=".json"
                    hidden
                    onChange={handleImportFileChange}
                  />
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
              <div className={styles.tableScrollWrap}>
              <Table
                key={selectedProvider?.name ?? 'provider-table'}
                cols={
                  <>
                    {['4%', '5%', '9%', '18%', '16%', '12%', '22%', '14%'].map((w, i) => (
                      <col key={i} style={{ width: w }} />
                    ))}
                  </>
                }
              >
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <SelectionCheckbox
                        checked={allVisibleSelected}
                        onChange={handleToggleAllVisible}
                        ariaLabel={t('serviceProviders.table.selectAll', 'Select all entries')}
                        disabled={filteredEntryIndices.length === 0}
                        className={styles.tableCheckbox}
                      />
                    </TableHead>
                    <TableHead>#</TableHead>
                    <TableHead>{t('serviceProviders.table.priority', 'Priority')}</TableHead>
                    <TableHead>{t('serviceProviders.table.apiKey')}</TableHead>
                    <TableHead>{t('serviceProviders.table.proxyUrl')}</TableHead>
                    <TableHead>{t('serviceProviders.table.status')}</TableHead>
                    <TableHead>{t('serviceProviders.table.statusDesc')}</TableHead>
                    <TableHead alignRight>
                      {t('serviceProviders.table.actions', 'Actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        style={{
                          textAlign: 'center',
                          color: 'var(--muted-foreground)',
                        }}
                      >
                        {t('serviceProviders.table.empty', 'No entries')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredEntries.map((entry, visualIdx) => {
                      const realIdx = (selectedProvider.apiKeyEntries ?? []).indexOf(entry);
                      const k = keyOf(selectedProvider, entry);
                      const status = testStatuses[k];
                      const statusCode = testStatusCodes[k];
                      const error = testErrors[k];
                      const isSelected = selectedEntryIndices.has(realIdx);
                      return (
                        <TableRow key={k} selected={isSelected}>
                          <TableCell className={styles.tableCheckboxCell}>
                            <SelectionCheckbox
                              checked={isSelected}
                              onChange={(checked) => toggleEntrySelection(realIdx, checked)}
                              ariaLabel={t('serviceProviders.table.selectRow', 'Select row {{index}}', {
                                index: visualIdx + 1,
                              })}
                              className={styles.tableCheckbox}
                            />
                          </TableCell>
                          <TableCell>
                            <span className={styles.idxCell}>{visualIdx + 1}</span>
                          </TableCell>
                          <TableCell>
                            <span className={styles.idxCell}>{selectedProvider.priority ?? 0}</span>
                          </TableCell>
                          <TableCell>
                            <span className={styles.apiKeyCell}>
                              {showAllKeys ? entry.apiKey : maskKey(entry.apiKey)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={styles.proxyCell}>
                              {(entry.proxyUrl as string | undefined) ||
                                (selectedProvider.proxyUrl as string | undefined) ||
                                '—'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={styles.statusCell}>
                              {status === 'loading' && (
                                <span className={`${styles.statusBadge} ${styles.statusLoading}`}>
                                  <IconLoader2 size={12} className="spin" />
                                  {t('serviceProviders.status.testing', 'Testing...')}
                                </span>
                              )}
                              {status === 'success' && statusCode !== undefined && (
                                <span className={`${styles.statusBadge} ${styles.statusSuccess}`} title={error || ''}>
                                  {statusCode}
                                </span>
                              )}
                              {status === 'error' && statusCode !== undefined && (
                                <span className={`${styles.statusBadge} ${styles.statusError}`} title={error || ''}>
                                  {statusCode}
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
                                onClick={() => testEntry(selectedProvider, entry)}
                                disabled={testingAny}
                                title={t('serviceProviders.actions.testSingle', 'Test')}
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
                                title={t('serviceProviders.actions.deleteSingle', 'Delete')}
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
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>{t('serviceProviders.emptyState', 'Select a provider from the sidebar')}</div>
          )}
        </div>
      </div>

      {/* ─── Edit / Create sheet ──────────────────────────────────────────── */}
      {(sheetMode === 'edit' ? !!editTarget : true) && (
        <Sheet
          open={sheetOpen}
          onClose={closeSheet}
          title={
            sheetMode === 'create'
              ? t('providersPage.form.createEyebrow', 'New')
              : t('providersPage.form.editEyebrow', 'Edit')
          }
          footer={
            <>
              <button
                type="submit"
                form={editFormId}
                className={`${formStyles.footerBtn} ${formStyles.footerBtnPrimary}`}
                disabled={editSubmitting}
              >
                {editSubmitting ? (
                  <IconLoader2 size={14} />
                ) : null}
                {sheetMode === 'create'
                  ? t('providersPage.actions.create', 'Create')
                  : t('providersPage.actions.save', 'Save')}
              </button>
              <button
                type="button"
                className={`${formStyles.footerBtn} ${formStyles.footerBtnGhost}`}
                onClick={closeSheet}
                disabled={editSubmitting}
              >
                {t('common.cancel', 'Cancel')}
              </button>
            </>
          }
          closeDisabled={editSubmitting}
        >
          <BaseProviderForm
            brand="openaiCompatibility"
            resource={
              sheetMode === 'edit' && editTarget
                ? buildEditResource(editTarget.provider, editTarget.providerIdx)
                : null
            }
            mode={sheetMode}
            mutating={editSubmitting}
            formId={editFormId}
            proxyServiceBaseUrl={baseUrl}
            proxyManagementKey={managementKey}
            onSubmit={async (input) => {
              setEditSubmitting(true);
              try {
                if (sheetMode === 'create') {
                  await handleCreateSubmit(input);
                } else {
                  await handleFormSubmit(input);
                }
              } finally {
                setEditSubmitting(false);
              }
            }}
            renderEntryCardExtra={
              sheetMode === 'edit' && editTarget
                ? (realIdx) => (
                    <MoveDropdown
                      provider={editTarget.provider}
                      allProviders={providers}
                      onMove={(target) => handleMoveFromDrawer(realIdx, target)}
                      disabled={false}
                    />
                  )
                : undefined
            }
            onTestApiKey={handleTestApiKeyInDrawer}
            testingApiKeyIdx={
              Object.entries(apiKeyTestStatuses).find(([, s]) => s.state === 'loading')?.[0] != null
                ? Number(Object.entries(apiKeyTestStatuses).find(([, s]) => s.state === 'loading')![0])
                : null
            }
            apiKeyTestStatus={apiKeyTestStatuses}
            onTestAllApiKeys={handleTestAllApiKeysInDrawer}
            testingAnyApiKey={testingAnyInDrawer}
            onFetchModels={handleFetchModelsInDrawer}
            fetchingModels={fetchingModels}
            fetchedModels={fetchedModels}
          />
        </Sheet>
      )}

      <Modal
        open={pasteModalOpen}
        title={t('serviceProviders.pasteModal.title', 'Import from Clipboard')}
        onClose={() => setPasteModalOpen(false)}
        footer={
          <>
            <button
              type="button"
              className={`${formStyles.footerBtn} ${formStyles.footerBtnGhost}`}
              onClick={() => setPasteModalOpen(false)}
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              className={`${formStyles.footerBtn} ${formStyles.footerBtnPrimary}`}
              onClick={async () => {
                const text = pasteText.trim();
                if (!text) return;
                setPasteModalOpen(false);
                await handleImportText(text);
                setPasteText('');
              }}
            >
              {t('serviceProviders.actions.confirmImport', 'Confirm Import')}
            </button>
          </>
        }
      >
        <textarea
          className={styles.pasteTextarea}
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          placeholder={t(
            'serviceProviders.pasteModal.placeholder',
            'Paste JSON data here...'
          )}
        />
      </Modal>

      {/* ─── Duplicate Key Resolution Modal ─────────────────────────────── */}
      <Modal
        open={dupModalOpen}
        title={t(
          'serviceProviders.dupModal.title',
          '检测到重复的密钥'
        )}
        onClose={() => {
          setDupModalOpen(false);
          setDupPendingInput(null);
        }}
        footer={
          <>
            <button
              type="button"
              className={`${formStyles.footerBtn} ${formStyles.footerBtnPrimary}`}
              onClick={() => void handleDupResolve('keep')}
            >
              {t('serviceProviders.dupModal.keep', '保留重复')}
            </button>
            <button
              type="button"
              className={`${formStyles.footerBtn} ${formStyles.footerBtnGhost}`}
              onClick={() => void handleDupResolve('dedupAll')}
            >
              {t('serviceProviders.dupModal.dedupAll', '删除去重')}
            </button>
            <button
              type="button"
              className={`${formStyles.footerBtn} ${formStyles.footerBtnGhost}`}
              onClick={() => void handleDupResolve('dedupNew')}
            >
              {t('serviceProviders.dupModal.dedupNew', '覆盖去重')}
            </button>
          </>
        }
      >
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          {t(
            'serviceProviders.dupModal.desc',
            '新添加的密钥与已有密钥或其他新增密钥存在重复记录。请选择处理方式：'
          )}
        </p>
        <ul style={{ margin: '8px 0 0 16px', lineHeight: 1.8 }}>
          <li>
            <strong>{t('serviceProviders.dupModal.keep', '保留重复')}</strong>
            {' — '}
            {t(
              'serviceProviders.dupModal.keepDesc',
              '保留所有密钥记录，不做去重处理'
            )}
          </li>
          <li>
            <strong>{t('serviceProviders.dupModal.dedupAll', '删除去重')}</strong>
            {' — '}
            {t(
              'serviceProviders.dupModal.dedupAllDesc',
              '所有密钥记录（包括已有和新增）均去重，仅保留各密钥的首次出现'
            )}
          </li>
          <li>
            <strong>{t('serviceProviders.dupModal.dedupNew', '覆盖去重')}</strong>
            {' — '}
            {t(
              'serviceProviders.dupModal.dedupNewDesc',
              '保留已有密钥记录不变；新增密钥若与已有或其它已保留新增重复则丢弃'
            )}
          </li>
        </ul>
      </Modal>
    </div>
  );
}
