import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { useUsageData } from '@/external/features/monitoring/hooks/useUsageData';
import {
  useMonitoringData,
  getRangeBounds,
  type MonitoringEventRow,
  type MonitoringTimeRange,
  type MonitoringFilterFacets,
} from '@/external/features/monitoring/hooks/useMonitoringData';
import { type MonitoringStatusFilter } from '@/external/features/monitoring/accountOverviewState';
import { buildRealtimeSourceDisplay } from '@/external/features/monitoring/realtimeSourceDisplay';
import { formatCompactNumber, formatDurationMs, formatUsd } from '@/external/utils/usage';
import { sha256Hex } from '@/external/utils/apiKeyHash';
import { maskSensitiveText } from '@/external/utils/format';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { authFilesApi, setStatusWithFallback } from '@/external/services/api/authFiles';
import { usageServiceApi } from '@/external/services/api/usageService';
import { providersApi } from '@/services/api/providers';
import { buildLegacyAuthIndexAliases } from '@/external/features/monitoring/legacyAuthIndexAliases';
import { AccountImportModal } from '@/external/features/requestMonitor/accountImport/AccountImportModal';
import type { AccountImportResult } from '@/external/features/requestMonitor/accountImport/accountImportConverter';
import {
  IconFileText,
  IconRefreshCw,
  IconSearch,
  IconSlidersHorizontal,
  IconTimer,
} from '@/components/ui/icons';
import { normalizeAuthIndex } from '@/external/utils/usage';
import type { AuthFileItem } from '@/types/authFile';
import type { OpenAIProviderConfig } from '@/types/provider';
import styles from '@/external/pages/MonitoringCenterPage.module.scss';

/* ─── types ──────────────────────────────────────────────────────────────── */

type RealtimeLogRow = MonitoringEventRow & {
  requestCount: number;
  successRate: number;
  recentPattern: boolean[];
  apiKeyMasked: string;
  priority?: number;
};

type PaginationState<T> = {
  currentPage: number;
  totalPages: number;
  pageItems: T[];
  startItem: number;
  endItem: number;
};

type RealtimeToggleTarget =
  | {
      kind: 'auth-file';
      fileName: string;
      enabled: boolean;
      label: string;
    }
  | {
      kind: 'provider';
      providerIndex: number;
      providerName: string;
      enabled: boolean;
      label: string;
      multiAccount: boolean;
    }
  | {
      kind: 'unavailable';
      reason: string;
      enabled: boolean;
    };

const ACCOUNT_IMPORT_UPLOAD_MAX_FILES = 20;
const ACCOUNT_IMPORT_UPLOAD_MAX_BYTES = 700_000;

const chunkAccountImportFiles = (files: File[]) => {
  const chunks: File[][] = [];
  let current: File[] = [];
  let currentBytes = 0;

  files.forEach((file) => {
    const nextBytes = currentBytes + file.size;
    const shouldFlush =
      current.length > 0 &&
      (current.length >= ACCOUNT_IMPORT_UPLOAD_MAX_FILES ||
        nextBytes > ACCOUNT_IMPORT_UPLOAD_MAX_BYTES);

    if (shouldFlush) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(file);
    currentBytes += file.size;
  });

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
};

/* ─── constants ──────────────────────────────────────────────────────────── */

const REALTIME_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const AUTO_DISABLE_PROCESSED_EVENT_LIMIT = 2_000;
const AUTO_STRATEGY_SEEN_EVENT_LIMIT = 5_000;
/** Must exceed server heartbeat interval (15s) so comments keep the connection healthy. */
const SSE_IDLE_TIMEOUT_MS = 45_000;
const SSE_RECONNECT_BASE_MS = 1_000;
const SSE_RECONNECT_MAX_MS = 15_000;
/** Merge bursty SSE notifications before quiet REST refresh. */
const SSE_REFRESH_DEBOUNCE_MS = 300;

/* ─── helpers ────────────────────────────────────────────────────────────── */

function StatusBadge({ tone, title, children }: { tone: 'good' | 'warn' | 'bad'; title?: string; children: React.ReactNode }) {
  return <span className={`${styles.statusBadge} ${styles[`tone${tone}`]}`} title={title}>{children}</span>;
}

/**
 * 支持点击复制的悬浮提示组件
 * 当用户 hover 时显示完整内容，并提供一键复制功能
 */
function HoverTooltip({
  content,
  children,
  wide = false,
}: {
  content: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const handleMouseEnter = () => {
    timeoutRef.current = window.setTimeout(() => setVisible(true), 300);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setVisible(false);
    setCopied(false);
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  return (
    <div
      className={styles.tooltipWrapper}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className={styles.primaryCell}>{children}</div>
      {visible && (
        <div className={wide ? `${styles.customTooltip} ${styles.customTooltipWide}` : styles.customTooltip}>
          <pre className={wide ? `${styles.tooltipContent} ${styles.tooltipContentWide}` : styles.tooltipContent}>
            {content}
          </pre>
          <button type="button" className={styles.tooltipCopyBtn} onClick={handleCopy}>
            {copied ? '✓ 已复制' : '复制'}
          </button>
        </div>
      )}
    </div>
  );
}

function RecentPattern({ pattern }: { pattern: boolean[] }) {
  const normalized = pattern.length > 0 ? pattern : Array.from({ length: 10 }, () => true);
  return (
    <div className={styles.recentStatusCell}>
      {normalized.map((ok, i) => (
        <span
          key={`${i}-${ok ? 'ok' : 'fail'}`}
          className={styles.statusBlock}
          style={{
            backgroundColor: ok ? '#30b878' : '#e06a6a',
            width: 8,
            height: 24,
            borderRadius: 2,
            flexShrink: 0,
          }}
          title={ok ? 'OK' : 'Failed'}
        />
      ))}
    </div>
  );
}

function PaginationControls({
  count,
  currentPage,
  totalPages,
  startItem,
  endItem,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
  t,
}: {
  count: number;
  currentPage: number;
  totalPages: number;
  startItem: number;
  endItem: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  if (count === 0) return null;

  return (
    <div className={styles.paginationBar}>
      <div className={styles.paginationInfo}>
        {t('monitoring.pagination_info', {
          current: currentPage,
          total: totalPages,
          start: startItem,
          end: endItem,
          count,
        })}
      </div>
      <div className={styles.paginationControls}>
        <div className={styles.pageSizeField}>
          <span>{t('monitoring.page_size_label')}</span>
          <Select
            className={styles.pageSizeSelect}
            value={String(pageSize)}
            options={pageSizeOptions.map((size) => ({
              value: String(size),
              label: t('monitoring.page_size_option', { count: size }),
            }))}
            onChange={(value) => onPageSizeChange(Number.parseInt(value, 10))}
            ariaLabel={t('monitoring.page_size_label')}
            fullWidth={false}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
        >
          {t('monitoring.pagination_prev')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
        >
          {t('monitoring.pagination_next')}
        </Button>
      </div>
    </div>
  );
}

const buildRealtimeLogRows = (rows: MonitoringEventRow[]): RealtimeLogRow[] => {
  const sortedAsc = [...rows].sort(
    (left, right) => left.timestampMs - right.timestampMs || left.id.localeCompare(right.id)
  );
  const metricsByStream = new Map<string, { total: number; success: number; pattern: boolean[] }>();

  const enriched = sortedAsc.map((row) => {
    const streamKey = [row.account, row.provider, row.model, row.channel].join('::');
    const previous = metricsByStream.get(streamKey) ?? { total: 0, success: 0, pattern: [] };
    const nextPattern = [...previous.pattern, !row.failed].slice(-10);
    const next = {
      total: previous.total + (row.statsIncluded ? 1 : 0),
      success: previous.success + (row.statsIncluded && !row.failed ? 1 : 0),
      pattern: nextPattern,
    };
    metricsByStream.set(streamKey, next);

    return {
      ...row,
      requestCount: next.total,
      successRate: next.total > 0 ? next.success / next.total : 1,
      recentPattern: nextPattern,
      apiKeyMasked: row.apiKeyMasked || '',
      priority: undefined,
    } satisfies RealtimeLogRow;
  });

  return enriched.sort(
    (left, right) =>
      right.timestampMs - left.timestampMs ||
      right.requestCount - left.requestCount ||
      right.id.localeCompare(left.id)
  );
};

const buildRealtimeMetaText = (row: MonitoringEventRow) =>
  maskSensitiveText(`${row.endpointMethod} ${row.endpointPath}`.trim() || '-');

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const buildStatusDebugPayload = (row: RealtimeLogRow) => {
  if (row.rawItem && typeof row.rawItem === 'object') {
    try {
      const source = { ...(row.rawItem as Record<string, unknown>) };
      const rawJSON = source.raw_json ?? source.rawJson;
      let parsedRawJSON: Record<string, unknown> | null = null;

      if (typeof rawJSON === 'string') {
        const parsed = JSON.parse(rawJSON) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsedRawJSON = parsed as Record<string, unknown>;
        }
      } else if (rawJSON && typeof rawJSON === 'object' && !Array.isArray(rawJSON)) {
        parsedRawJSON = rawJSON as Record<string, unknown>;
      }

      if (parsedRawJSON) {
        delete source.raw_json;
        delete source.rawJson;
        return JSON.stringify({ ...source, ...parsedRawJSON }, null, 2);
      }

      return JSON.stringify(source, null, 2);
    } catch {
      try {
        return JSON.stringify(row.rawItem, null, 2);
      } catch {
        // fall through to reconstructed payload
      }
    }
  }

  return JSON.stringify(
    {
      request_id: row.id,
      timestamp_ms: row.timestampMs,
      timestamp: row.timestamp,
      provider: row.provider,
      model: row.model,
      requested_model: row.model,
      resolved_model: row.resolvedModel || row.model,
      endpoint: row.endpoint,
      method: row.endpointMethod,
      path: row.endpointPath,
      auth_index: row.authIndex,
      source: row.source,
      api_key_hash: row.apiKeyHash,
      account_snapshot: row.account,
      auth_label_snapshot: row.authLabel,
      input_tokens: row.inputTokens,
      output_tokens: row.outputTokens,
      reasoning_tokens: row.reasoningTokens,
      cached_tokens: row.cachedTokens,
      total_tokens: row.totalTokens,
      latency_ms: row.latencyMs,
      failed: row.failed,
      status_code: row.statusCode,
      error_message: row.errorMessage,
      request_count: row.requestCount,
      success_rate: row.successRate,
      total_cost: row.totalCost,
    },
    null,
    2
  );
};

const readBoolean = (value: unknown) =>
  value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');

const readPriorityNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

const isPlaceholderValue = (value: unknown) => {
  const normalized = String(value ?? '').trim();
  return normalized === '' || normalized === '-';
};

const buildAutoDisableEventKey = (row: RealtimeLogRow) =>
  row.id || [row.authIndex, row.timestampMs, row.statusCode, row.latencyMs ?? ''].join(':');

const pickNewAutoStrategyRows = (
  rows: RealtimeLogRow[],
  seenKeys: Set<string>,
  seenKeyOrder: string[]
) => {
  const freshRows: RealtimeLogRow[] = [];

  rows.forEach((row) => {
    const eventKey = buildAutoDisableEventKey(row);
    if (seenKeys.has(eventKey)) return;
    freshRows.push(row);
    seenKeys.add(eventKey);
    seenKeyOrder.push(eventKey);
  });

  while (seenKeyOrder.length > AUTO_STRATEGY_SEEN_EVENT_LIMIT) {
    const removed = seenKeyOrder.shift();
    if (removed) seenKeys.delete(removed);
  }

  return freshRows;
};

// Auto-disable any account request whose HTTP status is not exactly 200.
const shouldAutoDisableRow = (row: RealtimeLogRow) => row.statusCode !== 200;

const getStatusBadgeTone = (row: Pick<RealtimeLogRow, 'failed' | 'statusCode'>) => {
  if (row.failed || row.statusCode >= 400) return 'bad';
  if (row.statusCode >= 300) return 'warn';
  return 'good';
};

const buildAuthFilesByAuthIndex = (authFiles: AuthFileItem[]) => {
  const map = new Map<string, AuthFileItem>();

  authFiles.forEach((file) => {
    const add = (authIndex: string | null | undefined) => {
      if (!authIndex || map.has(authIndex)) return;
      map.set(authIndex, file);
    };

    add(normalizeAuthIndex(file['auth_index'] ?? file.authIndex));
    buildLegacyAuthIndexAliases(file).forEach(add);
  });

  return map;
};

const buildOpenAIProvidersByAuthIndex = (providers: OpenAIProviderConfig[]) => {
  const map = new Map<string, { provider: OpenAIProviderConfig; index: number }>();

  providers.forEach((provider, index) => {
    const add = (authIndex: string | null | undefined) => {
      if (!authIndex || map.has(authIndex)) return;
      map.set(authIndex, { provider, index });
    };

    add(normalizeAuthIndex(provider.authIndex));
    provider.apiKeyEntries.forEach((entry) => add(normalizeAuthIndex(entry.authIndex)));
  });

  return map;
};

const buildOpenAIProvidersByName = (providers: OpenAIProviderConfig[]) => {
  const map = new Map<string, { provider: OpenAIProviderConfig; index: number }>();
  providers.forEach((provider, index) => {
    const name = String(provider.name ?? '').trim().toLowerCase();
    if (name && !map.has(name)) {
      map.set(name, { provider, index });
    }
  });
  return map;
};

const buildPaginationState = <T,>(
  items: readonly T[],
  page: number,
  pageSize: number
): PaginationState<T> => {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, items.length);

  return {
    currentPage,
    totalPages,
    pageItems: items.slice(startIndex, endIndex),
    startItem: items.length > 0 ? startIndex + 1 : 0,
    endItem: endIndex,
  };
};

/* ─── empty filter facets fallback ────────────────────────────────────────── */

const EMPTY_FACETS: MonitoringFilterFacets = {
  accounts: [],
  providers: [],
  models: [],
  channels: [],
  apiKeys: [],
};

/* ─── MonitoringPanel ───────────────────────────────────────────────────── */

function MonitoringPanel({
  title,
  subtitle,
  className,
  extra,
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={[styles.monitoringPanel, className].filter(Boolean).join(' ')}>
      <div className={styles.monitoringPanelHeader}>
        <div className={styles.monitoringPanelTitle}>
          <h2 className={styles.monitoringPanelTitleText}>{title}</h2>
          {subtitle ? <p className={styles.monitoringPanelSubtitle}>{subtitle}</p> : null}
        </div>
        {extra}
      </div>
      {children}
    </div>
  );
}

/* ─── main component ────────────────────────────────────────────────────── */

export function RequestMonitorPage() {
  const { t, i18n } = useTranslation();
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const managementKey = useAuthStore((state) => state.managementKey);

  /* ── realtime operations ───────────────────────────────────────────────── */
  const [autoDisableEnabled, setAutoDisableEnabled] = useState(true);
  const [accountImportOpen, setAccountImportOpen] = useState(false);
  const [accountImportSaving, setAccountImportSaving] = useState(false);
  const autoDisableRunningRef = useRef(false);
  const autoDisableProcessedEventKeysRef = useRef<string[]>([]);
  const autoDisableProcessedEventSetRef = useRef(new Set<string>());
  const autoStrategySeenEventKeysRef = useRef<string[]>([]);
  const autoStrategySeenEventSetRef = useRef(new Set<string>());
  const [realtimeToggleUpdatingKey, setRealtimeToggleUpdatingKey] = useState<string | null>(null);

  /* ── filters ───────────────────────────────────────────────────────────── */
  const [searchInput, setSearchInput] = useState('');
  const deferredSearch = useDeferredValue(searchInput);
  const deferredSearchApiKeyHash = useMemo(() => sha256Hex(deferredSearch), [deferredSearch]);

  const [selectedAccount, setSelectedAccount] = useState('all');
  const [selectedProvider, setSelectedProvider] = useState('all');
  const [selectedModel, setSelectedModel] = useState('all');
  const [selectedChannel, setSelectedChannel] = useState('all');
  const [selectedApiKeyHash, setSelectedApiKeyHash] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState<MonitoringStatusFilter>('all');

  const [timeRange] = useState<MonitoringTimeRange>('today');

  /* ── pagination ────────────────────────────────────────────────────────── */
  const [realtimePage, setRealtimePage] = useState(1);
  const [realtimePageSize, setRealtimePageSize] = useState(20);

  /* ── data fetching ─────────────────────────────────────────────────────── */
  // 关键：查询时间窗口必须按“当前时间”动态生成，不能把 Date.now() 冻结在 useMemo 里
  const buildUsageQueryAt = useCallback(
    (nowMs: number) => {
      const bounds = getRangeBounds(timeRange, nowMs, null);
      if (!bounds) return undefined;
      // 只把 'success'/'failed' 传给后端，具体状态码在前端过滤
      const statusForBackend: 'success' | 'failed' | undefined =
        selectedStatus === 'success' || selectedStatus === 'failed'
          ? selectedStatus
          : selectedStatus === 'all'
            ? undefined
            : undefined;  // 具体数字状态码在前端过滤
      return {
        startMs: Number.isFinite(bounds.startMs) ? bounds.startMs : undefined,
        endMs: Number.isFinite(bounds.endMs) ? bounds.endMs : undefined,
        account: selectedAccount !== 'all' ? selectedAccount : undefined,
        provider: selectedProvider !== 'all' ? selectedProvider : undefined,
        model: selectedModel !== 'all' ? selectedModel : undefined,
        channel: selectedChannel !== 'all' ? selectedChannel : undefined,
        apiKeyHash: selectedApiKeyHash !== 'all' ? selectedApiKeyHash : undefined,
        status: statusForBackend,
        search: deferredSearch.trim() || undefined,
        searchApiKeyHash: deferredSearch.trim() ? deferredSearchApiKeyHash : undefined,
      };
    },
    [
      deferredSearch,
      deferredSearchApiKeyHash,
      selectedAccount,
      selectedApiKeyHash,
      selectedChannel,
      selectedModel,
      selectedProvider,
      selectedStatus,
      timeRange,
    ]
  );

  // 初始查询：在 filters/timeRange 变化时重新生成一次
  const buildUsageQuery = useMemo(() => buildUsageQueryAt(Date.now()), [buildUsageQueryAt]);

  const usagePageQueries = useMemo(
    () => ({
      realtime: { page: realtimePage, pageSize: realtimePageSize },
    }),
    [realtimePage, realtimePageSize]
  );

  const {
    usage,
    usagePages,
    loading: usageLoading,
    modelPrices,
    apiKeyAliases,
    loadUsage,
    loadModelPrices,
    loadApiKeyAliases,
    resolvedUsageServiceBase,
  } = useUsageData(buildUsageQuery, usagePageQueries, { includeSummary: false });

  const {
    authFiles,
    filteredRows,
    realtimePageRows,
    loading: monitoringLoading,
    filterFacets,
    refreshMeta,
  } = useMonitoringData({
    usage,
    usagePages,
    config,
    modelPrices,
    apiKeyAliases,
    timeRange,
    customTimeRange: null,
    searchQuery: deferredSearch,
    searchApiKeyHash: deferredSearchApiKeyHash,
  });

  const authFilesByAuthIndex = useMemo(() => buildAuthFilesByAuthIndex(authFiles), [authFiles]);
  const openAIProvidersByAuthIndex = useMemo(
    () => buildOpenAIProvidersByAuthIndex(config?.openaiCompatibility || []),
    [config?.openaiCompatibility]
  );
  const openAIProvidersByName = useMemo(
    () => buildOpenAIProvidersByName(config?.openaiCompatibility || []),
    [config?.openaiCompatibility]
  );

  const resolveOpenAIProviderEntry = useCallback(
    (row: Pick<RealtimeLogRow, 'authIndex' | 'provider' | 'channel'>) =>
      openAIProvidersByAuthIndex.get(row.authIndex) ||
      openAIProvidersByName.get(String(row.provider ?? '').trim().toLowerCase()) ||
      openAIProvidersByName.get(String(row.channel ?? '').trim().toLowerCase()),
    [openAIProvidersByAuthIndex, openAIProvidersByName]
  );

  const isAccountRequestRow = useCallback(
    (row: Pick<RealtimeLogRow, 'authIndex' | 'model'>) => {
      if (isPlaceholderValue(row.model)) return false;
      if (!row.authIndex) return false;
      return authFilesByAuthIndex.has(row.authIndex) || openAIProvidersByAuthIndex.has(row.authIndex);
    },
    [authFilesByAuthIndex, openAIProvidersByAuthIndex]
  );

  const resolveRealtimeToggleTarget = useCallback(
    (row: RealtimeLogRow): RealtimeToggleTarget => {
      const providerEntry = resolveOpenAIProviderEntry(row);
      if (providerEntry) {
        return {
          kind: 'provider',
          providerIndex: providerEntry.index,
          providerName: providerEntry.provider.name,
          enabled: !readBoolean(providerEntry.provider.disabled),
          label: providerEntry.provider.name,
          multiAccount: providerEntry.provider.apiKeyEntries.length > 1,
        };
      }

      const file = authFilesByAuthIndex.get(row.authIndex);
      if (file) {
        const fileName = String(file.name || '').trim();
        if (fileName && !readBoolean(file.runtimeOnly ?? file.runtime_only)) {
          return {
            kind: 'auth-file',
            fileName,
            enabled: !readBoolean(file.disabled),
            label: row.authLabel || row.account || fileName,
          };
        }
      }

      return {
        kind: 'unavailable',
        reason: t('monitoring.realtime_toggle_unavailable', {
          defaultValue: 'Unavailable',
        }),
        enabled: false,
      };
    },
    [authFilesByAuthIndex, resolveOpenAIProviderEntry, t]
  );

  const applyAutoDisable = useCallback(
    async (rows: RealtimeLogRow[]) => {
      if (!autoDisableEnabled || autoDisableRunningRef.current) return;

      const authFileCandidates = new Map<string, { fileName: string; account: string }>();
      const providerCandidates = new Map<string, { providerIndex: number; providerName: string }>();
      const acceptedEventKeys: string[] = [];
      rows.forEach((row) => {
        const eventKey = buildAutoDisableEventKey(row);
        if (autoDisableProcessedEventSetRef.current.has(eventKey)) return;
        if (!isAccountRequestRow(row)) return;
        if (!shouldAutoDisableRow(row)) return;
        acceptedEventKeys.push(eventKey);

        const file = authFilesByAuthIndex.get(row.authIndex);
        const canDisableAuthFile =
          !!file &&
          !readBoolean(file.disabled) &&
          !readBoolean(file.runtimeOnly ?? file.runtime_only);
        if (canDisableAuthFile) {
          const fileName = String(file.name || '').trim();
          if (fileName) {
            authFileCandidates.set(fileName, {
              fileName,
              account: row.authLabel || row.account || fileName,
            });
          }
          // Auth-file target wins for oauth/credential accounts. Avoid name-based
          // provider disable collisions (e.g. provider "xai" vs auth files).
          return;
        }

        // Provider-only rows: require exact authIndex match first, then single-key name match.
        const providerByAuthIndex = openAIProvidersByAuthIndex.get(row.authIndex);
        if (
          providerByAuthIndex &&
          providerByAuthIndex.provider.apiKeyEntries.length <= 1 &&
          !readBoolean(providerByAuthIndex.provider.disabled)
        ) {
          providerCandidates.set(String(providerByAuthIndex.index), {
            providerIndex: providerByAuthIndex.index,
            providerName: providerByAuthIndex.provider.name,
          });
          return;
        }

        const providerByName =
          openAIProvidersByName.get(String(row.provider ?? '').trim().toLowerCase()) ||
          openAIProvidersByName.get(String(row.channel ?? '').trim().toLowerCase());
        if (
          providerByName &&
          providerByName.provider.apiKeyEntries.length <= 1 &&
          !readBoolean(providerByName.provider.disabled)
        ) {
          providerCandidates.set(String(providerByName.index), {
            providerIndex: providerByName.index,
            providerName: providerByName.provider.name,
          });
        }
      });

      const markAutoDisableEventsProcessed = () => {
        acceptedEventKeys.forEach((eventKey) => {
          autoDisableProcessedEventSetRef.current.add(eventKey);
          autoDisableProcessedEventKeysRef.current.push(eventKey);
        });
        while (autoDisableProcessedEventKeysRef.current.length > AUTO_DISABLE_PROCESSED_EVENT_LIMIT) {
          const removed = autoDisableProcessedEventKeysRef.current.shift();
          if (removed) autoDisableProcessedEventSetRef.current.delete(removed);
        }
      };

      if (authFileCandidates.size === 0 && providerCandidates.size === 0) {
        markAutoDisableEventsProcessed();
        return;
      }

      autoDisableRunningRef.current = true;
      const authFileEntries = Array.from(authFileCandidates.values());
      const providerEntries = Array.from(providerCandidates.values());
      const tasks = [
        ...authFileEntries.map((entry) => ({
          kind: 'auth-file' as const,
          entry,
          run: () => setStatusWithFallback(entry.fileName, true),
        })),
        ...providerEntries.map((entry) => ({
          kind: 'provider' as const,
          entry,
          run: () => providersApi.updateOpenAIProviderDisabled(entry.providerIndex, true),
        })),
      ];
      const results = await Promise.allSettled(tasks.map((task) => task.run()));

      let successCount = 0;
      const disabledProviderIndexes = new Set<number>();
      const disabledLabels: string[] = [];
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled') return;
        successCount += 1;
        const task = tasks[index];
        if (task.kind === 'auth-file') {
          disabledLabels.push(task.entry.account || task.entry.fileName);
        } else {
          disabledProviderIndexes.add(task.entry.providerIndex);
          disabledLabels.push(task.entry.providerName);
        }
      });

      try {
        if (successCount > 0) {
          markAutoDisableEventsProcessed();
          if (disabledProviderIndexes.size > 0) {
            updateConfigValue(
              'openai-compatibility',
              (config?.openaiCompatibility || []).map((provider, index) =>
                disabledProviderIndexes.has(index) ? { ...provider, disabled: true } : provider
              )
            );
          }
          await refreshMeta(false);
        }
      } catch (error) {
        console.warn('[RequestMonitorPage] refresh meta after auto-disable failed', error);
      } finally {
        autoDisableRunningRef.current = false;
      }

      const failureCount = results.length - successCount;
      if (successCount > 0) {
        showNotification(
          t('monitoring.auto_disable_success', {
            count: successCount,
            defaultValue: 'Auto-disabled {{count}} account(s)',
          }) + (disabledLabels.length ? `: ${disabledLabels.slice(0, 5).join(', ')}${disabledLabels.length > 5 ? '…' : ''}` : ''),
          failureCount > 0 ? 'warning' : 'success'
        );
      } else if (failureCount > 0) {
        showNotification(
          t('monitoring.auto_disable_failed', { defaultValue: 'Auto-disable failed' }),
          'error'
        );
      }
    },
    [
      authFilesByAuthIndex,
      autoDisableEnabled,
      isAccountRequestRow,
      openAIProvidersByAuthIndex,
      openAIProvidersByName,
      config?.openaiCompatibility,
      refreshMeta,
      showNotification,
      t,
      updateConfigValue,
    ]
  );


  /* ── refresh orchestration ─────────────────────────────────────────────── */
  const overallLoading = usageLoading || monitoringLoading;

  const [configurationRefreshing, setConfigurationRefreshing] = useState(false);
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [streamErrorMessage, setStreamErrorMessage] = useState<string | null>(null);
  const [lastStreamEventAt, setLastStreamEventAt] = useState<Date | null>(null);
  const [autoDisableTick, setAutoDisableTick] = useState(0);
  const streamRefreshRunningRef = useRef(false);
  const streamRefreshPendingRef = useRef(false);

  const refreshConfiguration = useCallback(async () => {
    if (configurationRefreshing) return;
    setConfigurationRefreshing(true);
    try {
      await Promise.all([
        loadModelPrices(),
        loadApiKeyAliases(),
        refreshMeta(false),
        fetchConfig('openai-compatibility', true),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showNotification(`${t('notification.refresh_failed')}: ${message}`, 'error');
    } finally {
      setConfigurationRefreshing(false);
    }
  }, [
    configurationRefreshing,
    fetchConfig,
    loadApiKeyAliases,
    loadModelPrices,
    refreshMeta,
    showNotification,
    t,
  ]);

  const refreshUsageFromStream = useCallback(async () => {
    if (streamRefreshRunningRef.current) {
      streamRefreshPendingRef.current = true;
      return;
    }

    streamRefreshRunningRef.current = true;
    try {
      do {
        streamRefreshPendingRef.current = false;
        // Realtime page only needs the current realtime page; skip /usage/summary.
        await loadUsage(buildUsageQueryAt(Date.now()), {
          quiet: true,
          includeSummary: false,
        });
        if (autoDisableEnabled) {
          setAutoDisableTick((value) => value + 1);
        }
      } while (streamRefreshPendingRef.current);
    } catch (error) {
      console.warn('[RequestMonitorPage] SSE usage refresh failed', error);
    } finally {
      streamRefreshRunningRef.current = false;
    }
  }, [autoDisableEnabled, buildUsageQueryAt, loadUsage]);

  // Keep the latest refresh callback without tearing down the SSE socket when filters change.
  const refreshUsageFromStreamRef = useRef(refreshUsageFromStream);
  useEffect(() => {
    refreshUsageFromStreamRef.current = refreshUsageFromStream;
  }, [refreshUsageFromStream]);

  const streamRefreshTimerRef = useRef<number | null>(null);
  const scheduleUsageRefreshFromStream = useCallback(() => {
    if (streamRefreshTimerRef.current !== null) {
      window.clearTimeout(streamRefreshTimerRef.current);
    }
    streamRefreshTimerRef.current = window.setTimeout(() => {
      streamRefreshTimerRef.current = null;
      void refreshUsageFromStreamRef.current();
    }, SSE_REFRESH_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    if (!resolvedUsageServiceBase) return;

    let active = true;
    let controller = new AbortController();
    let retryDelayMs = SSE_RECONNECT_BASE_MS;
    let reconnectTimer: number | null = null;
    let connectLoopPromise: Promise<void> | null = null;
    let streamStatusLocal: 'connecting' | 'live' | 'error' = 'connecting';

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const waitForRetry = (delayMs: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        clearReconnectTimer();
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          resolve();
        }, delayMs);
        signal.addEventListener(
          'abort',
          () => {
            clearReconnectTimer();
            resolve();
          },
          { once: true }
        );
      });

    const forceReconnect = (reason: string) => {
      if (!active) return;
      streamStatusLocal = 'error';
      setStreamStatus('error');
      setStreamErrorMessage(reason);
      // Abort the in-flight fetch or backoff wait so the loop retries immediately.
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };

    const connectLoop = async () => {
      while (active) {
        // Each attempt gets a fresh AbortController so forceReconnect can abort only the current fetch.
        controller = new AbortController();
        const attemptSignal = controller.signal;
        streamStatusLocal = 'connecting';
        setStreamStatus('connecting');
        try {
          await usageServiceApi.streamUsageRealtime(resolvedUsageServiceBase, managementKey, {
            signal: attemptSignal,
            idleTimeoutMs: SSE_IDLE_TIMEOUT_MS,
            onOpen: () => {
              if (!active) return;
              retryDelayMs = SSE_RECONNECT_BASE_MS;
              streamStatusLocal = 'live';
              setStreamStatus('live');
              setStreamErrorMessage(null);
              // Debounce open+burst updates so reconnect does not stampede REST.
              scheduleUsageRefreshFromStream();
            },
            onUpdate: ({ atMs }) => {
              if (!active) return;
              setLastStreamEventAt(new Date(atMs || Date.now()));
              scheduleUsageRefreshFromStream();
            },
          });
          if (!active) break;
          // streamUsageRealtime resolves cleanly only when the attempt was aborted.
          if (attemptSignal.aborted) {
            streamStatusLocal = 'error';
            setStreamStatus('error');
            // Retry immediately after force-reconnect / abort.
            continue;
          }
          throw new Error('SSE stream closed');
        } catch (error) {
          if (!active) break;
          const message =
            error instanceof Error && error.message
              ? error.message
              : attemptSignal.aborted
                ? 'SSE stream aborted'
                : String(error);
          streamStatusLocal = 'error';
          setStreamStatus('error');
          setStreamErrorMessage(message);
          // Immediate retry after an explicit abort (network/online force reconnect).
          const delayMs = attemptSignal.aborted ? SSE_RECONNECT_BASE_MS : retryDelayMs;
          // Use a fresh signal for the backoff wait so forceReconnect can interrupt it.
          const backoffController = new AbortController();
          controller = backoffController;
          await waitForRetry(delayMs, backoffController.signal);
          if (!active) break;
          if (!backoffController.signal.aborted) {
            retryDelayMs = Math.min(retryDelayMs * 2, SSE_RECONNECT_MAX_MS);
          } else {
            retryDelayMs = SSE_RECONNECT_BASE_MS;
          }
        }
      }
    };

    const handleOnline = () => {
      forceReconnect('network online, reconnecting SSE');
    };

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      // Recover zombie tabs: if the stream is not live, force an immediate reconnect attempt.
      if (streamStatusLocal !== 'live') {
        forceReconnect('page visible, reconnecting SSE');
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    connectLoopPromise = connectLoop();

    return () => {
      active = false;
      clearReconnectTimer();
      if (streamRefreshTimerRef.current !== null) {
        window.clearTimeout(streamRefreshTimerRef.current);
        streamRefreshTimerRef.current = null;
      }
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      controller.abort();
      void connectLoopPromise;
    };
  }, [managementKey, resolvedUsageServiceBase, scheduleUsageRefreshFromStream]);

  const handleRealtimeToggle = useCallback(
    async (row: RealtimeLogRow, enabled: boolean) => {
      const target = resolveRealtimeToggleTarget(row);
      if (target.kind === 'unavailable') return;

      const updatingKey =
        target.kind === 'auth-file'
          ? `auth-file:${target.fileName}`
          : `provider:${target.providerName}:${target.providerIndex}`;

      const previousOpenAIProviders = config?.openaiCompatibility || [];
      setRealtimeToggleUpdatingKey(updatingKey);

      if (target.kind === 'provider') {
        updateConfigValue(
          'openai-compatibility',
          previousOpenAIProviders.map((provider, index) =>
            index === target.providerIndex ? { ...provider, disabled: !enabled } : provider
          )
        );
      }

      try {
        if (target.kind === 'auth-file') {
          await setStatusWithFallback(target.fileName, !enabled);
          showNotification(
            enabled
              ? t('auth_files.status_enabled_success', { name: target.label })
              : t('auth_files.status_disabled_success', { name: target.label }),
            'success'
          );
        } else {
          await providersApi.updateOpenAIProviderDisabled(target.providerIndex, !enabled);
          showNotification(
            enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
            'success'
          );
        }

        await refreshMeta(false);
      } catch (error) {
        if (target.kind === 'provider') {
          updateConfigValue('openai-compatibility', previousOpenAIProviders);
        }
        const message = error instanceof Error ? error.message : String(error);
        showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
      } finally {
        setRealtimeToggleUpdatingKey(null);
      }
    },
    [
      config?.openaiCompatibility,
      refreshMeta,
      resolveRealtimeToggleTarget,
      showNotification,
      t,
      updateConfigValue,
    ]
  );

  const handleAccountImport = useCallback(
    async (payload: AccountImportResult) => {
      if (payload.items.length === 0) return;

      setAccountImportSaving(true);
      try {
        const requestedCount = payload.items.length;
        const files = payload.items.map((item) => {
          // Always write a real boolean so the backend synthesizer can honor disabled.
          const authJson = {
            ...item.authJson,
            disabled: item.authJson.disabled === true,
          };
          return new File([JSON.stringify(authJson)], item.fileName, {
            type: 'application/json',
          });
        });
        const uploadChunks = chunkAccountImportFiles(files);
        let added = 0;
        const failedEntries: Array<{ name: string; error: string }> = [];
        const uploadedNames: string[] = [];

        for (const chunk of uploadChunks) {
          const result = await authFilesApi.uploadFiles(chunk);
          added += result.uploaded;
          failedEntries.push(...result.failed);
          uploadedNames.push(...(result.files ?? []));
        }

        const failedNameSet = new Set(failedEntries.map((entry) => entry.name));
        const requestedNameSet = new Set(payload.items.map((item) => item.fileName));
        const uploadedNameSet = new Set(uploadedNames);
        const wasUploaded = (fileName: string) =>
          !failedNameSet.has(fileName) &&
          (uploadedNameSet.has(fileName) ||
            (uploadedNameSet.size === 0 && requestedNameSet.has(fileName)));
        const normalizeHeaders = (value: unknown): Record<string, string> | undefined => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
          const headers = Object.entries(value).reduce<Record<string, string>>(
            (result, [name, headerValue]) => {
              if (typeof headerValue === 'string') result[name] = headerValue;
              return result;
            },
            {}
          );
          return Object.keys(headers).length > 0 ? headers : undefined;
        };

        for (const item of payload.items) {
          if (!wasUploaded(item.fileName)) continue;

          const patch = {
            headers: normalizeHeaders(item.authJson.headers),
            proxy_url:
              typeof item.authJson.proxy_url === 'string'
                ? item.authJson.proxy_url.trim() || undefined
                : undefined,
            priority:
              item.authJson.priority !== null &&
              item.authJson.priority !== undefined &&
              Number.isFinite(Number(item.authJson.priority))
                ? Math.trunc(Number(item.authJson.priority))
                : undefined,
          };
          if (
            patch.headers === undefined &&
            patch.proxy_url === undefined &&
            patch.priority === undefined
          ) {
            continue;
          }

          try {
            await authFilesApi.patchFields(item.fileName, patch);
          } catch (patchError) {
            const message = patchError instanceof Error ? patchError.message : String(patchError);
            failedEntries.push({
              name: item.fileName,
              error: `uploaded but failed to apply import settings: ${message}`,
            });
          }
        }

        const failed = failedEntries.length;
        const skipped = Math.max(0, requestedCount - added - failed);

        if (added === 0) {
          const details = failedEntries
            .map((failure) => `${failure.name}: ${failure.error}`)
            .join('; ');
          throw new Error(details || t('notification.upload_failed'));
        }

        showNotification(
          t('monitoring.import_success', {
            added,
            skipped,
            total: requestedCount,
            failed,
            defaultValue:
              'Import complete: added {{added}}, skipped {{skipped}}, total {{total}}, failed {{failed}}',
          }),
          failed > 0 ? 'warning' : 'success'
        );
        await refreshMeta(false);
      } finally {
        setAccountImportSaving(false);
      }
    },
    [refreshMeta, showNotification, t]
  );

  /* ── rows ──────────────────────────────────────────────────────────────── */
  const rowsForLog = useMemo(
    () => {
      const rows = realtimePageRows ?? filteredRows;
      // 前端过滤：具体的 HTTP 状态码（如 200, 503, 429 等）
      if (typeof selectedStatus === 'number' && selectedStatus > 0) {
        return rows.filter((row) => row.statusCode === selectedStatus);
      }
      return rows;
    },
    [realtimePageRows, filteredRows, selectedStatus]
  );

  const realtimeLogRows = useMemo(
    () =>
      buildRealtimeLogRows(rowsForLog).map((row) => {
        const providerEntry = resolveOpenAIProviderEntry(row);
        const file = authFilesByAuthIndex.get(row.authIndex);
        return {
          ...row,
          priority: providerEntry
            ? readPriorityNumber(providerEntry.provider.priority)
            : file
              ? readPriorityNumber(file.priority)
              : 0,
        };
      }),
    [authFilesByAuthIndex, openAIProvidersByAuthIndex, rowsForLog]
  );

  const realtimeTotalCount =
    realtimePageRows && usagePages?.realtime
      ? Math.max(0, usagePages.realtime.total_items)
      : realtimeLogRows.length;

  const realtimePagination = useMemo(
    () =>
      realtimePageRows && usagePages?.realtime
        ? {
            currentPage: Math.min(Math.max(1, realtimePage), Math.max(1, Math.ceil(usagePages.realtime.total_items / realtimePageSize))),
            totalPages: Math.max(1, Math.ceil(Math.max(0, usagePages.realtime.total_items) / realtimePageSize)),
            pageItems: realtimeLogRows,
            startItem: usagePages.realtime.total_items > 0 ? (usagePages.realtime.page - 1) * usagePages.realtime.page_size + 1 : 0,
            endItem: usagePages.realtime.total_items > 0
              ? Math.min((usagePages.realtime.page - 1) * usagePages.realtime.page_size + realtimeLogRows.length, usagePages.realtime.total_items)
              : 0,
          }
        : buildPaginationState(realtimeLogRows, realtimePage, realtimePageSize),
    [realtimeLogRows, realtimePage, realtimePageRows, realtimePageSize, usagePages?.realtime]
  );

  useEffect(() => {
    if (autoDisableTick <= 0) return;

    const freshRows = pickNewAutoStrategyRows(
      realtimeLogRows,
      autoStrategySeenEventSetRef.current,
      autoStrategySeenEventKeysRef.current
    );
    if (freshRows.length === 0) return;

    void applyAutoDisable(freshRows);
  }, [applyAutoDisable, autoDisableTick, realtimeLogRows]);

  /* ── filter options (from filterFacets) ────────────────────────────────── */
  const facets = filterFacets ?? EMPTY_FACETS;

  const accountOptions = useMemo(
    () => [
      { value: 'all', label: t('monitoring.filter_all_accounts') },
      ...Array.from(new Map(facets.accounts.map((item) => [item.value, item.label])).entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    ],
    [facets.accounts, t]
  );

  const providerOptions = useMemo(
    () => [
      { value: 'all', label: t('monitoring.filter_all_providers') },
      ...Array.from(new Set(facets.providers))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    ],
    [facets.providers, t]
  );

  const modelOptions = useMemo(
    () => [
      { value: 'all', label: t('monitoring.filter_all_models') },
      ...Array.from(new Set(facets.models))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    ],
    [facets.models, t]
  );

  const channelOptions = useMemo(
    () => [
      { value: 'all', label: t('monitoring.filter_all_channels') },
      ...Array.from(new Set(facets.channels))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    ],
    [facets.channels, t]
  );

  const apiKeyOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    facets.apiKeys.forEach((item) => {
      if (!item.value || optionMap.has(item.value)) return;
      optionMap.set(item.value, item.label || item.value);
    });
    return [
      { value: 'all', label: t('monitoring.filter_all_api_keys') },
      ...Array.from(optionMap.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [facets.apiKeys, t]);

  const statusOptions = useMemo(
    () => {
      const codes = new Set<number>();
      // 从实时数据行提取所有出现过的 HTTP 状态码（非0）
      const rows = realtimePageRows ?? filteredRows;
      rows?.forEach((row) => {
        if (typeof row.statusCode === 'number' && row.statusCode > 0) {
          codes.add(row.statusCode);
        }
      });

      return [
        { value: 'all', label: t('monitoring.filter_all_statuses') },
        ...Array.from(codes)
          .sort((a, b) => a - b)
          .map((code) => ({ value: String(code), label: String(code) })),
      ];
    },
    [realtimePageRows, filteredRows, t]
  );

  const clearFilters = useCallback(() => {
    setSearchInput('');
    setSelectedAccount('all');
    setSelectedProvider('all');
    setSelectedModel('all');
    setSelectedChannel('all');
    setSelectedApiKeyHash('all');
    setSelectedStatus('all');
  }, []);

  const hasActiveFilters =
    searchInput.trim() ||
    selectedAccount !== 'all' ||
    selectedProvider !== 'all' ||
    selectedModel !== 'all' ||
    selectedChannel !== 'all' ||
    selectedApiKeyHash !== 'all' ||
    selectedStatus !== 'all';

  /* ── render ────────────────────────────────────────────────────────────── */
  return (
    <div className={styles.page} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── top control bar: auto-refresh + filters ─────────────────────── */}
      {/*<MonitoringPanel className={styles.toolbarPanel} title={t('monitoring.realtime_table_title')}>*/}
      {/*</MonitoringPanel>*/}

      {/* ── realtime table ──────────────────────────────────────────────── */}
      <div className={styles.realtimePanel}>
        <MonitoringPanel
          title={t('monitoring.realtime_table_title')}
          subtitle={t('monitoring.realtime_table_desc')}
          extra={
            <div className={`${styles.inlineMetrics} ${styles.realtimeHeaderActions}`}>
              <span>{`${t('monitoring.log_rows')}: ${realtimeTotalCount}`}</span>
            </div>
          }
        >
          <div className={styles.controlBar}>
          <div className={styles.refreshControls}>
            <div className={styles.autoRefreshField}>
              <ToggleSwitch
                checked={autoDisableEnabled}
                onChange={(enabled) => {
                  setAutoDisableEnabled(enabled);
                  if (enabled) setAutoDisableTick((value) => value + 1);
                }}
                ariaLabel={t('monitoring.auto_disable_toggle', { defaultValue: 'Toggle auto disable' })}
                label={t('monitoring.auto_disable', { defaultValue: '自动禁用' })}
              />
              <span className={styles.autoRefreshLabel}>
                <IconTimer size={16} />
                {t('monitoring.realtime_stream', { defaultValue: '实时请求流' })}
              </span>
              <span
                className={
                  streamStatus === 'error'
                    ? styles.refreshStatusError
                    : streamStatus === 'connecting'
                      ? styles.refreshStatusLoading
                      : styles.refreshStatusIdle
                }
                title={
                  streamStatus === 'error' && streamErrorMessage
                    ? streamErrorMessage
                    : lastStreamEventAt
                      ? t('monitoring.last_refreshed_at', {
                          time: lastStreamEventAt.toLocaleTimeString(i18n.language),
                          defaultValue: 'Last event: {{time}}',
                        })
                      : undefined
                }
                aria-live="polite"
              >
                {streamStatus === 'error'
                  ? t('monitoring.realtime_stream_reconnecting', { defaultValue: '连接中断，正在重连' })
                  : streamStatus === 'connecting'
                    ? t('monitoring.realtime_stream_connecting', { defaultValue: '正在连接' })
                    : t('monitoring.realtime_stream_live', { defaultValue: '已连接' })}
              </span>
            </div>

            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => void refreshConfiguration()}
              disabled={configurationRefreshing}
            >
              <IconRefreshCw
                size={16}
                className={
                  configurationRefreshing ? styles.refreshIconSpinning : styles.refreshIcon
                }
              />
              <span className={styles.refreshButtonLabel}>
                {t('monitoring.refresh_configuration', { defaultValue: '刷新配置' })}
              </span>
            </button>
            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => setAccountImportOpen(true)}
              // Import only needs auth-files write access; do not gate it on usage/meta loading.
              // overallLoading can stay true if usage-service or auth-files list is slow/stuck.
              disabled={accountImportSaving}
            >
              <IconFileText size={16} className={styles.refreshIcon} />
              <span className={styles.refreshButtonLabel}>{t('monitoring.import_button')}</span>
            </button>
          </div>
        </div>
          <div className={styles.filterBar}>
          <div className={styles.filterGrid}>
            <div className={styles.filterAccountStack}>
              <Select
                value={selectedAccount}
                options={accountOptions}
                onChange={setSelectedAccount}
                ariaLabel={t('monitoring.filter_account')}
              />
            </div>
            <Select
              value={selectedProvider}
              options={providerOptions}
              onChange={setSelectedProvider}
              ariaLabel={t('monitoring.filter_provider')}
            />
            <Select
              value={selectedModel}
              options={modelOptions}
              onChange={setSelectedModel}
              ariaLabel={t('monitoring.filter_model')}
            />
            <Select
              value={selectedChannel}
              options={channelOptions}
              onChange={setSelectedChannel}
              ariaLabel={t('monitoring.filter_channel')}
            />
            <Select
              value={selectedApiKeyHash}
              options={apiKeyOptions}
              onChange={setSelectedApiKeyHash}
              ariaLabel={t('monitoring.filter_api_key')}
            />
            <Select
              value={selectedStatus === 'all' ? 'all' : String(selectedStatus)}
              options={statusOptions}
              onChange={(value) => {
                if (value === 'all') {
                  setSelectedStatus('all');
                } else {
                  const num = Number(value);
                  setSelectedStatus(Number.isFinite(num) ? num : 'all');
                }
              }}
              ariaLabel={t('monitoring.filter_status')}
            />
          </div>

          <div className={styles.filterSearchRow}>
            <div className={styles.filterSearchInputWrap}>
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={t('monitoring.search_placeholder')}
                className={styles.filterSearchInput}
                rightElement={<IconSearch size={16} />}
                aria-label={t('monitoring.search_placeholder')}
              />
            </div>
            {hasActiveFilters ? (
              <div className={styles.filterSearchAction}>
                <button type="button" className={styles.clearButton} onClick={clearFilters}>
                  <IconSlidersHorizontal size={16} />
                  <span>{t('monitoring.clear_filters')}</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
          <PaginationControls
            count={realtimeTotalCount}
            currentPage={realtimePagination.currentPage}
            totalPages={realtimePagination.totalPages}
            startItem={realtimePagination.startItem}
            endItem={realtimePagination.endItem}
            pageSize={realtimePageSize}
            pageSizeOptions={REALTIME_PAGE_SIZE_OPTIONS}
            onPageChange={setRealtimePage}
            onPageSizeChange={(size) => {
              setRealtimePageSize(size);
              setRealtimePage(1);
            }}
            t={t}
          />
          <div className={styles.tableWrapper}>
            <table className={`${styles.table} ${styles.realtimeTable}`}>
              <thead>
                <tr>
                  <th>{t('monitoring.column_type')}</th>
                  <th>{t('monitoring.column_model')}</th>
                  <th>{t('monitoring.realtime_toggle_column', { defaultValue: '启用' })}</th>
                  <th>{t('monitoring.recent_status')}</th>
                  <th>{t('monitoring.request_status')}</th>
                  <th>{t('monitoring.column_success_rate')}</th>
                  <th>{t('monitoring.total_calls')}</th>
                  <th>{t('monitoring.column_latency')}</th>
                  <th>{t('monitoring.column_time')}</th>
                  <th>{t('monitoring.this_call_usage')}</th>
                  <th>{t('monitoring.priority', { defaultValue: '优先级' })}</th>
                </tr>
              </thead>
              <tbody>
                {realtimePagination.pageItems.map((row) => {
                  const sourceDisplay = buildRealtimeSourceDisplay(row, t);
                  const toggleTarget = resolveRealtimeToggleTarget(row);
                  const toggleKey =
                    toggleTarget.kind === 'auth-file'
                      ? `auth-file:${toggleTarget.fileName}`
                      : toggleTarget.kind === 'provider'
                        ? `provider:${toggleTarget.providerName}:${toggleTarget.providerIndex}`
                        : `unavailable:${row.id}`;
                  const toggleDisabled =
                    realtimeToggleUpdatingKey === toggleKey ||
                    overallLoading;
                  if (row.failed) {
                    // 失败请求的详细信息已移除调试日志
                  }
                  return (
                    <tr key={row.id} className={row.failed ? styles.logRowFailed : undefined}>
                      <td>
                        <div className={styles.logTypeCell}>
                          <span
                            className={[
                              styles.logTypeIcon,
                              row.failed ? styles.logTypeIconFailed : styles.logTypeIconSuccess,
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            aria-hidden="true"
                          />
                          <HoverTooltip content={sourceDisplay.tooltip}>
                            <span>{sourceDisplay.provider}</span>
                            <small className={styles.monoCell} style={{ color: 'var(--text-secondary, #9ca3af)' }}>
                              Host: {sourceDisplay.baseHost}
                            </small>
                            <small className={styles.monoCell} style={{ color: 'var(--text-secondary, #9ca3af)', fontFamily: 'ui-monospace, monospace' }}>
                              账号: {sourceDisplay.account}
                            </small>
                          </HoverTooltip>
                        </div>
                      </td>
                      <td>
                        <div className={styles.primaryCell}>
                          <span className={styles.monoCell}>{row.model}</span>
                          {row.resolvedModel && row.resolvedModel !== row.model ? (
                            <small className={styles.monoCell}>
                              ↳ {t('monitoring.resolved_model_label', { model: row.resolvedModel })}
                            </small>
                          ) : null}
                          <small className={styles.monoCell}>{buildRealtimeMetaText(row)}</small>
                        </div>
                      </td>
                      <td>
                        <div className={styles.realtimeToggleCell}>
                          <ToggleSwitch
                            checked={toggleTarget.enabled}
                            disabled={toggleDisabled}
                            onChange={(enabled) => void handleRealtimeToggle(row, enabled)}
                            ariaLabel={
                              toggleTarget.kind === 'provider'
                                ? t('monitoring.realtime_toggle_provider', {
                                    name: toggleTarget.label,
                                    defaultValue: 'Toggle provider {{name}}',
                                  })
                                : toggleTarget.kind === 'auth-file'
                                  ? t('monitoring.realtime_toggle_account', {
                                      name: toggleTarget.label,
                                      defaultValue: 'Toggle account {{name}}',
                                    })
                                  : toggleTarget.reason
                            }
                          />
                          <small className={styles.realtimeToggleHint}>
                            {toggleTarget.kind === 'provider'
                              ? toggleTarget.multiAccount
                                ? t('monitoring.realtime_toggle_scope_provider_multi', {
                                    defaultValue: '提供商级（多账号）',
                                  })
                                : t('monitoring.realtime_toggle_scope_provider', {
                                    defaultValue: 'Provider',
                                  })
                              : toggleTarget.kind === 'auth-file'
                                ? t('monitoring.realtime_toggle_scope_account', {
                                    defaultValue: 'Account',
                                  })
                                : toggleTarget.reason}
                          </small>
                        </div>
                      </td>
                      <td>
                        <RecentPattern pattern={row.recentPattern} />
                      </td>
                      <td>
                        <HoverTooltip content={buildStatusDebugPayload(row)} wide>
                          {row.statusCode > 0 ? (
                            <StatusBadge tone={getStatusBadgeTone(row)}>
                              {row.statusCode}
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone={row.failed ? 'bad' : 'good'}>
                              {row.failed ? t('monitoring.result_failed') : t('monitoring.result_success')}
                            </StatusBadge>
                          )}
                        </HoverTooltip>
                      </td>
                      <td
                        className={
                          row.successRate >= 0.95
                            ? styles.goodText
                            : row.successRate >= 0.85
                              ? styles.warnText
                              : styles.badText
                        }
                      >
                        {formatPercent(row.successRate)}
                      </td>
                      <td>{formatCompactNumber(row.requestCount)}</td>
                      <td>
                        <span
                          className={
                            row.latencyMs !== null && row.latencyMs >= 30000
                              ? styles.badText
                              : row.latencyMs !== null && row.latencyMs >= 15000
                                ? styles.warnText
                                : undefined
                          }
                        >
                          {formatDurationMs(row.latencyMs, { locale: i18n.language })}
                        </span>
                      </td>
                      <td>{new Date(row.timestampMs).toLocaleString(i18n.language)}</td>
                      <td>
                        <div className={styles.primaryCell}>
                          <span>{formatCompactNumber(row.totalTokens)}</span>
                          <small>{`I ${formatCompactNumber(row.inputTokens)} · O ${formatCompactNumber(row.outputTokens)} · C ${formatCompactNumber(row.cachedTokens)}`}</small>
                          <small>{`${t('monitoring.this_call_cost', { defaultValue: '本次花费' })}: ${formatUsd(row.totalCost) || '--'}`}</small>
                        </div>
                      </td>
                      <td>{row.priority}</td>
                    </tr>
                  );
                })}
                {realtimeTotalCount === 0 ? (
                  <tr>
                    <td colSpan={11}>{t('monitoring.empty_state_requests')}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <PaginationControls
            count={realtimeTotalCount}
            currentPage={realtimePagination.currentPage}
            totalPages={realtimePagination.totalPages}
            startItem={realtimePagination.startItem}
            endItem={realtimePagination.endItem}
            pageSize={realtimePageSize}
            pageSizeOptions={REALTIME_PAGE_SIZE_OPTIONS}
            onPageChange={setRealtimePage}
            onPageSizeChange={(size) => {
              setRealtimePageSize(size);
              setRealtimePage(1);
            }}
            t={t}
          />
        </MonitoringPanel>
      </div>

      <AccountImportModal
        open={accountImportOpen}
        saving={accountImportSaving}
        onClose={() => setAccountImportOpen(false)}
        onImport={handleAccountImport}
      />
    </div>
  );
}
