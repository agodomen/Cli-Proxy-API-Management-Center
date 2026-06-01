import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import {
  listKeys,
  getKey,
  createKey,
  updateKey,
  deleteKey,
  listProviders,
  listChannels,
  getKeyFullParam,
  batchDeleteKeys,
  batchToggleKeys,
  createProvider,
  updateProvider,
  queryKeyByFileName,
  upsertKey,
  formatCharitableApiError,
  listKeyStatusCounts,
} from './api';
import { getStatusDescription, getStatusInfo, type ProtocolKey } from './types';
import { computeApiType, parseApiType, maskKey } from './utils';
import type { APIKey, Provider, Channel, ListParams, ProxyDetail, KeyStatusCount } from './types';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../serviceProviders/ui/Table';
import { Sheet } from '../serviceProviders/ui/Sheet';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import {
  IconPlus,
  IconPencil,
  IconTrash2,
  IconSearch,
  IconRefreshCw,
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconDownload,
  IconCheckCircle2,
} from '../serviceProviders/ui/icons';
import { AuthInfoEditor } from './components/AuthInfoEditor';
import { ParamEditor } from './components/ParamEditor/ParamEditor';
import { ProviderCombobox } from './components/ProviderCombobox';
import { ProxyCombobox } from './components/ProxyCombobox';
import { mergeParamObjects, tryParseParamObject } from './components/ParamEditor/paramUtils';
import { modelsApi } from '@/services/api/models';
import { ModelDiscoveryPanel } from '../serviceProviders/ui/ModelDiscoveryPanel';
import { HeadersEditor } from '@/external/components/ui/HeadersEditor';
import { useHeaderPresets } from '@/external/hooks/useHeaderPresets';
import { buildHeaderObject, type HeaderEntry } from '@/utils/headers';
import { AccountImportModal } from '@/external/features/requestMonitor/accountImport/AccountImportModal';
import type { AccountImportResult } from '@/external/features/requestMonitor/accountImport/accountImportConverter';
import { buildAuthInfo, buildImportedAuthDetail, parseAuthInfo } from './authInfo';
import { ensureProviderForCredential, resolveImportedProvider } from './providerCatalog';
import {
  filterKeysByProbeStrategy,
  listAllFilteredKeys,
  probeKeysAndPersistWithOptions,
  runKeyAvailabilityProbe,
  type BatchProbeProgress,
  type ProbeAutoActionMode,
  type ProbeStrategy,
} from './keyProbeService';
import { BatchProbeModal } from './components/BatchProbeModal';
import { syncProviderToCpa } from './cpaProviderSync';
import { syncAuthFilesToKeys, type AuthFileSyncProgress } from './authFileSync';
import {
  getAuthFileDisplayMeta,
  isAuthFileCredential,
  pushAuthDetailToAuthFile,
  pushAuthDetailsToAuthFiles,
  stampAuthInfoPushedAt,
  summarizeAuthFilePushSelection,
  type AuthFilePushMetadata,
  type AuthFilePushProgress,
} from './authFilePush';
import { AuthFileSyncProgressModal } from './components/AuthFileSyncProgressModal';
import { getProbeStatusAfterResult } from './probeStatus';
import styles from './CharitablePage.module.scss';

// ── Probe (probe key availability) ──
interface ProbeModel {
  name: string;
  alias?: string;
  image?: boolean;
  thinkingJson?: string;
}

interface ProbeFormState {
  proxyUrl: string;
  models: ProbeModel[];
  headers: HeaderEntry[];
}


function randomMathPrompt(): string {
  const randomInt = (min: number, max: number) => {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const value = new Uint32Array(1);
      crypto.getRandomValues(value);
      return min + (value[0] % (max - min + 1));
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  };
  const a = randomInt(100, 99999);
  const b = randomInt(100, 99999);
  return `Compute ${a}+${b} and reply with only the number.`;
}

// Effective probe validity: HTTP 200 and the body parses as non-empty JSON.
// This mirrors the key-debug inspection behavior for valid responses.
interface KeysPageProps {
  headerCenter?: ReactNode;
  editRequestId?: number;
  onEditRequestHandled?: () => void;
}

type KeyStatusDomain = 'valid' | 'unknown' | 'expired' | 'disabled';
type KeyStatusFilter = 'all' | KeyStatusDomain | `exact:${number}`;
type CredentialKindFilter = 'all' | 'auth_file' | 'api_key';

function applyKeyStatusFilter(
  params: Pick<ListParams, 'status' | 'status_domain'>,
  filter: KeyStatusFilter
) {
  if (filter.startsWith('exact:')) {
    const status = Number(filter.slice('exact:'.length));
    if (Number.isInteger(status)) params.status = status;
    return;
  }
  if (
    filter === 'valid' ||
    filter === 'unknown' ||
    filter === 'expired' ||
    filter === 'disabled'
  ) {
    params.status_domain = filter;
  }
}

function statusFilterLabel(
  status: number,
  count: number,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  const description = getStatusDescription(status);
  const semantic = t(description.key, description.values);
  return `${status} · ${semantic} (${count})`;
}

function formatAuthFileTime(value: number | null) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '';
  }
}

function credentialTypeLabel(key: APIKey) {
  const meta = getAuthFileDisplayMeta(key);
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
}

export function KeysPage({ headerCenter, editRequestId, onEditRequestHandled }: KeysPageProps) {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore((s) => s.serviceBase);
  const managementKey = useAuthStore((s) => s.managementKey);
  const { showNotification, showConfirmation } = useNotificationStore();

  const [items, setItems] = useState<APIKey[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<number[]>([]);
  const [statusFilter, setStatusFilter] = useState<KeyStatusFilter>('all');
  const [statusCounts, setStatusCounts] = useState<KeyStatusCount[]>([]);
  const [credentialKindFilter, setCredentialKindFilter] = useState<CredentialKindFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [loading, setLoading] = useState(false);

  // Selection
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Visibility
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  // Sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit'>('create');
  const [editTarget, setEditTarget] = useState<APIKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formApiKey, setFormApiKey] = useState('');
  const [formProtocols, setFormProtocols] = useState<ProtocolKey[]>(['openai']);
  const [formStatus, setFormStatus] = useState(1);
  const [formPriority, setFormPriority] = useState(0);
  const [formProviderId, setFormProviderId] = useState<number | ''>('');
  const [formContent, setFormContent] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formAuthInfo, setFormAuthInfo] = useState('{}');
  const [formAuthInfoValid, setFormAuthInfoValid] = useState(true);
  const [formParam, setFormParam] = useState('{}');
  const [formParamValid, setFormParamValid] = useState(true);

  // Full param modal
  const [fullParamTarget, setFullParamTarget] = useState<number | null>(null);
  const [fullParamData, setFullParamData] = useState<Record<string, unknown> | null>(null);
  const [fullParamLoading, setFullParamLoading] = useState(false);

  // Hover preview: tooltip appears next to the mouse cursor with a 120ms delay
  // so it doesn't flash when the mouse quickly passes over rows. Once visible,
  // it stays until the mouse leaves both the row and the tooltip itself.
  const [mergedDataCache, setMergedDataCache] = useState<Record<number, Record<string, unknown>>>(
    {}
  );
  const [hoverTarget, setHoverTarget] = useState<{ id: number; x: number; y: number } | null>(null);
  const [hoverVisible, setHoverVisible] = useState(false);
  const hoverShowTimer = useRef<number | null>(null);
  const hoverLeaveTimer = useRef<number | null>(null);
  const hoverTooltipRef = useRef<HTMLDivElement | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [authFileSyncOpen, setAuthFileSyncOpen] = useState(false);
  const [authFileSyncBusy, setAuthFileSyncBusy] = useState(false);
  const [authFileSyncProgress, setAuthFileSyncProgress] = useState<AuthFileSyncProgress | null>(null);
  const authFileSyncAbortRef = useRef<AbortController | null>(null);
  const [authFilePushOpen, setAuthFilePushOpen] = useState(false);
  const [authFilePushBusy, setAuthFilePushBusy] = useState(false);
  const [authFilePushProgress, setAuthFilePushProgress] = useState<AuthFilePushProgress | null>(null);
  const authFilePushAbortRef = useRef<AbortController | null>(null);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<APIKey | null>(null);

  // ── Probe (detect key availability + update provider config) ──
  const [probeSheetOpen, setProbeSheetOpen] = useState(false);
  const [probeTarget, setProbeTarget] = useState<APIKey | null>(null);
  const [probeForm, setProbeForm] = useState<ProbeFormState>({
    proxyUrl: '',
    models: [{ name: '', alias: '', image: false, thinkingJson: '' }],
    headers: [{ key: '', value: '' }],
  });
  const [probePrompt, setProbePrompt] = useState(() => randomMathPrompt());
  const [probeSelectedProxy, setProbeSelectedProxy] = useState<ProxyDetail | null>(null);
  const [probeFetching, setProbeFetching] = useState(false);
  const [probeTestingKey, setProbeTestingKey] = useState(false);
  const [probeTestResult, setProbeTestResult] = useState<{
    state: 'idle' | 'success' | 'error';
    message?: string;
    statusCode?: number;
  }>({ state: 'idle' });
  const [probeSubmitting, setProbeSubmitting] = useState(false);
  const [probeDiscoveryOpen, setProbeDiscoveryOpen] = useState(false);
  const { commonParams, presets: probeHeaderPresets, reload: reloadHeaderPresets } = useHeaderPresets();
  const [probeHasFetched, setProbeHasFetched] = useState(false);
  const [probeFetchedModels, setProbeFetchedModels] = useState<
    Array<{ name: string; alias?: string }>
  >([]);
  const [probeModelTestStatuses, setProbeModelTestStatuses] = useState<
    Record<
      string,
      { state: 'idle' | 'loading' | 'success' | 'error'; message?: string; statusCode?: number }
    >
  >({});
  const [batchProbing, setBatchProbing] = useState(false);
  const [batchProbeOpen, setBatchProbeOpen] = useState(false);
  const [batchProbeMode, setBatchProbeMode] = useState<'filtered' | 'selected'>('filtered');
  const [batchProbeConcurrency, setBatchProbeConcurrency] = useState(16);
  const [batchProbeStrategy, setBatchProbeStrategy] = useState<ProbeStrategy>('all');
  const [batchProbeTimeoutMs, setBatchProbeTimeoutMs] = useState(15000);
  const [batchProbeUserAgent, setBatchProbeUserAgent] = useState('');
  const [batchProbeAutoAction, setBatchProbeAutoAction] = useState<ProbeAutoActionMode>('status_only');
  const [batchProbeProgress, setBatchProbeProgress] = useState<BatchProbeProgress | null>(null);
  const [batchProbeTargetCount, setBatchProbeTargetCount] = useState(0);
  const batchProbeAbortRef = useRef<AbortController | null>(null);

  const pageSize = 20;

  const fetchProviders = useCallback(async () => {
    if (!baseUrl) return;
    try {
      const result = await listProviders(baseUrl, { page: 1, page_size: 500, status: 'all' }, managementKey);
      setProviders(result.items || []);
    } catch {
      /* ignore */
    }
  }, [baseUrl, managementKey]);

  const fetchChannels = useCallback(async () => {
    if (!baseUrl) return;
    try {
      const result = await listChannels(baseUrl, { page: 1, page_size: 500 }, managementKey);
      setChannels(result.items || []);
    } catch {
      /* ignore */
    }
  }, [baseUrl, managementKey]);

  const fetchData = useCallback(async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const params: ListParams = { page, page_size: pageSize };
      if (search) params.search = search;
      if (providerFilter.length === 1) params.provider_id = providerFilter[0];
      if (providerFilter.length > 1) params.provider_ids = providerFilter;
      applyKeyStatusFilter(params, statusFilter);
      if (credentialKindFilter !== 'all') params.credential_kind = credentialKindFilter;
      const priority = Number(priorityFilter);
      if (priorityFilter.trim() !== '' && Number.isFinite(priority)) params.priority = priority;
      const result = await listKeys(baseUrl, params, managementKey);
      setItems(result.items || []);
      setTotalItems(result.total_items);
    } catch {
      showNotification(t('charitable.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [
    baseUrl,
    managementKey,
    page,
    search,
    providerFilter,
    statusFilter,
    credentialKindFilter,
    priorityFilter,
    showNotification,
    t,
  ]);

  const fetchStatusCounts = useCallback(async () => {
    if (!baseUrl) return;
    try {
      const params: Omit<ListParams, 'page' | 'page_size' | 'status' | 'status_domain'> = {};
      if (search) params.search = search;
      if (providerFilter.length === 1) params.provider_id = providerFilter[0];
      if (providerFilter.length > 1) params.provider_ids = providerFilter;
      if (credentialKindFilter !== 'all') params.credential_kind = credentialKindFilter;
      const priority = Number(priorityFilter);
      if (priorityFilter.trim() !== '' && Number.isFinite(priority)) params.priority = priority;
      setStatusCounts(await listKeyStatusCounts(baseUrl, params, managementKey));
    } catch {
      // The main list remains usable if this auxiliary filter data cannot load.
      setStatusCounts([]);
    }
  }, [baseUrl, credentialKindFilter, managementKey, priorityFilter, providerFilter, search]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);
  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);
  useEffect(() => {
    fetchData();
    setSelected(new Set());
  }, [fetchData]);
  useEffect(() => {
    void fetchStatusCounts();
  }, [fetchStatusCounts]);


  const openCreate = () => {
    setSheetMode('create');
    setEditTarget(null);
    setFormApiKey('');
    setFormProtocols(['openai']);
    setFormAuthInfo(buildAuthInfo(1, ['openai']));
    setFormAuthInfoValid(true);
    setFormStatus(1);
    setFormPriority(0);
    setFormProviderId('');
    setFormContent('');
    setFormRemark('');
    setFormParam('{}');
    setFormParamValid(true);
    setSheetOpen(true);
  };

  const openEdit = (k: APIKey) => {
    setSheetMode('edit');
    setEditTarget(k);
    setFormApiKey(k.auth_value || k.api_key || '');
    setFormProtocols(parseApiType(k.api_type ?? parseAuthInfo(k.auth_info).api_type));
    setFormStatus(k.status);
    setFormPriority(k.priority);
    setFormProviderId(k.provider_id ?? '');
    setFormContent(k.content || '');
    setFormRemark(k.remark || '');
    setFormParam(k.param || '{}');
    setFormParamValid(true);
    setFormAuthInfo(k.auth_info || '{}');
    setFormAuthInfoValid(true);
    setSheetOpen(true);
  };

  useEffect(() => {
    if (!baseUrl || !editRequestId) return;
    let active = true;
    void getKey(baseUrl, editRequestId, managementKey)
      .then((key) => {
        if (!active) return;
        openEdit(key);
      })
      .catch(() => {
        if (active) showNotification(t('charitable.loadFailed'), 'error');
      })
      .finally(() => {
        if (active) onEditRequestHandled?.();
      });
    return () => {
      active = false;
    };
  }, [baseUrl, editRequestId, managementKey, onEditRequestHandled, showNotification, t]);

  const buildKeyFormInput = useCallback(() => {
    const authType = sheetMode === 'edit' ? editTarget?.auth_type ?? 1 : 1;
    const infoProtocols =
      formProtocols.length > 0 ? formProtocols : parseAuthInfo(formAuthInfo).protocols;
    const protocols =
      infoProtocols && infoProtocols.length > 0 ? infoProtocols : (['openai'] as ProtocolKey[]);
    const apiType = computeApiType(protocols);
    return {
      auth_type: authType,
      auth_value: formApiKey.trim(),
      auth_info: buildAuthInfo(authType, protocols, formAuthInfo || editTarget?.auth_info),
      // compatibility aliases for older backends/tools
      api_key: formApiKey.trim(),
      api_type: apiType,
      status: formStatus,
      priority: formPriority,
      provider_id: formProviderId === '' ? null : formProviderId,
      content: formContent.trim() || undefined,
      remark: formRemark.trim() || undefined,
      param: formParam,
    };
  }, [
    editTarget?.auth_info,
    editTarget?.auth_type,
    formApiKey,
    formAuthInfo,
    formContent,
    formParam,
    formPriority,
    formProtocols,
    formProviderId,
    formRemark,
    formStatus,
    sheetMode,
  ]);

  const saveKeyFromForm = useCallback(async (): Promise<APIKey | null> => {
    if (!baseUrl || !formApiKey.trim() || !formParamValid || !formAuthInfoValid) return null;
    const input = buildKeyFormInput();
    if (sheetMode === 'create') {
      return createKey(baseUrl, input, managementKey);
    }
    if (!editTarget) return null;
    return updateKey(baseUrl, editTarget.id, input, managementKey);
  }, [
    baseUrl,
    buildKeyFormInput,
    editTarget,
    formApiKey,
    formAuthInfoValid,
    formParamValid,
    managementKey,
    sheetMode,
  ]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!baseUrl || !formApiKey.trim() || !formParamValid || !formAuthInfoValid) return;
    setSubmitting(true);
    try {
      await saveKeyFromForm();
      showNotification(
        sheetMode === 'create' ? t('charitable.createSuccess') : t('charitable.updateSuccess'),
        'success'
      );
      setSheetOpen(false);
      fetchData();
    } catch {
      showNotification(
        sheetMode === 'create' ? t('charitable.createFailed') : t('charitable.updateFailed'),
        'error'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveAndPushAuthFile = async () => {
    if (!baseUrl || !formApiKey.trim() || !formParamValid || !formAuthInfoValid || authFilePushBusy) {
      return;
    }
    setSubmitting(true);
    try {
      const saved = await saveKeyFromForm();
      if (!saved) {
        throw new Error('save_failed');
      }
      if (!isAuthFileCredential(saved)) {
        showNotification(t('charitable.key.authFilePushNotAuthFile'), 'warning');
        setSheetOpen(false);
        fetchData();
        return;
      }
      const provider =
        providers.find((item) => item.provider_id === saved.provider_id) ||
        (formProviderId === '' ? undefined : providers.find((item) => item.provider_id === formProviderId));
      const result = await pushAuthDetailToAuthFile({
        key: saved,
        provider,
        onPushed: stampPushedAuthInfo,
      });
      showNotification(
        t('charitable.key.authFileSaveAndPushSuccess', { name: result.fileName }),
        'success'
      );
      setSheetOpen(false);
      fetchData();
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
      setSubmitting(false);
    }
  };

  const handleAccountImport = useCallback(
    async (payload: AccountImportResult) => {
      if (!baseUrl || payload.items.length === 0) return;
      setImportSaving(true);
      let added = 0;
      let failed = 0;
      try {
        const providerResult = await listProviders(
          baseUrl,
          { page: 1, page_size: 500, status: 'all' },
          managementKey
        );
        const availableProviders = [...(providerResult.items || [])];
        for (const item of payload.items) {
          try {
            const descriptor = resolveImportedProvider(item, payload.meta.targetFormat);
            const explicitBaseUrl =
              (typeof item.authJson.base_url === 'string' && item.authJson.base_url.trim()) ||
              (typeof item.authJson.baseUrl === 'string' && item.authJson.baseUrl.trim()) ||
              (typeof item.authJson.api_base === 'string' && item.authJson.api_base.trim()) ||
              (typeof item.authJson.apiBase === 'string' && item.authJson.apiBase.trim()) ||
              '';
            let provider: Awaited<ReturnType<typeof ensureProviderForCredential>>['provider'];
            try {
              const ensured = await ensureProviderForCredential(availableProviders, descriptor, {
                preferredBaseUrl: explicitBaseUrl || undefined,
                createProvider: (input) => createProvider(baseUrl, input, managementKey),
              });
              provider = ensured.provider;
            } catch {
              provider = undefined;
            }

            let existing = null as Awaited<ReturnType<typeof queryKeyByFileName>> | null;
            if (item.fileName) {
              try {
                existing = await queryKeyByFileName(baseUrl, item.fileName, managementKey);
              } catch {
                existing = null;
              }
            }

            const detail = buildImportedAuthDetail(item, existing);
            try {
              await upsertKey(
                baseUrl,
                {
                  ...detail,
                  provider_id: provider?.provider_id ?? detail.provider_id ?? existing?.provider_id ?? null,
                },
                managementKey
              );
            } catch (error) {
              // Keep importing credentials even if provider binding is rejected.
              await upsertKey(
                baseUrl,
                {
                  ...detail,
                  provider_id: null,
                },
                managementKey
              );
              void formatCharitableApiError(error);
            }
            added += 1;
          } catch {
            failed += 1;
          }
        }
        if (added === 0) {
          throw new Error(t('charitable.key.importNone'));
        }
        setImportOpen(false);
        setProviders(availableProviders);
        await Promise.all([fetchProviders(), fetchData()]);
        showNotification(
          t('charitable.key.importSuccess', { added, failed, total: payload.items.length }),
          failed > 0 ? 'warning' : 'success'
        );
      } finally {
        setImportSaving(false);
      }
    },
    [baseUrl, fetchData, fetchProviders, managementKey, showNotification, t]
  );

  const handleAuthFileSync = useCallback(async () => {
    if (!baseUrl || authFileSyncBusy) return;
    const controller = new AbortController();
    authFileSyncAbortRef.current = controller;
    setAuthFileSyncBusy(true);
    setAuthFileSyncOpen(true);
    setAuthFileSyncProgress({
      phase: 'listing',
      total: 0,
      current: 0,
      currentName: '',
      created: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
      unmatchedProvider: 0,
      providersCreated: 0,
      failures: [],
    });
    try {
      const result = await syncAuthFilesToKeys({
        serviceBase: baseUrl,
        managementKey,
        providers,
        signal: controller.signal,
        onProgress: (progress) => setAuthFileSyncProgress({ ...progress, failures: [...progress.failures] }),
      });
      await Promise.all([fetchProviders(), fetchData()]);
      if (result.phase === 'cancelled') {
        showNotification(t('charitable.key.authFileSyncCancelled'), 'warning');
      } else if (result.failed > 0) {
        showNotification(
          t('charitable.key.authFileSyncPartial', {
            created: result.created,
            updated: result.updated,
            failed: result.failed,
            providers: result.providersCreated,
            unmatched: result.unmatchedProvider,
          }),
          'warning'
        );
      } else {
        showNotification(
          t('charitable.key.authFileSyncSuccess', {
            created: result.created,
            updated: result.updated,
            providers: result.providersCreated,
            unmatched: result.unmatchedProvider,
          }),
          'success'
        );
      }
    } catch {
      showNotification(t('charitable.key.authFileSyncFailed'), 'error');
      setAuthFileSyncOpen(false);
      setAuthFileSyncProgress(null);
    } finally {
      authFileSyncAbortRef.current = null;
      setAuthFileSyncBusy(false);
    }
  }, [authFileSyncBusy, baseUrl, fetchData, fetchProviders, managementKey, providers, showNotification, t]);

  const handleCancelAuthFileSync = useCallback(() => {
    authFileSyncAbortRef.current?.abort();
  }, []);


  const stampPushedAuthInfo = useCallback(
    async ({
      key,
      fileName,
      managedHeaderKeys,
      managedFields,
      sourceModified,
    }: AuthFilePushMetadata) => {
      if (!baseUrl) return;
      try {
        const nextInfo = stampAuthInfoPushedAt(key.auth_info, fileName, {
          managedHeaderKeys,
          managedFields,
          sourceModified,
        });
        await updateKey(
          baseUrl,
          key.id,
          {
            ...key,
            auth_info: nextInfo,
          },
          managementKey
        );
        setItems((prev) =>
          prev.map((item) => (item.id === key.id ? { ...item, auth_info: nextInfo } : item))
        );
      } catch {
        // Push already succeeded; metadata stamp failure should not fail the action.
      }
    },
    [baseUrl, managementKey]
  );

  const handlePushAuthFile = useCallback(
    async (key: APIKey) => {
      if (authFilePushBusy) return;
      if (!isAuthFileCredential(key)) {
        showNotification(t('charitable.key.authFilePushNotAuthFile'), 'warning');
        return;
      }
      setAuthFilePushBusy(true);
      try {
        const provider = providers.find((item) => item.provider_id === key.provider_id);
        const result = await pushAuthDetailToAuthFile({
          key,
          provider,
          onPushed: stampPushedAuthInfo,
        });
        showNotification(
          t('charitable.key.authFilePushSuccessOne', { name: result.fileName }),
          'success'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'auth_file_name_required') {
          showNotification(t('charitable.key.authFilePushMissingName'), 'error');
        } else if (message === 'auth_value_invalid_json') {
          showNotification(t('charitable.key.authFilePushInvalidValue'), 'error');
        } else {
          showNotification(t('charitable.key.authFilePushFailed'), 'error');
        }
      } finally {
        setAuthFilePushBusy(false);
      }
    },
    [authFilePushBusy, providers, showNotification, stampPushedAuthInfo, t]
  );

  const handleAuthFilePushSelected = useCallback(async () => {
    if (!baseUrl || authFilePushBusy || selected.size === 0) return;
    const selectedKeys = items.filter((item) => selected.has(item.id));
    const summary = summarizeAuthFilePushSelection(selectedKeys);
    if (summary.pushable === 0) {
      showNotification(t('charitable.key.authFilePushNoneSelected'), 'warning');
      return;
    }

    const controller = new AbortController();
    authFilePushAbortRef.current = controller;
    setAuthFilePushBusy(true);
    setAuthFilePushOpen(true);
    setAuthFilePushProgress({
      phase: 'preparing',
      total: selectedKeys.length,
      current: 0,
      currentName: '',
      success: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    });

    try {
      const result = await pushAuthDetailsToAuthFiles({
        keys: selectedKeys,
        providers,
        signal: controller.signal,
        onProgress: (progress) =>
          setAuthFilePushProgress({ ...progress, failures: [...progress.failures] }),
        onPushed: stampPushedAuthInfo,
      });
      if (result.phase === 'cancelled') {
        showNotification(t('charitable.key.authFilePushCancelled'), 'warning');
      } else if (result.failed > 0) {
        showNotification(
          t('charitable.key.authFilePushPartial', {
            success: result.success,
            failed: result.failed,
            skipped: result.skipped,
          }),
          'warning'
        );
      } else {
        showNotification(
          t('charitable.key.authFilePushSuccess', {
            success: result.success,
            skipped: result.skipped,
          }),
          'success'
        );
      }
    } catch {
      showNotification(t('charitable.key.authFilePushFailed'), 'error');
      setAuthFilePushOpen(false);
      setAuthFilePushProgress(null);
    } finally {
      authFilePushAbortRef.current = null;
      setAuthFilePushBusy(false);
    }
  }, [authFilePushBusy, baseUrl, items, providers, selected, showNotification, stampPushedAuthInfo, t]);

  const handleCancelAuthFilePush = useCallback(() => {
    authFilePushAbortRef.current?.abort();
  }, []);



  const handleDelete = async () => {
    if (!baseUrl || !deleteTarget) return;
    try {
      await deleteKey(baseUrl, deleteTarget.id, managementKey);
      showNotification(t('charitable.deleteSuccess'), 'success');
      setDeleteTarget(null);
      fetchData();
    } catch {
      showNotification(t('charitable.deleteFailed'), 'error');
    }
  };

  const handleBatchDelete = () => {
    if (selected.size === 0 || !baseUrl) return;
    showConfirmation({
      message: `${t('charitable.batchDelete')} (${selected.size} ${t('charitable.selected')})`,
      onConfirm: async () => {
        try {
          await batchDeleteKeys(baseUrl, Array.from(selected), managementKey);
          showNotification(t('charitable.deleteSuccess'), 'success');
          setSelected(new Set());
          fetchData();
        } catch {
          showNotification(t('charitable.deleteFailed'), 'error');
        }
      },
    });
  };

  const handleBatchToggle = async (status: number) => {
    if (selected.size === 0 || !baseUrl) return;
    try {
      await batchToggleKeys(baseUrl, Array.from(selected), status, managementKey);
      showNotification(t('charitable.updateSuccess'), 'success');
      setSelected(new Set());
      fetchData();
    } catch {
      showNotification(t('charitable.updateFailed'), 'error');
    }
  };

  const viewFullParam = async (id: number) => {
    if (!baseUrl) return;
    setFullParamTarget(id);
    setFullParamLoading(true);
    try {
      const data = await getKeyFullParam(baseUrl, id, managementKey);
      setFullParamData(data);
    } catch {
      setFullParamData(null);
      showNotification(t('charitable.loadFailed'), 'error');
    } finally {
      setFullParamLoading(false);
    }
  };

  // ── Probe: open the drawer, pre-fill provider config ──────────────────
  const openProbe = useCallback(
    (k: APIKey) => {
      setProbePrompt(randomMathPrompt());
      const provider = providers.find((p) => p.provider_id === k.provider_id);
      const param = tryParseParamObject(provider?.param || '{}') ?? {};
      const proxyUrl = (param.proxy_url as string) || (param.proxyUrl as string) || '';
      const rawModels = Array.isArray(param.models)
        ? (param.models as Array<Record<string, unknown>>)
        : [];
      const models: ProbeModel[] = rawModels.length
        ? rawModels.map((m) => ({
            name: String(m.name ?? ''),
            alias: m.alias ? String(m.alias) : '',
            image: m.image === true,
            thinkingJson: m.thinking ? JSON.stringify(m.thinking, null, 2) : '',
          }))
        : [{ name: '', alias: '', image: false, thinkingJson: '' }];
      setProbeTarget(k);
      const rawHeaders = (param.headers && typeof param.headers === 'object' && !Array.isArray(param.headers))
        ? (param.headers as Record<string, unknown>)
        : {};
      const headers: HeaderEntry[] = Object.entries(rawHeaders).map(([key, value]) => ({
        key,
        value: String(value ?? ''),
      }));
      setProbeForm({ proxyUrl, models, headers: headers.length ? headers : [{ key: '', value: '' }] });
      setProbeSelectedProxy(null);
      setProbeTestResult({ state: 'idle' });
      setProbeSheetOpen(true);
    },
    [providers]
  );

  const closeProbe = useCallback(() => {
    setProbeSheetOpen(false);
    setProbeTarget(null);
    setProbeSelectedProxy(null);
    setProbeFetching(false);
    setProbeTestingKey(false);
    setProbeTestResult({ state: 'idle' });
  }, []);

  const runKeyProbe = useCallback(
    (key: APIKey, models?: ProbeModel[], prompt?: string, headers?: HeaderEntry[]) =>
      runKeyAvailabilityProbe(key, providers, models, prompt, buildHeaderObject(headers)),
    [providers]
  );

  // Probe a single key: send a minimal chat request to verify availability.
  const handleProbeTestKey = useCallback(async () => {
    if (!baseUrl || !probeTarget) return;
    setProbeTestingKey(true);
    setProbeTestResult({ state: 'idle' });
    try {
      const result = await runKeyProbe(probeTarget, probeForm.models, probePrompt, probeForm.headers);
      const nextStatus = getProbeStatusAfterResult(probeTarget.status, result);
      if (result.ok && result.valid) {
        if (nextStatus !== null && nextStatus !== probeTarget.status && baseUrl) {
          try {
            await updateKey(baseUrl, probeTarget.id, { status: nextStatus }, managementKey);
            showNotification(
              t(nextStatus > 0 ? 'charitable.probe.statusValid' : 'charitable.probe.statusUnknown'),
              nextStatus > 0 ? 'success' : 'warning'
            );
            fetchData();
          } catch {
            showNotification(
              t(
                'charitable.probe.statusUpdateFailed',
                'Probe succeeded but failed to update status'
              ),
              'warning'
            );
          }
        } else {
          showNotification(t('charitable.probe.testSuccess', 'Key is available'), 'success');
        }
        setProbeTestResult({ state: 'success', statusCode: result.statusCode });
      } else {
        if (nextStatus !== null && nextStatus !== probeTarget.status && baseUrl) {
          try {
            await updateKey(baseUrl, probeTarget.id, { status: nextStatus }, managementKey);
            showNotification(
              t(nextStatus < 0 ? 'charitable.probe.statusInvalid' : 'charitable.probe.statusUnknown'),
              'warning'
            );
            fetchData();
          } catch {
            showNotification(
              t('charitable.probe.statusUpdateFailed', 'Probe failed and could not update status'),
              'warning'
            );
          }
        }
        setProbeTestResult({
          state: 'error',
          statusCode: result.statusCode,
          message: result.message,
        });
        showNotification(
          t('charitable.probe.testFailed', 'Probe failed: {{code}}', {
            code: String(result.statusCode ?? '-'),
          }),
          'error'
        );
      }
    } finally {
      setProbeTestingKey(false);
    }
  }, [
    baseUrl,
    probeTarget,
    probeForm.models,
    probeForm.headers,
    probePrompt,
    runKeyProbe,
    showNotification,
    t,
    fetchData,
    managementKey,
  ]);

  const openBatchProbeFiltered = useCallback(() => {
    if (!baseUrl || batchProbing || totalItems === 0) return;
    setBatchProbeMode('filtered');
    setBatchProbeTargetCount(totalItems);
    setBatchProbeProgress(null);
    setBatchProbeOpen(true);
    void reloadHeaderPresets();
  }, [baseUrl, batchProbing, reloadHeaderPresets, totalItems]);

  const openBatchProbeSelected = useCallback(() => {
    if (batchProbing || selected.size === 0) return;
    setBatchProbeMode('selected');
    setBatchProbeTargetCount(selected.size);
    setBatchProbeProgress(null);
    setBatchProbeOpen(true);
    void reloadHeaderPresets();
  }, [batchProbing, reloadHeaderPresets, selected.size]);

  const handleCancelBatchProbe = useCallback(() => {
    batchProbeAbortRef.current?.abort();
  }, []);

  const handleStartBatchProbe = useCallback(async () => {
    if (!baseUrl || batchProbing) return;
    const controller = new AbortController();
    batchProbeAbortRef.current = controller;
    setBatchProbing(true);
    setBatchProbeProgress({
      phase: 'preparing',
      total: 0,
      current: 0,
      currentName: '',
      success: 0,
      failed: 0,
      skipped: 0,
      statusChanged: false,
      statusWriteFailed: 0,
      logs: [],
    });

    try {
      let targets: APIKey[] = [];
      if (batchProbeMode === 'selected') {
        targets = items.filter((item) => selected.has(item.id));
      } else {
        const filters: Omit<ListParams, 'page' | 'page_size'> = {};
        if (search) filters.search = search;
        if (providerFilter.length === 1) filters.provider_id = providerFilter[0];
        if (providerFilter.length > 1) filters.provider_ids = providerFilter;
        applyKeyStatusFilter(filters, statusFilter);
        if (credentialKindFilter !== 'all') filters.credential_kind = credentialKindFilter;
        const priority = Number(priorityFilter);
        if (priorityFilter.trim() !== '' && Number.isFinite(priority)) filters.priority = priority;
        targets = await listAllFilteredKeys(baseUrl, filters, managementKey);
      }

      const strategyTargets = filterKeysByProbeStrategy(targets, batchProbeStrategy);
      setBatchProbeTargetCount(strategyTargets.length);
      setBatchProbeProgress({
        phase: 'probing',
        total: strategyTargets.length,
        current: 0,
        currentName: '',
        success: 0,
        failed: 0,
        skipped: 0,
        statusChanged: false,
        statusWriteFailed: 0,
        logs: [],
      });

      const result = await probeKeysAndPersistWithOptions({
        baseUrl,
        managementKey,
        keys: strategyTargets,
        providers,
        concurrency: batchProbeConcurrency,
        strategy: 'all',
        timeoutMs: batchProbeTimeoutMs,
        userAgent: batchProbeUserAgent,
        autoAction: batchProbeAutoAction,
        signal: controller.signal,
        onProgress: (progress) => setBatchProbeProgress({ ...progress, logs: [...progress.logs] }),
      });

      if (result.phase === 'cancelled') {
        showNotification(t('charitable.probe.batchCancelled', '探测已取消'), 'warning');
      } else {
        showNotification(
          t('charitable.probe.batchResult', {
            success: result.success,
            failed: result.failed,
            skipped: result.skipped,
          }),
          result.failed > 0 ? 'warning' : 'success'
        );
      }
      if (result.statusChanged) fetchData();
      if (result.statusChanged) void fetchStatusCounts();
      if (result.statusWriteFailed > 0) {
        showNotification(
          t('charitable.probe.statusWriteFailed', '探测完成，但有 {{count}} 条状态未写回', {
            count: result.statusWriteFailed,
          }),
          'warning'
        );
      }
    } catch {
      showNotification(t('charitable.probe.batchFailed'), 'error');
    } finally {
      batchProbeAbortRef.current = null;
      setBatchProbing(false);
    }
  }, [
    baseUrl,
    batchProbeAutoAction,
    batchProbeConcurrency,
    batchProbeMode,
    batchProbeStrategy,
    batchProbeTimeoutMs,
    batchProbeUserAgent,
    batchProbing,
    credentialKindFilter,
    fetchData,
    items,
    managementKey,
    priorityFilter,
    providerFilter,
    providers,
    search,
    selected,
    showNotification,
    statusFilter,
    t,
  ]);

  // Fetch available models from the provider using the probed key.
  const handleProbeFetchModels = useCallback(async () => {
    if (!probeTarget) return;
    const provider = providers.find((p) => p.provider_id === probeTarget.provider_id);
    const base = (provider?.base_url || '').trim();
    const apiKey = (probeTarget.auth_value || probeTarget.api_key || '').trim();
    if (!base || !apiKey) {
      showNotification(
        t('charitable.probe.fetchNeedKey', 'Base URL and API key required'),
        'error'
      );
      return;
    }
    setProbeFetching(true);
    setProbeHasFetched(false);
    setProbeFetchedModels([]);
    try {
      const modelInfos = await modelsApi.fetchV1ModelsViaApiCall(base, apiKey, {});
      if (!modelInfos || modelInfos.length === 0) {
        showNotification(
          t('providersPage.form.modelsFetchFailed', 'Failed to fetch models'),
          'warning'
        );
        setProbeHasFetched(true);
        return;
      }
      const models = modelInfos.map((m) => ({ name: m.name.trim(), alias: m.alias?.trim() }));
      setProbeFetchedModels(models);
      setProbeHasFetched(true);
      setProbeDiscoveryOpen(true);
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
      setProbeHasFetched(true);
      setProbeDiscoveryOpen(true);
    } finally {
      setProbeFetching(false);
    }
  }, [probeTarget, providers, showNotification, t]);

  // Probe a single model: send a minimal chat request with that model to verify availability.
  const handleProbeTestModel = useCallback(
    async (
      modelName: string,
      onSuccess?: () => void,
      onError?: (status: number, message: string) => void
    ) => {
      if (!baseUrl || !probeTarget) return;
      const provider = providers.find((p) => p.provider_id === probeTarget.provider_id);
      const base = (provider?.base_url || '').trim().replace(/\/+$/, '');
      if (!base || !modelName.trim()) return;
      const apiKey = (probeTarget.auth_value || probeTarget.api_key || '').trim();
      if (!apiKey) return;
      setProbeModelTestStatuses((prev) => ({ ...prev, [modelName]: { state: 'loading' } }));
      try {
        const endpoint = `${base}/v1/chat/completions`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            ...buildHeaderObject(probeForm.headers),
          },
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: 'Hi' }],
            stream: false,
            max_tokens: 5,
          }),
        });
        const statusCode = res.status;
        const text = await res.text().catch(() => '');
        if (statusCode >= 200 && statusCode < 300) {
          setProbeModelTestStatuses((prev) => ({
            ...prev,
            [modelName]: { state: 'success', statusCode },
          }));
          onSuccess?.();
        } else {
          setProbeModelTestStatuses((prev) => ({
            ...prev,
            [modelName]: {
              state: 'error',
              statusCode,
              message: text.slice(0, 300) || `HTTP ${statusCode}`,
            },
          }));
          onError?.(statusCode, text.slice(0, 300) || `HTTP ${statusCode}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setProbeModelTestStatuses((prev) => ({
          ...prev,
          [modelName]: { state: 'error', message: msg, statusCode: 504 },
        }));
        onError?.(504, msg);
      }
    },
    [baseUrl, probeForm.headers, probeTarget, providers]
  );

  // Apply selected models from discovery panel: write them into probeForm.models and auto-test each.
  const handleProbeApplyDiscovered = useCallback(
    (picked: Array<{ name: string; alias?: string }>) => {
      if (!picked.length) return;
      const pickedNames = picked.map((p) => p.name.trim());
      setProbeForm((prev) => {
        // Preserve existing entries' image/thinking config when re-applying.
        const merged: ProbeModel[] = [...prev.models];
        picked.forEach((m) => {
          const name = m.name.trim();
          const existing = merged.find((mm) => mm.name.trim() === name);
          if (existing) {
            existing.alias = m.alias?.trim() || name;
          } else {
            merged.push({ name, alias: m.alias?.trim() || name, image: false, thinkingJson: '' });
          }
        });
        return { ...prev, models: merged };
      });
      setProbeDiscoveryOpen(false);
      // Auto-test each newly applied model.
      picked.forEach((m) => {
        void handleProbeTestModel(m.name.trim());
      });
      showNotification(
        t('charitable.probe.modelsApplied', 'Applied {{count}} models; testing…', {
          count: pickedNames.length,
        }),
        'success'
      );
    },
    [handleProbeTestModel, showNotification, t]
  );

  // Save: update the PROVIDER's param (shared across all keys under it).
  const handleProbeSave = useCallback(async () => {
    if (!baseUrl || !probeTarget) return;
    const provider = providers.find((p) => p.provider_id === probeTarget.provider_id);
    if (!provider) {
      showNotification(t('charitable.probe.noProvider', 'Provider not found'), 'error');
      return;
    }
    setProbeSubmitting(true);
    try {
      const param = tryParseParamObject(provider.param || '{}') ?? {};
      const models = probeForm.models
        .map((m) => {
          const name = m.name.trim();
          if (!name) return null;
          const entry: Record<string, unknown> = { name, alias: m.alias?.trim() || name };
          if (m.image) entry.image = true;
          if (m.thinkingJson?.trim()) {
            try {
              entry.thinking = JSON.parse(m.thinkingJson);
            } catch {
              /* ignore invalid */
            }
          }
          return entry;
        })
        .filter(Boolean) as Array<Record<string, unknown>>;

      const proxyUrl = probeSelectedProxy?.proxy_value.trim() || probeForm.proxyUrl.trim();
      const nextParam: Record<string, unknown> = { ...param };
      if (proxyUrl) nextParam.proxy_url = proxyUrl;
      else delete nextParam.proxy_url;
      nextParam.models = models;
      const headerObj = buildHeaderObject(probeForm.headers);
      if (Object.keys(headerObj).length) nextParam.headers = headerObj;
      else delete nextParam.headers;

      await updateProvider(
        baseUrl,
        provider.provider_id,
        { ...provider, param: JSON.stringify(nextParam) },
        managementKey
      );
      // refresh provider list so inherited config reflects the change
      await fetchProviders();
      showNotification(
        t('charitable.probe.saveSuccess', 'Provider config updated (shared with all keys)'),
        'success'
      );
      closeProbe();
    } catch {
      showNotification(t('charitable.probe.saveFailed', 'Failed to update provider'), 'error');
    } finally {
      setProbeSubmitting(false);
    }
  }, [
    baseUrl,
    probeTarget,
    providers,
    probeForm,
    probeSelectedProxy,
    managementKey,
    fetchProviders,
    showNotification,
    t,
    closeProbe,
  ]);

  // ── Probe form helpers ───────────────────────────────────────────────
  const updateProbeModel = (idx: number, patch: Partial<ProbeModel>) => {
    setProbeForm((prev) => ({
      ...prev,
      models: prev.models.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
    }));
  };
  const removeProbeModel = (idx: number) => {
    setProbeForm((prev) => ({
      ...prev,
      models: prev.models.length > 1 ? prev.models.filter((_, i) => i !== idx) : prev.models,
    }));
  };
  const addProbeModel = () => {
    setProbeForm((prev) => ({
      ...prev,
      models: [...prev.models, { name: '', alias: '', image: false, thinkingJson: '' }],
    }));
  };

  const buildMergedParam = useCallback(
    (k: APIKey): Record<string, unknown> => {
      const provider = providers.find((p) => p.provider_id === k.provider_id);
      const channel = channels.find((c) => c.channel_id === provider?.channel_id);
      // Channel → provider → key, shallow-merge (same as form editor inheritance).
      const merged: Record<string, unknown> = mergeParamObjects(
        tryParseParamObject(channel?.param || '{}') ?? {},
        tryParseParamObject(provider?.param || '{}') ?? {},
        tryParseParamObject(k.param || '{}') ?? {}
      );

      // Provider association fields.
      if (provider) {
        merged.base_url = provider.base_url;
        merged.providerId = provider.provider_id;
        merged.providerName = provider.provider_name;
        merged.providerStatus = provider.status;
      } else if (k.provider_id) {
        merged.providerId = k.provider_id;
      }
      if (channel) {
        merged.channelId = channel.channel_id;
        merged.channelName = channel.channel_name;
        merged.channelStatus = channel.status;
      }

      // Key fields (overwrite inherited when present).
      if (k.auth_value || k.api_key) merged.apiKey = k.auth_value || k.api_key;
      if (k.auth_index) merged.authIndex = k.auth_index;
      if (k.api_type != null) merged.apiType = k.api_type;
      else if (k.auth_info) merged.apiType = parseAuthInfo(k.auth_info).api_type;
      if (k.priority != null) merged.priority = k.priority;
      if (k.content) merged.content = k.content;
      if (k.remark) merged.remark = k.remark;

      // Effective status: key is only valid when its own status AND provider
      // status are both valid (>=1). Missing provider forces invalid.
      const keyStatus = k.status ?? 0;
      const providerStatus = provider?.status ?? -1;
      const effectiveStatus =
        keyStatus >= 1 && providerStatus >= 1 ? keyStatus : Math.min(keyStatus, providerStatus);
      merged.status = keyStatus;
      merged.effectiveStatus = effectiveStatus;
      merged.effectiveValid = effectiveStatus >= 1;

      return merged;
    },
    [providers, channels]
  );

  const getMergedFor = useCallback(
    (id: number): Record<string, unknown> => {
      if (mergedDataCache[id]) return mergedDataCache[id];
      const k = items.find((x) => x.id === id);
      if (!k) return {};
      const data = buildMergedParam(k);
      setMergedDataCache((prev) => ({ ...prev, [id]: data }));
      return data;
    },
    [items, mergedDataCache, buildMergedParam]
  );

  const TOOLTIP_OFFSET_X = 6;
  const TOOLTIP_OFFSET_Y = 4;

  const handleHoverRow = useCallback(
    (id: number | null, clientX?: number, clientY?: number) => {
      // Cancel any pending hide or show.
      if (hoverLeaveTimer.current != null) {
        clearTimeout(hoverLeaveTimer.current);
        hoverLeaveTimer.current = null;
      }
      if (hoverShowTimer.current != null) {
        clearTimeout(hoverShowTimer.current);
        hoverShowTimer.current = null;
      }

      if (id !== null && !mergedDataCache[id]) {
        const k = items.find((item) => item.id === id);
        if (k) {
          const data = buildMergedParam(k);
          setMergedDataCache((prev) => ({ ...prev, [id]: data }));
        }
      }

      if (id !== null) {
        const x = (clientX ?? 0) + TOOLTIP_OFFSET_X;
        const y = (clientY ?? 0) + TOOLTIP_OFFSET_Y;
        setHoverTarget((prev) => {
          if (prev && prev.id === id) {
            return { id, x, y };
          }
          return { id, x, y };
        });
        // Delay showing so quick mouse passes don't flash the tooltip.
        hoverShowTimer.current = window.setTimeout(() => {
          setHoverVisible(true);
        }, 120);
      } else {
        setHoverVisible(false);
        setHoverTarget(null);
      }
    },
    [items, mergedDataCache, buildMergedParam]
  );

  const handleHoverMove = useCallback((clientX: number, clientY: number) => {
    setHoverTarget((prev) => {
      if (!prev) return prev;
      return { ...prev, x: clientX + TOOLTIP_OFFSET_X, y: clientY + TOOLTIP_OFFSET_Y };
    });
  }, []);

  const handleRowLeave = useCallback(() => {
    if (!hoverVisible) {
      if (hoverShowTimer.current != null) {
        clearTimeout(hoverShowTimer.current);
        hoverShowTimer.current = null;
      }
      setHoverTarget(null);
      return;
    }
    // Tooltip is visible — give the user time to move into it.
    hoverLeaveTimer.current = window.setTimeout(() => {
      setHoverVisible(false);
      setHoverTarget(null);
    }, 80);
  }, [hoverVisible]);

  const handleTooltipEnter = useCallback(() => {
    if (hoverLeaveTimer.current != null) {
      clearTimeout(hoverLeaveTimer.current);
      hoverLeaveTimer.current = null;
    }
  }, []);

  const handleTooltipLeave = useCallback(() => {
    hoverLeaveTimer.current = window.setTimeout(() => {
      setHoverVisible(false);
      setHoverTarget(null);
    }, 60);
  }, []);

  useEffect(
    () => () => {
      if (hoverLeaveTimer.current != null) clearTimeout(hoverLeaveTimer.current);
      if (hoverShowTimer.current != null) clearTimeout(hoverShowTimer.current);
    },
    []
  );

  const handleCopyMerged = useCallback(
    async (id: number) => {
      const data = getMergedFor(id);
      try {
        await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        showNotification(t('charitable.key.copiedMerged', 'Copied merged param'), 'success');
      } catch {
        showNotification(t('charitable.copyFailed'), 'error');
      }
    },
    [getMergedFor, showNotification, t]
  );

  const handleSendToCpa = useCallback(
    async (k: APIKey) => {
      if (syncBusy) return;
      const provider = providers.find((p) => p.provider_id === k.provider_id);
      if (!provider) {
        showNotification(
          t('charitable.key.providerRequired', 'Provider is required'),
          'error'
        );
        return;
      }

      setSyncBusy(true);
      try {
        const result = await syncProviderToCpa(baseUrl, managementKey, provider);
        showNotification(
          t('charitable.cpaSync.success', {
            name: result.name,
            count: result.keyCount,
            action: t(result.created ? 'charitable.cpaSync.created' : 'charitable.cpaSync.updated'),
          }),
          result.keyCount > 0 ? 'success' : 'warning'
        );
        setHoverTarget(null);
      } catch {
        showNotification(t('charitable.key.sendToCpaFailed', 'Failed to send to CPA'), 'error');
      } finally {
        setSyncBusy(false);
      }
    },
    [baseUrl, managementKey, providers, showNotification, syncBusy, t]
  );

  const toggleSelectAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((k) => k.id)));
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleReveal = (id: number) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalPages = Math.ceil(totalItems / pageSize);
  const providerMap = Object.fromEntries(providers.map((p) => [p.provider_id, p.provider_name]));
  const selectedProvider = providers.find((provider) => provider.provider_id === formProviderId);
  const selectedChannel = channels.find(
    (channel) => channel.channel_id === selectedProvider?.channel_id
  );
  const inheritedParams = mergeParamObjects(
    tryParseParamObject(selectedChannel?.param || '{}') ?? {},
    tryParseParamObject(selectedProvider?.param || '{}') ?? {},
    selectedProvider?.base_url ? { base_url: selectedProvider.base_url } : {}
  );
  const inheritedLabel = [selectedChannel?.channel_name, selectedProvider?.provider_name]
    .filter(Boolean)
    .join(' → ');

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('charitable.keys')}</h1>
        {headerCenter}
        <div className={styles.actions}>
          <button className={styles.btnSecondary} onClick={fetchData} disabled={loading}>
            <IconRefreshCw size={16} /> {t('charitable.refresh')}
          </button>
          <button
            className={styles.btnSecondary}
            onClick={() => void handleAuthFileSync()}
            disabled={authFileSyncBusy}
          >
            <IconRefreshCw size={16} /> {t('charitable.key.authFileSync')}
          </button>
          <button className={styles.btnSecondary} onClick={() => setImportOpen(true)}>
            <IconDownload size={16} /> {t('charitable.key.import')}
          </button>
          <button className={styles.btnPrimary} onClick={openCreate}>
            <IconPlus size={16} /> {t('charitable.create')}
          </button>
        </div>
      </header>

      <BatchProbeModal
        open={batchProbeOpen}
        running={batchProbing}
        targetCount={batchProbeTargetCount}
        concurrency={batchProbeConcurrency}
        strategy={batchProbeStrategy}
        timeoutMs={batchProbeTimeoutMs}
        userAgent={batchProbeUserAgent}
        autoAction={batchProbeAutoAction}
        progress={batchProbeProgress}
        onConcurrencyChange={setBatchProbeConcurrency}
        onStrategyChange={setBatchProbeStrategy}
        onTimeoutMsChange={setBatchProbeTimeoutMs}
        onUserAgentChange={setBatchProbeUserAgent}
        onAutoActionChange={setBatchProbeAutoAction}
        onStart={() => void handleStartBatchProbe()}
        onCancel={handleCancelBatchProbe}
        onClose={() => {
          if (batchProbing) return;
          setBatchProbeOpen(false);
          setBatchProbeProgress(null);
        }}
        labels={{
          title: t('charitable.probe.batchTitle', '批量探测'),
          targetCount: t('charitable.probe.targetCount', '目标数量'),
          concurrency: t('charitable.probe.concurrency', '并发度'),
          concurrencyCustom: t('charitable.probe.concurrencyCustom', '自定义'),
          concurrencyHint: t(
            'charitable.probe.concurrencyHint',
            '质数预设：1/2/3/5/7/11/13/17/23；也可自定义 1-64'
          ),
          strategy: t('charitable.probe.strategy', '探测范围'),
          strategyHint: t(
            'charitable.probe.strategyHint',
            '按账号状态筛选本次探测目标，不是高可用自动处理策略'
          ),
          strategyOptions: {
            all: t('charitable.probe.strategyAll', '全部'),
            unknown_invalid: t('charitable.probe.strategyUnknownInvalid', '仅未知/无效'),
            enabled_only: t('charitable.probe.strategyEnabledOnly', '仅启用'),
            disabled_only: t('charitable.probe.strategyDisabledOnly', '仅禁用'),
            valid_only: t('charitable.probe.strategyValidOnly', '仅有效'),
          },
          timeout: t('charitable.probe.timeout', '超时(ms)'),
          timeoutHint: t('charitable.probe.timeoutHint', '单次探测超时，0 表示不限制；默认 15000'),
          userAgent: t('charitable.probe.userAgent', 'User-Agent'),
          userAgentHint: t(
            'charitable.probe.userAgentHint',
            '可选。可从系统常用参数选择，也可自定义输入'
          ),
          userAgentPlaceholder: t(
            'charitable.probe.userAgentPlaceholder',
            '留空使用巡检默认 UA / 提供商 headers'
          ),
          userAgentDefault: t('charitable.probe.userAgentDefault', '默认'),
          userAgentCustom: t('charitable.probe.userAgentCustom', '自定义'),
          userAgentPresets: [
            { id: 'codex', label: t('charitable.probe.userAgentCodex', 'Codex'), value: commonParams.codexUserAgent },
            { id: 'claude', label: t('charitable.probe.userAgentClaude', 'Claude'), value: commonParams.claudeUserAgent },
            { id: 'xai', label: t('charitable.probe.userAgentXai', 'xAI / Grok'), value: commonParams.xaiUserAgent },
            { id: 'opencode', label: t('charitable.probe.userAgentOpenCode', 'Open Code'), value: commonParams.openCodeUserAgent },
          ],
          autoAction: t('charitable.probe.autoAction', '自动执行'),
          autoActionHint: t(
            'charitable.probe.autoActionHint',
            '探测完成后是否自动写回状态：仅状态码 / 启用禁用 / 不执行'
          ),
          autoActionOptions: {
            none: t('charitable.probe.autoActionNone', '不写回状态'),
            status_only: t('charitable.probe.autoActionStatusOnly', '写回探测状态码'),
            enable_disable: t('charitable.probe.autoActionEnableDisable', '失败禁用 / 成功启用'),
          },
          start: t('charitable.probe.start', '开始探测'),
          cancel: t('charitable.cancel'),
          close: t('common.close', 'Close'),
          preparing: t('charitable.probe.preparing', '准备目标…'),
          probing: t('charitable.probe.running', '正在探测…'),
          persisting: t('charitable.probe.persisting', '写回状态…'),
          done: t('charitable.probe.done', '探测完成'),
          cancelled: t('charitable.probe.batchCancelled', '探测已取消'),
          current: t('charitable.probe.current', '当前账号'),
          summary: t('charitable.probe.batchResult'),
          log: t('charitable.probe.log', '探测账号日志'),
          emptyLog: t('charitable.probe.emptyLog', '尚未开始，点击开始后将滚动显示探测账号'),
          autoScroll: t('charitable.probe.autoScroll', '自动滚动'),
        }}
      />

      <AccountImportModal
        open={importOpen}
        saving={importSaving}
        title={t('charitable.key.importTitle')}
        onClose={() => setImportOpen(false)}
        onImport={handleAccountImport}
      />

      <AuthFileSyncProgressModal
        open={authFileSyncOpen}
        progress={authFileSyncProgress}
        onCancel={handleCancelAuthFileSync}
        onClose={() => {
          setAuthFileSyncOpen(false);
          setAuthFileSyncProgress(null);
        }}
        labels={{
          title: t('charitable.key.authFileSyncTitle'),
          phase: (phase) => {
            if (phase === 'listing') return t('charitable.key.authFileSyncListing');
            if (phase === 'syncing') return t('charitable.key.authFileSyncRunning');
            if (phase === 'cancelled') return t('charitable.key.authFileSyncCancelled');
            return t('charitable.key.authFileSyncDone');
          },
          current: t('charitable.key.authFileSyncCurrent'),
          summary: t('charitable.key.authFileSyncSummary'),
          cancel: t('charitable.cancel'),
          close: t('common.close', 'Close'),
          failures: t('charitable.key.authFileSyncFailures'),
          warnings: t('charitable.key.authFileSyncWarnings'),
        }}
      />

      <AuthFileSyncProgressModal
        open={authFilePushOpen}
        progress={authFilePushProgress}
        onCancel={handleCancelAuthFilePush}
        onClose={() => {
          setAuthFilePushOpen(false);
          setAuthFilePushProgress(null);
        }}
        labels={{
          title: t('charitable.key.authFilePushTitle'),
          phase: (phase) => {
            if (phase === 'preparing') return t('charitable.key.authFilePushPreparing');
            if (phase === 'pushing') return t('charitable.key.authFilePushRunning');
            if (phase === 'cancelled') return t('charitable.key.authFilePushCancelled');
            return t('charitable.key.authFilePushDone');
          },
          current: t('charitable.key.authFilePushCurrent'),
          summary: t('charitable.key.authFilePushSummary'),
          cancel: t('charitable.cancel'),
          close: t('common.close', 'Close'),
          failures: t('charitable.key.authFilePushFailures'),
        }}
      />

      {/* Toolbar: search + filters */}
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <IconSearch size={16} />
          <input
            type="text"
            placeholder={t('charitable.key.searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <ProviderCombobox
          className={styles.providerFilterCombo}
          multiple
          providers={providers}
          value={providerFilter}
          onChange={(value) => {
            setProviderFilter(value);
            setPage(1);
          }}
          placeholder={t('charitable.key.providerSearchPlaceholder')}
          allLabel={t('charitable.providerAll')}
          emptyLabel={t('charitable.noResults')}
          selectAllMatchesLabel={(count) => t('charitable.key.providerSelectAllMatches', { count })}
          selectedCountLabel={(count) => t('charitable.key.providerSelectedCount', { count })}
          ariaLabel={t('charitable.key.providerId')}
        />
        <input
          className={`${styles.filterSelect} ${styles.priorityFilter}`}
          type="number"
          inputMode="numeric"
          value={priorityFilter}
          placeholder={t('charitable.key.priority')}
          onChange={(event) => {
            setPriorityFilter(event.target.value);
            setPage(1);
          }}
          aria-label={t('charitable.key.priority')}
        />
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as KeyStatusFilter);
            setPage(1);
          }}
        >
          <option value="all">{t('charitable.statusAll')}</option>
          <option value="valid">{t('charitable.statusValid')}</option>
          <option value="unknown">{t('charitable.statusUnknown')}</option>
          <option value="disabled">{t('charitable.statusDisabled')}</option>
          <option value="expired">{t('charitable.statusExpired')}</option>
          {statusCounts.length > 0 && (
            <optgroup label={t('charitable.statusExact', '具体状态码')}>
              {statusCounts.map((item) => (
                <option key={item.status} value={`exact:${item.status}`}>
                  {statusFilterLabel(item.status, item.count, t)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <select
          className={styles.filterSelect}
          value={credentialKindFilter}
          onChange={(e) => {
            setCredentialKindFilter(e.target.value as CredentialKindFilter);
            setPage(1);
          }}
          aria-label={t('charitable.key.credentialKind')}
        >
          <option value="all">{t('charitable.key.credentialKindAll')}</option>
          <option value="auth_file">{t('charitable.key.credentialKindAuthFile')}</option>
          <option value="api_key">{t('charitable.key.credentialKindApiKey')}</option>
        </select>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={openBatchProbeFiltered}
          disabled={batchProbing || totalItems === 0}
        >
          {batchProbing ? <IconLoader2 size={14} className={styles.spin} /> : <IconCheckCircle2 size={14} />}
          {t('charitable.probe.allFiltered', { count: totalItems })}
        </button>
      </div>

      {/* Batch actions bar */}
      {selected.size > 0 && (
        <div className={styles.batchBar}>
          <span>
            {selected.size} {t('charitable.selected')}
          </span>
          <button className={styles.btnSecondary} onClick={() => handleBatchToggle(0)}>
            {t('charitable.batchDisable')}
          </button>
          <button className={styles.btnSecondary} onClick={() => handleBatchToggle(1)}>
            {t('charitable.batchEnable')}
          </button>
          <button
            className={styles.btnSecondary}
            onClick={() => void handleAuthFilePushSelected()}
            disabled={authFilePushBusy}
          >
            {authFilePushBusy ? <IconLoader2 size={14} className={styles.spin} /> : <IconRefreshCw size={14} />}
            {t('charitable.key.authFilePushSelected')}
          </button>
          <button
            className={styles.btnSecondary}
            onClick={openBatchProbeSelected}
            disabled={batchProbing}
          >
            {batchProbing ? (
              <IconLoader2 size={14} className={styles.spin} />
            ) : (
              <IconCheckCircle2 size={14} />
            )}
            {t('charitable.probe.batchProbe')}
          </button>
          <button className={styles.btnDanger} onClick={handleBatchDelete}>
            {t('charitable.batchDelete')}
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
              />
            </TableHead>
            <TableHead>#</TableHead>
            <TableHead>{t('charitable.key.authIndex')}</TableHead>
            <TableHead>{t('charitable.key.credentialKind')}</TableHead>
            <TableHead>{t('charitable.key.apiKey')}</TableHead>
            <TableHead>{t('charitable.key.apiType')}</TableHead>
            <TableHead>{t('charitable.key.providerId')}</TableHead>
            <TableHead>{t('charitable.status')}</TableHead>
            <TableHead>{t('charitable.key.priority')}</TableHead>
            <TableHead>{t('charitable.createdAt')}</TableHead>
            <TableHead alignRight>{t('charitable.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && !loading ? (
            <TableRow>
              <TableCell colSpan={11} className={styles.emptyCell}>
                {t('charitable.emptyList')}
              </TableCell>
            </TableRow>
          ) : (
            items.map((k) => {
              const si = getStatusInfo(k.status);
              const statusDescription = getStatusDescription(k.status);
              const protocols = parseApiType(k.api_type ?? parseAuthInfo(k.auth_info).api_type);
              const protocolLabels = protocols
                .map((p) => t(`charitable.key.protocols.${p}`))
                .join(', ');
              const isVisible = revealed.has(k.id);
              return (
                <TableRow
                  key={k.id}
                  selected={selected.has(k.id)}
                  onMouseEnter={(e) => handleHoverRow(k.id, e.clientX, e.clientY)}
                  onMouseMove={(e) => handleHoverMove(e.clientX, e.clientY)}
                  onMouseLeave={handleRowLeave}
                >
                  <TableCell>
                    <SelectionCheckbox
                      checked={selected.has(k.id)}
                      onChange={() => toggleSelect(k.id)}
                    />
                  </TableCell>
                  <TableCell className={styles.mono}>{k.id}</TableCell>
                  <TableCell className={styles.mono}>{k.auth_index || '—'}</TableCell>
                  <TableCell>
                    {(() => {
                      const meta = getAuthFileDisplayMeta(k);
                      return (
                        <span title={meta.providerType || meta.fileName || undefined}>
                          {credentialTypeLabel(k)}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className={styles.mono}>
                    <span className={styles.keyCell}>
                      <span>
                        {isVisible
                          ? k.auth_value || k.api_key || ''
                          : maskKey(k.auth_value || k.api_key || '')}
                      </span>
                      <button
                        className={styles.iconBtnSmall}
                        onClick={() => toggleReveal(k.id)}
                        title="toggle visibility"
                      >
                        {isVisible ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                      </button>
                    </span>
                  </TableCell>
                  <TableCell>{protocolLabels || '—'}</TableCell>
                  <TableCell>
                    {k.provider_id ? providerMap[k.provider_id] || k.provider_id : '—'}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`${styles[`badge_${si.color}`]} ${styles.statusCodeBadge}`}
                      title={t(statusDescription.key, statusDescription.values)}
                    >
                      {k.status}
                    </span>
                  </TableCell>
                  <TableCell>{k.priority}</TableCell>
                  <TableCell className={styles.mono}>{k.create_at}</TableCell>
                  <TableCell alignRight>
                    {isAuthFileCredential(k) ? (
                      <button
                        className={styles.iconBtn}
                        onClick={() => void handlePushAuthFile(k)}
                        title={t('charitable.key.authFilePushOne')}
                        disabled={authFilePushBusy || !parseAuthInfo(k.auth_info).file_name}
                      >
                        <IconRefreshCw size={16} />
                      </button>
                    ) : (
                      <button
                        className={styles.iconBtn}
                        onClick={() => void handleSendToCpa(k)}
                        title={t('charitable.cpaSync.action')}
                        disabled={syncBusy || !k.provider_id}
                      >
                        <IconRefreshCw size={16} />
                      </button>
                    )}
                    <button
                      className={styles.iconBtn}
                      onClick={() => viewFullParam(k.id)}
                      title={t('charitable.key.viewFullParam')}
                    >
                      <IconEye size={16} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={() => openEdit(k)}
                      title={t('charitable.edit')}
                    >
                      <IconPencil size={16} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={() => openProbe(k)}
                      title={t('charitable.probe.title', 'Probe')}
                    >
                      <IconCheckCircle2 size={16} />
                    </button>
                    <button
                      className={styles.iconBtnDanger}
                      onClick={() => setDeleteTarget(k)}
                      title={t('charitable.delete')}
                    >
                      <IconTrash2 size={16} />
                    </button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Prev
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}

      {/* Create / Edit Sheet */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={sheetMode === 'create' ? t('charitable.create') : t('charitable.edit')}
        size="lg"
        footer={
          <>
            <button
              type="submit"
              form="key-form"
              className={styles.btnPrimary}
              disabled={submitting || authFilePushBusy || !formParamValid || !formAuthInfoValid}
            >
              {t('charitable.save')}
            </button>
            {sheetMode === 'edit' && editTarget && isAuthFileCredential({
              auth_type: editTarget.auth_type,
              auth_info: formAuthInfo || editTarget.auth_info,
            }) ? (
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={
                  submitting ||
                  authFilePushBusy ||
                  !formParamValid ||
                  !formAuthInfoValid ||
                  !parseAuthInfo(formAuthInfo || editTarget.auth_info).file_name
                }
                onClick={() => void handleSaveAndPushAuthFile()}
              >
                {t('charitable.key.authFileSaveAndPush')}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setSheetOpen(false)}
              disabled={submitting || authFilePushBusy}
            >
              {t('charitable.cancel')}
            </button>
          </>
        }
      >
        <form id="key-form" className={styles.form} onSubmit={handleSubmit}>
          {sheetMode === 'edit' && editTarget?.auth_index ? (
            <div className={styles.field}>
              <label className={styles.label}>{t('charitable.key.authIndex')}</label>
              <input className={styles.input} value={editTarget.auth_index} readOnly />
            </div>
          ) : null}

          {sheetMode === 'edit' && editTarget && isAuthFileCredential({
            auth_type: editTarget.auth_type,
            auth_info: formAuthInfo || editTarget.auth_info,
          }) ? (
            <div className={styles.formRow}>
              <div className={styles.field}>
                <label className={styles.label}>{t('charitable.key.credentialKind')}</label>
                <input
                  className={styles.input}
                  value={credentialTypeLabel({
                    ...editTarget,
                    auth_info: formAuthInfo || editTarget.auth_info,
                  })}
                  readOnly
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>{t('charitable.key.authFileName')}</label>
                <input
                  className={`${styles.input} ${styles.mono}`}
                  value={parseAuthInfo(formAuthInfo || editTarget.auth_info).file_name || '—'}
                  readOnly
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>{t('charitable.key.lastSyncedAtLabel')}</label>
                <input
                  className={styles.input}
                  value={formatAuthFileTime(
                    Number(parseAuthInfo(formAuthInfo || editTarget.auth_info).last_synced_at) || null
                  ) || '—'}
                  readOnly
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>{t('charitable.key.lastPushedAtLabel')}</label>
                <input
                  className={styles.input}
                  value={formatAuthFileTime(
                    Number(parseAuthInfo(formAuthInfo || editTarget.auth_info).last_pushed_at) || null
                  ) || '—'}
                  readOnly
                />
              </div>
            </div>
          ) : null}

          <div className={styles.field}>
            <label className={styles.label}>
              {editTarget && editTarget.auth_type > 1
                ? t('charitable.key.authValue')
                : t('charitable.key.apiKey')} *
            </label>
            {editTarget && editTarget.auth_type > 1 ? (
              <textarea
                className={styles.textarea}
                value={formApiKey}
                onChange={(event) => setFormApiKey(event.target.value)}
                rows={12}
                required
              />
            ) : (
              <input
                className={styles.input}
                value={formApiKey}
                onChange={(event) => setFormApiKey(event.target.value)}
                placeholder={t('charitable.key.apiKeyPlaceholder')}
                required
              />
            )}
            {editTarget && editTarget.auth_type > 1 ? (
              <span className={styles.fieldHint}>
                {t('charitable.key.authValueStructuredHint', { type: editTarget.auth_type })}
              </span>
            ) : null}
          </div>


          <div className={styles.formRow}>
            <div className={styles.field}>
              <label className={styles.label}>{t('charitable.key.status')}</label>
              <select
                className={styles.input}
                value={formStatus}
                onChange={(e) => setFormStatus(Number(e.target.value))}
              >
                <option value={1}>{t('charitable.statusValid')}</option>
                <option value={0}>{t('charitable.statusUnknown')}</option>
                <option value={-2}>{t('charitable.statusDisabled')}</option>
                <option value={-1}>{t('charitable.statusInvalid')}</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>{t('charitable.key.priority')}</label>
              <input
                className={styles.input}
                type="number"
                value={formPriority}
                onChange={(e) => setFormPriority(Number(e.target.value))}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.key.providerId')}</label>
            <ProviderCombobox
              providers={providers}
              value={formProviderId}
              onChange={setFormProviderId}
              placeholder={t('charitable.key.providerSearchPlaceholder')}
              allLabel={t('charitable.key.providerNone')}
              emptyLabel={t('charitable.noResults')}
              ariaLabel={t('charitable.key.providerId')}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.key.content')}</label>
            <textarea
              className={styles.textarea}
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder={t('charitable.key.contentPlaceholder')}
              rows={3}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.key.remark')}</label>
            <input
              className={styles.input}
              value={formRemark}
              onChange={(e) => setFormRemark(e.target.value)}
              placeholder={t('charitable.key.remarkPlaceholder')}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.key.authInfo')}</label>
            <AuthInfoEditor
              value={formAuthInfo}
              onChange={(next) => {
                setFormAuthInfo(next);
                // Keep checkbox group in sync with auth_info.protocols when user edits JSON/visual core fields.
                try {
                  const info = parseAuthInfo(next);
                  if (Array.isArray(info.protocols) && info.protocols.length > 0) {
                    setFormProtocols(info.protocols);
                  }
                } catch {
                  // validity handled by AuthInfoEditor
                }
              }}
              onValidityChange={setFormAuthInfoValid}
              authType={sheetMode === 'edit' ? editTarget?.auth_type : 1}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.key.param')}</label>
            <ParamEditor
              value={formParam}
              onChange={setFormParam}
              onValidityChange={setFormParamValid}
              inheritedParams={inheritedParams}
              inheritedLabel={inheritedLabel || undefined}
            />
          </div>
        </form>
      </Sheet>

      {/* Full Param Modal */}
      <Modal
        open={fullParamTarget !== null}
        onClose={() => {
          setFullParamTarget(null);
          setFullParamData(null);
        }}
        title={t('charitable.key.fullParam')}
      >
        {fullParamLoading ? (
          <p>Loading...</p>
        ) : fullParamData ? (
          <pre className={styles.codeBlock}>{JSON.stringify(fullParamData, null, 2)}</pre>
        ) : (
          <p>{t('charitable.loadFailed')}</p>
        )}
      </Modal>

      {/* Delete Confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t('charitable.delete')}
      >
        <p>{t('charitable.deleteConfirm')}</p>
        {deleteTarget && (
          <p className={styles.mono}>
            {maskKey(deleteTarget.auth_value || deleteTarget.api_key || '')}
          </p>
        )}
        <div className={styles.modalActions}>
          <button className={styles.btnDanger} onClick={handleDelete}>
            {t('charitable.confirm')}
          </button>
          <button className={styles.btnGhost} onClick={() => setDeleteTarget(null)}>
            {t('charitable.cancel')}
          </button>
        </div>
      </Modal>

      {/* ── Probe Sheet (detect key + update provider config) ──────────── */}
      {probeSheetOpen && probeTarget && (
        <Sheet
          open={probeSheetOpen}
          onClose={closeProbe}
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <IconCheckCircle2 size={18} />
              {t('charitable.probe.title', 'Probe Key')}
              <span
                className={styles.mono}
                style={{ color: 'var(--text-secondary)', fontSize: 13 }}
              >
                #{probeTarget.id}
              </span>
            </span>
          }
          size="lg"
          footer={
            <>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={probeSubmitting}
                onClick={handleProbeSave}
              >
                {probeSubmitting ? <IconLoader2 size={14} /> : null}
                {t('charitable.probe.save', 'Save to Provider')}
              </button>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={closeProbe}
                disabled={probeSubmitting}
              >
                {t('common.cancel', 'Cancel')}
              </button>
            </>
          }
        >
          {/* Proxy URL */}
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.probe.proxyUrl', 'Proxy URL')}</label>
            <ProxyCombobox
              baseUrl={baseUrl}
              managementKey={managementKey}
              value={probeForm.proxyUrl}
              selectedProxyId={probeSelectedProxy?.id}
              onInputChange={(value) => {
                setProbeSelectedProxy(null);
                setProbeForm((prev) => ({ ...prev, proxyUrl: value }));
              }}
              onSelect={(proxy) => {
                setProbeSelectedProxy(proxy);
                setProbeForm((prev) => ({ ...prev, proxyUrl: proxy.proxy_value }));
              }}
              placeholder={t('charitable.probe.proxySearchPlaceholder')}
              ariaLabel={t('charitable.probe.proxySearchLabel')}
              noResultsLabel={t('charitable.probe.proxyNoResults')}
              loadingLabel={t('charitable.probe.proxySearching')}
            />
            <span className={styles.fieldHint}>
              {probeSelectedProxy
                ? t('charitable.probe.proxySelected', { id: probeSelectedProxy.id })
                : t('charitable.probe.proxyCustomHint')}
            </span>
          </div>

          {/* Test key */}
          <div className={styles.field}>
            <label className={styles.label}>
              {t('charitable.probe.testKey', 'Test key availability')}
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={probeTestingKey}
                onClick={handleProbeTestKey}
              >
                {probeTestingKey ? <IconLoader2 size={14} /> : <IconCheckCircle2 size={14} />}
                {t('charitable.probe.test', 'Test')}
              </button>
              {probeTestResult.state !== 'idle' && (
                <span
                  className={
                    probeTestResult.state === 'success'
                      ? styles[`badge_green`]
                      : styles[`badge_red`]
                  }
                >
                  {probeTestResult.statusCode ?? '—'}
                </span>
              )}
            </div>
            {probeTestResult.message && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                {probeTestResult.message}
              </span>
            )}
          </div>

          {/* Probe prompt */}
          <div className={styles.field}>
            <label className={styles.label}>
              {t('charitable.probe.promptLabel', 'Probe prompt')}
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <textarea
                className={styles.textarea}
                rows={2}
                value={probePrompt}
                onChange={(e) => setProbePrompt(e.target.value)}
                placeholder={t(
                  'charitable.probe.promptPlaceholder',
                  'Prompt sent to the model during probe'
                )}
              />
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setProbePrompt(randomMathPrompt())}
                title={t('charitable.probe.randomProbe', 'Random math question')}
              >
                {t('charitable.probe.randomProbe', 'Random')}
              </button>
            </div>
            <span className={styles.fieldHint}>
              {t(
                'charitable.probe.promptHint',
                'Defaults to a random arithmetic question; regenerated each time the panel opens.'
              )}
            </span>
          </div>

          {/* Request headers */}
          <div className={styles.field}>
            <label className={styles.label}>
              {t('providersPage.form.headersSection', 'Request headers')}
            </label>
            <HeadersEditor
              entries={probeForm.headers}
              onChange={(next) => setProbeForm((prev) => ({ ...prev, headers: next }))}
              disabled={probeSubmitting}
              presets={probeHeaderPresets}
            />
            <span className={styles.fieldHint}>
              {t(
                'charitable.probe.headersHint',
                'Optional headers applied when probing and saved to provider config.'
              )}
            </span>
          </div>

          {/* Models - fetch from provider, then select & configure */}
          <div className={styles.field}>
            <label className={styles.label}>
              {t('providersPage.form.modelsSection', 'Models')}
            </label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={probeFetching}
                onClick={handleProbeFetchModels}
              >
                {probeFetching ? <IconLoader2 size={14} /> : <IconDownload size={14} />}
                {t('providersPage.form.fetchModels', 'Fetch models')}
              </button>
            </div>

            {/* Discovery panel (fetch + select) */}
            {probeDiscoveryOpen && (
              <div style={{ marginBottom: 12 }}>
                <ModelDiscoveryPanel
                  loading={probeFetching}
                  models={probeFetchedModels}
                  hasFetched={probeHasFetched}
                  existingNames={
                    new Set(probeForm.models.map((m) => m.name.trim()).filter(Boolean))
                  }
                  mutating={probeSubmitting}
                  onApply={handleProbeApplyDiscovered}
                  onReload={handleProbeFetchModels}
                  onClose={() => setProbeDiscoveryOpen(false)}
                />
              </div>
            )}

            {/* Manual model list (with test status, image/thinking config) */}
            {probeForm.models.map((model, idx) => {
              const testStatus = probeModelTestStatuses[model.name.trim()];
              return (
                <div
                  key={idx}
                  style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: 10,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input
                      className={styles.input}
                      placeholder="model-name"
                      value={model.name}
                      onChange={(e) => updateProbeModel(idx, { name: e.target.value })}
                    />
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        className={styles.input}
                        placeholder="alias (optional)"
                        value={model.alias ?? ''}
                        onChange={(e) => updateProbeModel(idx, { alias: e.target.value })}
                      />
                      {testStatus && testStatus.state !== 'idle' && (
                        <span
                          className={
                            styles[testStatus.state === 'success' ? 'badge_green' : 'badge_red']
                          }
                          title={testStatus.message ?? ''}
                          style={{ flexShrink: 0 }}
                        >
                          {testStatus.state === 'loading' ? <IconLoader2 size={10} /> : null}
                          {testStatus.statusCode ?? '—'}
                        </span>
                      )}
                      <button
                        type="button"
                        className={styles.iconBtnSmall}
                        disabled={testStatus?.state === 'loading'}
                        onClick={() => {
                          const name = model.name.trim();
                          if (name) void handleProbeTestModel(name);
                        }}
                        title={t('charitable.probe.testModel', 'Test this model')}
                      >
                        <IconCheckCircle2 size={12} />
                      </button>
                    </div>
                  </div>
                  <label className={styles.checkboxRow} style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      className={styles.checkboxBox}
                      checked={model.image === true}
                      onChange={(e) => updateProbeModel(idx, { image: e.target.checked })}
                    />
                    <span className={styles.checkboxText}>
                      <span>{t('providersPage.form.modelImage', 'Vision (image input)')}</span>
                    </span>
                  </label>
                  <div className={styles.field} style={{ marginTop: 8 }}>
                    <label className={styles.label}>
                      {t('providersPage.form.thinkingConfig', 'Thinking config')}
                      <span className={styles.labelHint}>
                        {' '}
                        · {t('providersPage.form.thinkingConfigHint', 'Optional JSON')}
                      </span>
                    </label>
                    <textarea
                      className={styles.textarea}
                      rows={3}
                      value={model.thinkingJson ?? ''}
                      onChange={(e) => updateProbeModel(idx, { thinkingJson: e.target.value })}
                      placeholder={'{"levels":["low","medium","high"]}'}
                    />
                  </div>
                  {probeForm.models.length > 1 && (
                    <button
                      type="button"
                      className={styles.iconBtnDanger}
                      style={{ marginTop: 6 }}
                      onClick={() => removeProbeModel(idx)}
                    >
                      <IconTrash2 size={12} /> {t('providersPage.form.removeModel', 'Remove')}
                    </button>
                  )}
                </div>
              );
            })}
            <button type="button" className={styles.addBtn} onClick={addProbeModel}>
              <IconPlus size={12} /> {t('providersPage.form.addModel', 'Add model')}
            </button>
          </div>
        </Sheet>
      )}

      {/* Hover merged param tooltip — rendered via portal to escape the page-transition
          layer which has `transform: translateZ(0)`, breaking position:fixed positioning. */}
      {hoverVisible &&
        hoverTarget &&
        createPortal(
          <div
            ref={hoverTooltipRef}
            className={styles.mergedTooltip}
            style={{
              position: 'fixed',
              left: hoverTarget.x,
              top: hoverTarget.y,
              zIndex: 9999,
            }}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={handleTooltipEnter}
            onMouseLeave={handleTooltipLeave}
          >
            <div className={styles.mergedTooltipHeader}>
              <strong>Merged Param</strong>
              <div className={styles.mergedTooltipActions}>
                <button
                  type="button"
                  className={styles.mergedActionBtn}
                  onClick={() => void handleCopyMerged(hoverTarget.id)}
                  title={t('charitable.key.copyMerged', 'Copy JSON')}
                >
                  {t('charitable.key.copyMerged', 'Copy')}
                </button>
                <button
                  type="button"
                  className={`${styles.mergedActionBtn} ${styles.mergedSendBtn}`}
                  onClick={() => {
                    const k = items.find((item) => item.id === hoverTarget.id);
                    if (k) void handleSendToCpa(k);
                  }}
                  disabled={syncBusy}
                >
                  {t('charitable.key.sendToCpaBtn', 'Send to CPA')}
                </button>
                <button
                  type="button"
                  className={styles.mergedCloseBtn}
                  onClick={() => setHoverTarget(null)}
                >
                  x
                </button>
              </div>
            </div>
            <pre className={styles.mergedTooltipBody}>
              {(() => {
                const data = getMergedFor(hoverTarget.id);
                return JSON.stringify(data, null, 2);
              })()}
            </pre>
          </div>,
          document.body
        )}
    </div>
  );
}
