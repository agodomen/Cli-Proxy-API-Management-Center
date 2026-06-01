import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { Select } from '@/components/ui/Select';
import {
  IconChevronDown,
  IconChevronUp,
  IconCheck,
  IconExternalLink,
  IconBot,
  IconRefreshCw,
  IconSettings,
  IconShield,
  IconTimer,
  IconTrash2,
  IconPencil,
} from '@/components/ui/icons';
import { IconCrosshair } from '@/external/components/ui/icons';
import {
  applyCodexInspectionExecutionResult,
  buildCodexInspectionError,
  buildExecutionFailureMessage,
  clearCodexInspectionConfigurableSettings,
  createCodexInspectionConnectionFingerprint,
  createCodexInspectionSession,
  DEFAULT_CODEX_INSPECTION_SETTINGS,
  CODEX_INSPECTION_AUTO_ACTION_MODES,
  CODEX_INSPECTION_PROBE_PROMPT_MODES,
  INSPECTION_ACCOUNT_SOURCES,
  INSPECTION_API_KEY_FAMILIES,
  SUPPORTED_INSPECTION_TARGET_TYPES,
  isApiKeyInspectionAccount,
  matchesInspectionApiKeyFamily,
  normalizeInspectionAccountSource,
  normalizeInspectionApiKeyFamily,
  executeCodexInspectionActions,
  isCodexInspectionStoppedError,
  isSuggestedAction,
  isSupportedInspectionTargetType,
  loadCodexInspectionLastRun,
  matchesInspectionTargetType,
  resolveCodexInspectionAutoActionItems,
  resolveCodexInspectionRealtimeActionItems,
  loadCodexInspectionConfigurableSettings,
  normalizeRealtimeAutoActions,
  saveCodexInspectionLastRun,
  saveCodexInspectionConfigurableSettings,
  type CodexInspectionAction,
  type CodexInspectionAutoActionMode,
  type CodexInspectionConfigurableSettings,
  type CodexInspectionProbePromptMode,
  type CodexInspectionRealtimeAutoActions,
  type InspectionAccountSource,
  type CodexInspectionLogLevel,
  type CodexInspectionProgressSnapshot,
  type CodexInspectionResultItem,
  type CodexInspectionRunResult,
  type CodexInspectionSession,
  type CodexInspectionStoredActionFilter,
  type CodexInspectionStoredLogEntry,
} from '@/external/features/monitoring/codexInspection';
import { authFilesApi } from '@/external/services/api/authFiles';
import type { AuthFileFieldsPatch } from '@/services/api/authFiles';
import { isDisabledAuthFile, resolveAuthProvider } from '@/utils/quota';
import { resetAuthRoutingCooldown } from '@/external/services/api/authQuota';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import styles from './CodexInspectionPage.module.scss';

type RunStatus = 'idle' | 'running' | 'paused' | 'success' | 'error';

type ActionFilter = CodexInspectionStoredActionFilter | `http:${string}`;

type StatusTone = 'idle' | 'info' | 'good' | 'warn' | 'bad';

type InspectionLogEntry = CodexInspectionStoredLogEntry;

type ExecutionTriggerSource = 'manual' | 'auto' | 'realtime';

type SummaryCard = {
  key: string;
  label: string;
  value: string;
  meta: string;
  tone?: StatusTone;
  subs?: { label: string; value: string; tone?: StatusTone }[];
  /** Account enable/disable counts shown at the bottom of every summary card. */
  accountState?: { enabled: number; disabled: number } | null;
};

type InspectionSettingsDraft = {
  accountSource: InspectionAccountSource;
  targetType: string;
  workers: string;
  deleteWorkers: string;
  timeout: string;
  retries: string;
  userAgent: string;
  usedPercentThreshold: string;
  sampleSize: string;
  probePromptMode: CodexInspectionProbePromptMode;
  probeModel: string;
  providerFilter: string;
  autoActionMode: CodexInspectionAutoActionMode;
  realtimeAutoActions: CodexInspectionRealtimeAutoActions;
};

type InspectionSettingsDraftField = Exclude<
  keyof InspectionSettingsDraft,
  'autoActionMode' | 'probePromptMode' | 'realtimeAutoActions'
>;

type ManualUpdateDraft = {
  updateHeaders: boolean;
  headersJson: string;
  updatePriority: boolean;
  priority: string;
  updateProxyUrl: boolean;
  proxyUrl: string;
};

const buildDefaultManualHeadersJson = (userAgent = ''): string => {
  const trimmed = String(userAgent ?? '').trim();
  if (trimmed) {
    return JSON.stringify({ 'User-Agent': trimmed }, null, 2);
  }
  return '{\n  "User-Agent": ""\n}';
};

const createEmptyManualUpdateDraft = (userAgent = ''): ManualUpdateDraft => ({
  updateHeaders: true,
  headersJson: buildDefaultManualHeadersJson(userAgent),
  updatePriority: false,
  priority: '',
  updateProxyUrl: false,
  proxyUrl: '',
});

type ManualHeadersParseResult =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; error: 'empty' | 'invalid_json' | 'not_object' | 'invalid_value' };

const parseManualUpdateHeadersJson = (raw: string): ManualHeadersParseResult => {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { ok: false, error: 'empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'not_object' };
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const name = String(key ?? '').trim();
    if (!name) continue;
    if (value === null || value === undefined) {
      headers[name] = '';
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      headers[name] = String(value);
      continue;
    }
    return { ok: false, error: 'invalid_value' };
  }

  if (Object.keys(headers).length === 0) {
    return { ok: false, error: 'empty' };
  }

  return { ok: true, headers };
};

type PanelProps = {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
};

type SettingsSectionProps = {
  icon: ReactNode;
  title: string;
  children: ReactNode;
};

const STATIC_ACTION_FILTERS: CodexInspectionStoredActionFilter[] = [
  'all',
  'delete',
  'disable',
  'enable',
];

const HTTP_FILTER_PREFIX = 'http:';
const HTTP_UNKNOWN_FILTER = 'http:unknown' as const;

const isHttpStatusFilter = (value: string): value is `http:${string}` =>
  value.startsWith(HTTP_FILTER_PREFIX);

const isActionFilter = (value: unknown): value is ActionFilter => {
  if (typeof value !== 'string') return false;
  if ((STATIC_ACTION_FILTERS as string[]).includes(value)) return true;
  return isHttpStatusFilter(value);
};

const normalizeActionFilter = (value: unknown): ActionFilter =>
  isActionFilter(value) ? value : 'all';

const toStoredActionFilter = (value: ActionFilter): CodexInspectionStoredActionFilter =>
  value === 'delete' || value === 'disable' || value === 'enable' || value === 'all' ? value : 'all';

const toHttpStatusFilter = (statusCode: number | null): ActionFilter =>
  statusCode === null || !Number.isFinite(statusCode)
    ? HTTP_UNKNOWN_FILTER
    : (`http:${Math.trunc(statusCode)}` as ActionFilter);

const parseHttpStatusFilter = (filter: ActionFilter): number | null | undefined => {
  if (!isHttpStatusFilter(filter)) return undefined;
  if (filter === HTTP_UNKNOWN_FILTER) return null;
  const parsed = Number(filter.slice(HTTP_FILTER_PREFIX.length));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

const collectHttpStatusFilters = (items: CodexInspectionResultItem[]): ActionFilter[] => {
  const codes = new Set<number>();
  let hasUnknown = false;
  items.forEach((item) => {
    if (item.statusCode === null || !Number.isFinite(item.statusCode)) {
      hasUnknown = true;
      return;
    }
    codes.add(Math.trunc(item.statusCode));
  });
  const sorted = Array.from(codes).sort((a, b) => a - b);
  const filters: ActionFilter[] = sorted.map((code) => toHttpStatusFilter(code));
  if (hasUnknown) filters.push(HTTP_UNKNOWN_FILTER);
  return filters;
};

const actionToneClass: Record<CodexInspectionAction, string> = {
  keep: styles.actionKeep,
  delete: styles.actionDelete,
  disable: styles.actionDisable,
  enable: styles.actionEnable,
};

const levelClassMap: Record<CodexInspectionLogLevel, string> = {
  info: styles.logInfo,
  success: styles.logSuccess,
  warning: styles.logWarning,
  error: styles.logError,
};

const formatTimestamp = (value: number, locale: string) => new Date(value).toLocaleString(locale);
const formatTime = (value: number, locale: string) => new Date(value).toLocaleTimeString(locale);

const formatPercent = (value: number | null) => (value === null ? '--' : `${value.toFixed(1)}%`);

const toSettingsDraft = (settings: CodexInspectionConfigurableSettings): InspectionSettingsDraft => ({
  accountSource: settings.accountSource,
  targetType: settings.targetType,
  workers: String(settings.workers),
  deleteWorkers: String(settings.deleteWorkers),
  timeout: String(settings.timeout),
  retries: String(settings.retries),
  userAgent: settings.userAgent,
  usedPercentThreshold: String(settings.usedPercentThreshold),
  sampleSize: String(settings.sampleSize),
  probePromptMode: settings.probePromptMode,
  probeModel: settings.probeModel,
  providerFilter: settings.providerFilter,
  autoActionMode: settings.autoActionMode,
  realtimeAutoActions: normalizeRealtimeAutoActions(
    settings.realtimeAutoActions,
    settings.accountSource
  ),
});

const formatActionLabel = (action: CodexInspectionAction, t: TFunction) => {
  switch (action) {
    case 'delete':
      return t('monitoring.codex_inspection_action_delete');
    case 'disable':
      return t('monitoring.codex_inspection_action_disable');
    case 'enable':
      return t('monitoring.codex_inspection_action_enable');
    case 'keep':
    default:
      return t('monitoring.codex_inspection_action_keep');
  }
};

const formatCurrentStateLabel = (item: CodexInspectionResultItem, t: TFunction) => {
  if (item.disabled) return t('monitoring.codex_inspection_state_disabled');
  return t('monitoring.codex_inspection_state_enabled');
};

const countActions = (items: CodexInspectionResultItem[]) => {
  const summary = {
    delete: 0,
    disable: 0,
    enable: 0,
  };

  items.forEach((item) => {
    if (item.action === 'delete') summary.delete += 1;
    if (item.action === 'disable') summary.disable += 1;
    if (item.action === 'enable') summary.enable += 1;
  });

  return summary;
};

const createIdleProgressSnapshot = (): CodexInspectionProgressSnapshot => ({
  total: 0,
  completed: 0,
  inFlight: 0,
  pending: 0,
  percent: 0,
  status: 'idle',
  summary: {
    totalFiles: 0,
    probeSetCount: 0,
    sampledCount: 0,
    disabledCount: 0,
    enabledCount: 0,
    deleteCount: 0,
    disableCount: 0,
    enableCount: 0,
    keepCount: 0,
  },
  startedAt: Date.now(),
  updatedAt: Date.now(),
});

const createCompletedProgressSnapshot = (
  result: CodexInspectionRunResult
): CodexInspectionProgressSnapshot => {
  const total = Math.max(0, result.summary.sampledCount || result.results.length);
  return {
    total,
    completed: total,
    inFlight: 0,
    pending: 0,
    percent: total > 0 ? 100 : 0,
    status: 'completed',
    summary: {
      totalFiles: result.summary.totalFiles,
      probeSetCount: result.summary.probeSetCount,
      sampledCount: result.summary.sampledCount,
      disabledCount: result.summary.disabledCount,
      enabledCount: result.summary.enabledCount,
      deleteCount: result.summary.deleteCount,
      disableCount: result.summary.disableCount,
      enableCount: result.summary.enableCount,
      keepCount: result.summary.keepCount,
    },
    startedAt: result.startedAt,
    updatedAt: result.finishedAt || Date.now(),
  };
};

const countAccountStates = (items: Array<{ disabled?: boolean }>) => {
  let enabled = 0;
  let disabled = 0;
  items.forEach((item) => {
    if (item.disabled) disabled += 1;
    else enabled += 1;
  });
  return { enabled, disabled };
};

const filterByAction = (items: CodexInspectionResultItem[], filter: ActionFilter) => {
  if (filter === 'all') return items.filter(isSuggestedAction);
  const statusCode = parseHttpStatusFilter(filter);
  if (statusCode !== undefined) {
    return items.filter((item) => {
      if (statusCode === null) {
        return item.statusCode === null || !Number.isFinite(item.statusCode);
      }
      return item.statusCode === statusCode;
    });
  }
  return items.filter((item) => item.action === filter);
};

const formatAutoActionModeLabel = (mode: CodexInspectionAutoActionMode, t: TFunction) => {
  switch (mode) {
    case 'strategy6':
      return t('monitoring.codex_inspection_settings_auto_action_mode_strategy6');
    case 'strategy5':
      return t('monitoring.codex_inspection_settings_auto_action_mode_strategy5');
    case 'strategy4':
      return t('monitoring.codex_inspection_settings_auto_action_mode_strategy4');
    case 'delete':
      return t('monitoring.codex_inspection_settings_auto_action_mode_delete');
    case 'disable':
      return t('monitoring.codex_inspection_settings_auto_action_mode_disable');
    case 'none':
    default:
      return t('monitoring.codex_inspection_settings_auto_action_mode_none');
  }
};

const getAutoActionWarningKey = (mode: CodexInspectionAutoActionMode) => {
  switch (mode) {
    case 'delete':
      return 'monitoring.codex_inspection_settings_auto_action_mode_delete_warning';
    case 'strategy4':
      return 'monitoring.codex_inspection_settings_auto_action_mode_strategy4_warning';
    case 'strategy5':
      return 'monitoring.codex_inspection_settings_auto_action_mode_strategy5_warning';
    case 'strategy6':
      return 'monitoring.codex_inspection_settings_auto_action_mode_strategy6_warning';
    case 'disable':
    default:
      return 'monitoring.codex_inspection_settings_auto_action_mode_disable_warning';
  }
};

function Panel({ title, subtitle, extra, children, className }: PanelProps) {
  return (
    <Card className={[styles.panel, className].filter(Boolean).join(' ')}>
      <div className={styles.panelHeader}>
        <div className={styles.panelHeading}>
          <h2 className={styles.panelTitle}>{title}</h2>
          {subtitle ? <p className={styles.panelSubtitle}>{subtitle}</p> : null}
        </div>
        {extra ? <div className={styles.panelExtra}>{extra}</div> : null}
      </div>
      {children}
    </Card>
  );
}

function SettingsSection({ icon, title, children }: SettingsSectionProps) {
  return (
    <section className={styles.settingsSectionCard}>
      <header className={styles.settingsSectionHeader}>
        <span className={styles.settingsSectionIcon}>{icon}</span>
        <span>{title}</span>
      </header>
      {children}
    </section>
  );
}

export function CodexInspectionPage() {
  const { t, i18n } = useTranslation();
  const config = useConfigStore((state) => state.config);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const connectionFingerprint = useMemo(
    () => createCodexInspectionConnectionFingerprint(apiBase, managementKey),
    [apiBase, managementKey]
  );

  const [probeStats, setProbeStats] = useState<{total: number; enabled: number; disabled: number} | null>(null);
  const [probeStatsRefreshing, setProbeStatsRefreshing] = useState(false);
  const initialLastRunRef = useRef<ReturnType<typeof loadCodexInspectionLastRun> | undefined>(
    undefined
  );
  if (initialLastRunRef.current === undefined) {
    initialLastRunRef.current = connectionFingerprint
      ? loadCodexInspectionLastRun(connectionFingerprint)
      : null;
  }
  const initialLastRun = initialLastRunRef.current;

  const [inspectionSettings, setInspectionSettings] = useState<CodexInspectionConfigurableSettings>(() =>
    loadCodexInspectionConfigurableSettings(config)
  );
  const [settingsDraft, setSettingsDraft] = useState<InspectionSettingsDraft>(() =>
    toSettingsDraft(loadCodexInspectionConfigurableSettings(config))
  );
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateDraft, setUpdateDraft] = useState<ManualUpdateDraft>(() =>
    createEmptyManualUpdateDraft(loadCodexInspectionConfigurableSettings(config).userAgent)
  );
  const [updateProgress, setUpdateProgress] = useState<{ done: number; total: number } | null>(null);
  const [logs, setLogs] = useState<InspectionLogEntry[]>(() => initialLastRun?.logs ?? []);
  const [logsCollapsed, setLogsCollapsed] = useState(() => initialLastRun?.logsCollapsed ?? true);
  const [runStatus, setRunStatus] = useState<RunStatus>(() =>
    initialLastRun?.result ? 'success' : 'idle'
  );
  const [progress, setProgress] = useState<CodexInspectionProgressSnapshot>(() =>
    initialLastRun?.result
      ? createCompletedProgressSnapshot(initialLastRun.result)
      : createIdleProgressSnapshot()
  );
  const [result, setResult] = useState<CodexInspectionRunResult | null>(
    () => initialLastRun?.result ?? null
  );
  const [resultConnectionFingerprint, setResultConnectionFingerprint] = useState<string | null>(
    () => initialLastRun?.connectionFingerprint ?? null
  );
  const [executing, setExecuting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [resettingCooldownKey, setResettingCooldownKey] = useState('');
  const [actionFilter, setActionFilter] = useState<ActionFilter>(
    () => normalizeActionFilter(initialLastRun?.actionFilter)
  );
  const logCounterRef = useRef(initialLastRun?.logs.length ?? 0);
  const sessionRef = useRef<CodexInspectionSession | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const restoredConnectionFingerprintRef = useRef<string | null>(connectionFingerprint);
  const logListRef = useRef<HTMLDivElement | null>(null);
  // When true, session finish should execute all suggested actions (ignore autoActionMode=none).
  const finishAndExecuteRef = useRef(false);
  const executeItemsRef = useRef<
    ((
      items: CodexInspectionResultItem[],
      options?: {
        resultOverride?: CodexInspectionRunResult | null;
        source?: ExecutionTriggerSource;
        connectionFingerprint?: string | null;
      }
    ) => Promise<void>) | null
  >(null);
  /** fileNames claimed by realtime auto-apply (in-flight or success). */
  const realtimeClaimedKeysRef = useRef<Set<string>>(new Set());
  /** Successful realtime outcomes keyed by fileName. */
  const realtimeAppliedKeysRef = useRef<Set<string>>(new Set());
  const realtimeChainRef = useRef(Promise.resolve());
  const resultRef = useRef<CodexInspectionRunResult | null>(result);
  const inspectionSettingsRef = useRef(inspectionSettings);
  const autoActionModeForRunRef = useRef<CodexInspectionAutoActionMode>(
    inspectionSettings.autoActionMode
  );

  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  useEffect(() => {
    inspectionSettingsRef.current = inspectionSettings;
  }, [inspectionSettings]);

  useEffect(() => {
    if (restoredConnectionFingerprintRef.current === connectionFingerprint) return;
    restoredConnectionFingerprintRef.current = connectionFingerprint;

    activeSessionIdRef.current = null;
    sessionRef.current?.stop();
    sessionRef.current = null;
    setExecuting(false);

    const restored = connectionFingerprint
      ? loadCodexInspectionLastRun(connectionFingerprint)
      : null;

    setLogs(restored?.logs ?? []);
    setLogsCollapsed(restored?.logsCollapsed ?? true);
    setRunStatus(restored?.result ? 'success' : 'idle');
    setProgress(
      restored?.result
        ? createCompletedProgressSnapshot(restored.result)
        : createIdleProgressSnapshot()
    );
    setResult(restored?.result ?? null);
    setResultConnectionFingerprint(restored?.connectionFingerprint ?? null);
    setActionFilter(normalizeActionFilter(restored?.actionFilter));
    logCounterRef.current = restored?.logs.length ?? 0;
  }, [connectionFingerprint]);

  // 连接或巡检设置变更时，重新计算巡检集合统计
  const refreshProbeStats = useCallback(async () => {
    if (!connectionFingerprint) {
      setProbeStats(null);
      return null;
    }
    try {
      const response = await authFilesApi.list();
      const files = Array.isArray(response.files) ? response.files : [];
      const targetType = inspectionSettings.targetType;
      const accountSource = inspectionSettings.accountSource;
      // Keep provider resolution aligned with the inspection runner.
      const providerFilter = (inspectionSettings.providerFilter || '').trim().toLowerCase();
      const probeSet = files.filter((file) => {
        if (accountSource === 'api_key') {
          if (!isApiKeyInspectionAccount(file)) return false;
          if (
            !matchesInspectionApiKeyFamily(
              resolveAuthProvider(file),
              normalizeInspectionApiKeyFamily(targetType, 'all')
            )
          ) {
            return false;
          }
          if (providerFilter) {
            const haystack = [
              resolveAuthProvider(file),
              String(file.label || ''),
              String(file.name || ''),
              String(file.id || ''),
              String((file as { base_url?: string }).base_url || ''),
              String((file as { baseUrl?: string }).baseUrl || ''),
            ]
              .join(' ')
              .toLowerCase();
            if (!haystack.includes(providerFilter)) return false;
          }
          return true;
        }
        if (isApiKeyInspectionAccount(file)) return false;
        return matchesInspectionTargetType(resolveAuthProvider(file), targetType);
      });
      const total = probeSet.length;
      const disabled = probeSet.filter((file) => isDisabledAuthFile(file)).length;
      const enabled = total - disabled;
      const next = { total, enabled, disabled };
      setProbeStats(next);
      return next;
    } catch (error) {
      console.warn('[CodexInspectionPage] refresh probe stats failed', error);
      // Keep previous stats when the list call fails transiently.
      return null;
    }
  }, [
    connectionFingerprint,
    inspectionSettings.accountSource,
    inspectionSettings.providerFilter,
    inspectionSettings.targetType,
  ]);

  const handleRefreshProbeStats = useCallback(async () => {
    if (probeStatsRefreshing) return;
    if (connectionStatus !== 'connected') {
      showNotification(t('notification.connection_required'), 'warning');
      return;
    }
    setProbeStatsRefreshing(true);
    try {
      const next = await refreshProbeStats();
      if (!next) {
        showNotification(
          t('monitoring.codex_inspection_refresh_stats_failed', {
            defaultValue: '刷新账号统计失败',
          }),
          'error'
        );
        return;
      }
      showNotification(
        t('monitoring.codex_inspection_refresh_stats_success', {
          total: next.total,
          enabled: next.enabled,
          disabled: next.disabled,
          defaultValue: '已刷新：总计 {{total}} / 启用 {{enabled}} / 禁用 {{disabled}}',
        }),
        'success'
      );
    } finally {
      setProbeStatsRefreshing(false);
    }
  }, [connectionStatus, probeStatsRefreshing, refreshProbeStats, showNotification, t]);

  const handleQuickAccountSourceChange = useCallback(
    (value: string) => {
      const nextSource = normalizeInspectionAccountSource(value, inspectionSettings.accountSource);
      if (nextSource === inspectionSettings.accountSource) return;

      const nextTargetType =
        nextSource === 'api_key'
          ? normalizeInspectionApiKeyFamily(inspectionSettings.targetType, 'all')
          : isSupportedInspectionTargetType(inspectionSettings.targetType)
            ? inspectionSettings.targetType
            : 'codex';

      // API Key source must not auto-delete.
      const nextAuto =
        nextSource === 'api_key' &&
        (inspectionSettings.autoActionMode === 'delete' ||
          inspectionSettings.autoActionMode === 'strategy4' ||
          inspectionSettings.autoActionMode === 'strategy5' ||
          inspectionSettings.autoActionMode === 'strategy6')
          ? 'none'
          : inspectionSettings.autoActionMode;

      const nextSettings = saveCodexInspectionConfigurableSettings({
        ...inspectionSettings,
        accountSource: nextSource,
        targetType: nextTargetType,
        autoActionMode: nextAuto,
      });
      setInspectionSettings(nextSettings);
      setSettingsDraft(toSettingsDraft(nextSettings));
      showNotification(
        t('monitoring.codex_inspection_account_source_switched', {
          source: t(`monitoring.codex_inspection_account_source_${nextSource}`, {
            defaultValue: nextSource,
          }),
          defaultValue: '已切换账号源：{{source}}',
        }),
        'success'
      );
    },
    [inspectionSettings, showNotification, t]
  );

  const handleQuickTargetTypeChange = useCallback(
    (value: string) => {
      const nextType = value.trim().toLowerCase();
      if (inspectionSettings.accountSource === 'api_key') {
        if (!normalizeInspectionApiKeyFamily(nextType, 'all') && nextType !== 'all') {
          // normalize always returns valid family
        }
        const family = normalizeInspectionApiKeyFamily(nextType, 'all');
        if (family === inspectionSettings.targetType) return;
        const nextSettings = saveCodexInspectionConfigurableSettings({
          ...inspectionSettings,
          targetType: family,
        });
        setInspectionSettings(nextSettings);
        setSettingsDraft(toSettingsDraft(nextSettings));
        showNotification(
          t('monitoring.codex_inspection_target_type_switched', {
            type: family,
            defaultValue: '已切换认证类型：{{type}}',
          }),
          'success'
        );
        return;
      }

      if (!isSupportedInspectionTargetType(nextType)) {
        showNotification(t('monitoring.codex_inspection_settings_target_type_unsupported'), 'error');
        return;
      }
      if (nextType === inspectionSettings.targetType) return;

      const nextSettings = saveCodexInspectionConfigurableSettings({
        ...inspectionSettings,
        targetType: nextType,
      });
      setInspectionSettings(nextSettings);
      setSettingsDraft(toSettingsDraft(nextSettings));
      showNotification(
        t('monitoring.codex_inspection_target_type_switched', {
          type: nextType,
          defaultValue: '已切换认证类型：{{type}}',
        }),
        'success'
      );
    },
    [inspectionSettings, showNotification, t]
  );

  const accountSourceOptions = useMemo(
    () =>
      INSPECTION_ACCOUNT_SOURCES.map((source) => ({
        value: source,
        label: t(`monitoring.codex_inspection_account_source_${source}`, {
          defaultValue: source === 'api_key' ? 'API Key 提供商' : 'OAuth 认证文件',
        }),
      })),
    [t]
  );

  const targetTypeOptions = useMemo(() => {
    if (inspectionSettings.accountSource === 'api_key') {
      return INSPECTION_API_KEY_FAMILIES.map((family) => ({
        value: family,
        label: t(`monitoring.codex_inspection_api_key_family_${family.replace('-', '_')}`, {
          defaultValue:
            family === 'all'
              ? '全部 API Key'
              : family === 'openai-compat'
                ? 'OpenAI Compatible'
                : family,
        }),
      }));
    }
    return SUPPORTED_INSPECTION_TARGET_TYPES.map((type) => ({
      value: type,
      label: t(`monitoring.codex_inspection_target_type_option_${type.replace('-', '_')}`, {
        defaultValue: type,
      }),
    }));
  }, [inspectionSettings.accountSource, t]);

  useEffect(() => {
    void refreshProbeStats();
  }, [refreshProbeStats]);

  // Re-count the live pool after a finished run or action execution updates auth files.
  useEffect(() => {
    if (!result || result.finishedAt <= 0) return;
    if (runStatus === 'running' || runStatus === 'paused' || executing || finishing) return;
    void refreshProbeStats();
  }, [executing, finishing, refreshProbeStats, result, runStatus]);

  useEffect(() => {
    const nextSettings = loadCodexInspectionConfigurableSettings(config);
    setInspectionSettings(nextSettings);
    if (!isSettingsModalOpen) {
      setSettingsDraft(toSettingsDraft(nextSettings));
    }
  }, [config, isSettingsModalOpen]);

  useEffect(() => {
    if (!result || result.finishedAt <= 0) return;
    if (runStatus === 'running' || runStatus === 'paused') return;
    if (!connectionFingerprint || resultConnectionFingerprint !== connectionFingerprint) return;
    saveCodexInspectionLastRun({
      result,
      logs,
      logsCollapsed,
      actionFilter: toStoredActionFilter(actionFilter),
      connectionFingerprint,
    });
  }, [
    actionFilter,
    connectionFingerprint,
    logs,
    logsCollapsed,
    result,
    resultConnectionFingerprint,
    runStatus,
  ]);

  const appendLog = useCallback((level: CodexInspectionLogLevel, message: string) => {
    logCounterRef.current += 1;
    setLogs((previous) => [
      ...previous,
      {
        id: `${Date.now()}-${logCounterRef.current}`,
        level,
        message,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const scrollLogsToBottom = useCallback(() => {
    const element = logListRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, []);

  useEffect(() => {
    if (logsCollapsed) return;
    scrollLogsToBottom();
  }, [logs, logsCollapsed, scrollLogsToBottom]);

  useEffect(() => {
    return () => {
      activeSessionIdRef.current = null;
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  const mergeRealtimeAppliedIntoResult = useCallback(
    (runResult: CodexInspectionRunResult): CodexInspectionRunResult => {
      const applied = realtimeAppliedKeysRef.current;
      if (applied.size === 0) return runResult;

      let changed = false;
      const nextResults = runResult.results.map((item) => {
        if (!applied.has(item.fileName) || item.action === 'keep') return item;
        changed = true;
        return {
          ...item,
          action: 'keep' as const,
          actionReason: t('monitoring.codex_inspection_realtime_applied_reason', {
            defaultValue: '已实时执行',
          }),
          error: '',
        };
      });
      if (!changed) return runResult;

      const deleteCount = nextResults.filter((item) => item.action === 'delete').length;
      const disableCount = nextResults.filter((item) => item.action === 'disable').length;
      const enableCount = nextResults.filter((item) => item.action === 'enable').length;
      const keepCount = nextResults.length - deleteCount - disableCount - enableCount;
      return {
        ...runResult,
        results: nextResults,
        summary: {
          ...runResult.summary,
          deleteCount,
          disableCount,
          enableCount,
          keepCount,
        },
      };
    },
    [t]
  );

  const scheduleRealtimeAutoActions = useCallback(
    (
      nextResult: CodexInspectionRunResult,
      autoActionMode: CodexInspectionAutoActionMode,
      runConnectionFingerprint: string | null
    ) => {
      if (autoActionMode === 'none') return;
      const settings = inspectionSettingsRef.current;
      const candidates = resolveCodexInspectionRealtimeActionItems(
        autoActionMode,
        nextResult.results.filter(isSuggestedAction),
        settings.realtimeAutoActions,
        settings.accountSource
      );
      const fresh = candidates.filter(
        (item) => !realtimeClaimedKeysRef.current.has(item.fileName)
      );
      if (fresh.length === 0) return;

      fresh.forEach((item) => realtimeClaimedKeysRef.current.add(item.fileName));
      appendLog(
        'info',
        t('monitoring.codex_inspection_realtime_execute_queued', {
          count: fresh.length,
          defaultValue: '实时执行已排队 {{count}} 个建议动作',
        })
      );

      realtimeChainRef.current = realtimeChainRef.current
        .then(async () => {
          if (!executeItemsRef.current) return;
          const targets = fresh.filter(
            (item) => !realtimeAppliedKeysRef.current.has(item.fileName)
          );
          if (targets.length === 0) return;
          const baseResult = mergeRealtimeAppliedIntoResult(
            resultRef.current ?? nextResult
          );
          await executeItemsRef.current(targets, {
            resultOverride: baseResult,
            source: 'realtime',
            connectionFingerprint: runConnectionFingerprint,
          });
        })
        .catch((error) => {
          // Unclaim failures so end-of-run can retry.
          fresh.forEach((item) => {
            if (!realtimeAppliedKeysRef.current.has(item.fileName)) {
              realtimeClaimedKeysRef.current.delete(item.fileName);
            }
          });
          appendLog(
            'error',
            t('monitoring.codex_inspection_realtime_execute_failed', {
              error: error instanceof Error ? error.message : String(error || 'unknown'),
              defaultValue: '实时执行失败：{{error}}',
            })
          );
        });
    },
    [appendLog, mergeRealtimeAppliedIntoResult, t]
  );

  const attachSessionPromise = useCallback(
    (
      session: CodexInspectionSession,
      promise: Promise<CodexInspectionRunResult>,
      autoActionMode: CodexInspectionAutoActionMode,
      runConnectionFingerprint: string | null
    ) => {
      const sessionId = session.id;

      void promise
        .then(async (rawResult) => {
          if (activeSessionIdRef.current !== sessionId) return;
          // Drain in-flight realtime applies before end-of-run auto-exec.
          try {
            await realtimeChainRef.current;
          } catch {
            // ignore; individual failures already logged
          }
          if (activeSessionIdRef.current !== sessionId) return;

          const nextResult = mergeRealtimeAppliedIntoResult(rawResult);
          const nextActionableResults = nextResult.results.filter(isSuggestedAction);
          const forceExecuteSuggested = finishAndExecuteRef.current;
          finishAndExecuteRef.current = false;
          const resolvedTargets = forceExecuteSuggested
            ? nextActionableResults
            : resolveCodexInspectionAutoActionItems(autoActionMode, nextActionableResults);
          // Skip accounts already applied during the run.
          const autoTargets = resolvedTargets.filter(
            (item) => !realtimeAppliedKeysRef.current.has(item.fileName)
          );
          setResult(nextResult);
          setResultConnectionFingerprint(runConnectionFingerprint);
          setProgress(session.getProgress());
          setRunStatus('success');
          // Keep logs open while finishing executes actions so users see immediate feedback.
          setLogsCollapsed(forceExecuteSuggested ? false : true);

          if (forceExecuteSuggested) {
            if (autoTargets.length > 0 && executeItemsRef.current) {
              const startedMessage = t('monitoring.codex_inspection_finish_execute_started', {
                count: autoTargets.length,
              });
              appendLog('info', startedMessage);
              showNotification(startedMessage, 'info');
              // Clear finishing only after handoff to executeItems (which sets executing).
              setFinishing(false);
              void executeItemsRef.current(autoTargets, {
                resultOverride: nextResult,
                source: 'auto',
                connectionFingerprint: runConnectionFingerprint,
              });
              return;
            }

            setFinishing(false);
            const finishedMessage =
              nextActionableResults.length === 0
                ? t('monitoring.codex_inspection_finish_no_actions')
                : t('monitoring.codex_inspection_run_success');
            appendLog('success', finishedMessage);
            showNotification(finishedMessage, 'success');
            return;
          }

          setFinishing(false);

          if (autoActionMode !== 'none') {
            if (autoTargets.length > 0 && executeItemsRef.current) {
              const startedMessage = t('monitoring.codex_inspection_auto_execute_started', {
                count: autoTargets.length,
                mode: formatAutoActionModeLabel(autoActionMode, t),
              });
              appendLog('info', startedMessage);
              showNotification(startedMessage, 'info');
              void executeItemsRef.current(autoTargets, {
                resultOverride: nextResult,
                source: 'auto',
                connectionFingerprint: runConnectionFingerprint,
              });
              return;
            }

            if (nextActionableResults.length > 0 && resolvedTargets.length === 0) {
              const skippedMessage = t('monitoring.codex_inspection_auto_execute_skipped_by_mode', {
                mode: formatAutoActionModeLabel(autoActionMode, t),
                count: nextActionableResults.length,
              });
              appendLog('warning', skippedMessage);
              showNotification(skippedMessage, 'info');
              return;
            }

            if (
              nextActionableResults.length > 0 &&
              autoTargets.length === 0 &&
              realtimeAppliedKeysRef.current.size > 0
            ) {
              const realtimeDoneMessage = t(
                'monitoring.codex_inspection_realtime_execute_all_done',
                {
                  count: realtimeAppliedKeysRef.current.size,
                  defaultValue: '实时执行已处理全部建议动作（{{count}}）',
                }
              );
              appendLog('success', realtimeDoneMessage);
              showNotification(realtimeDoneMessage, 'success');
              return;
            }

            if (nextActionableResults.length > 0) {
              const skippedMessage = t('monitoring.codex_inspection_auto_execute_skipped_by_mode', {
                mode: formatAutoActionModeLabel(autoActionMode, t),
                count: nextActionableResults.length,
              });
              appendLog('warning', skippedMessage);
              showNotification(skippedMessage, 'info');
              return;
            }
          }

          const noActionsMessage =
            nextActionableResults.length === 0
              ? t('monitoring.codex_inspection_auto_execute_no_actions')
              : t('monitoring.codex_inspection_run_success');
          appendLog('success', noActionsMessage);
          showNotification(noActionsMessage, 'success');
        })
        .catch((error) => {
          if (activeSessionIdRef.current !== sessionId) return;
          setFinishing(false);
          if (isCodexInspectionStoppedError(error)) {
            setRunStatus('idle');
            setProgress(createIdleProgressSnapshot());
            return;
          }

          const message = buildCodexInspectionError(
            error instanceof Error ? error.message : String(error || t('common.unknown_error'))
          );
          appendLog('error', message);
          setRunStatus('error');
          setLogsCollapsed(false);
          showNotification(message, 'error');
        });
    },
    [appendLog, mergeRealtimeAppliedIntoResult, showNotification, t]
  );

  const startFreshInspection = useCallback(
    (
      preserveLogs: boolean = false,
      introMessage: string = '',
      options?: {
        autoActionMode?: CodexInspectionAutoActionMode;
      }
    ) => {
      if (connectionStatus !== 'connected') {
        const message = t('notification.connection_required');
        showNotification(message, 'warning');
        return;
      }
      if (!connectionFingerprint) {
        const message = t('notification.connection_required');
        showNotification(message, 'warning');
        return;
      }

      const autoActionMode = options?.autoActionMode ?? inspectionSettings.autoActionMode;
      const runConnectionFingerprint = connectionFingerprint;
      autoActionModeForRunRef.current = autoActionMode;
      realtimeClaimedKeysRef.current = new Set();
      realtimeAppliedKeysRef.current = new Set();
      realtimeChainRef.current = Promise.resolve();

      if (!preserveLogs) {
        setLogs([]);
      }
      if (introMessage) {
        appendLog('info', introMessage);
      }

      setResult(null);
      setResultConnectionFingerprint(runConnectionFingerprint);
      setRunStatus('running');
      setLogsCollapsed(false);
      setActionFilter('all');
      finishAndExecuteRef.current = false;
      setFinishing(false);

      const session = createCodexInspectionSession({
        config,
        apiBase,
        managementKey,
        settings: inspectionSettings,
        onLog: (level, message) => {
          if (activeSessionIdRef.current !== session.id) return;
          appendLog(level, message);
        },
        onProgress: (snapshot) => {
          if (activeSessionIdRef.current !== session.id) return;
          setProgress(snapshot);
          if (snapshot.status === 'running') {
            setRunStatus('running');
            return;
          }
          if (snapshot.status === 'paused') {
            setRunStatus('paused');
          }
        },
        onResultsChange: (nextResult) => {
          if (activeSessionIdRef.current !== session.id) return;
          const merged = mergeRealtimeAppliedIntoResult(nextResult);
          setResult(merged);
          setResultConnectionFingerprint(runConnectionFingerprint);
          scheduleRealtimeAutoActions(merged, autoActionMode, runConnectionFingerprint);
        },
      });

      sessionRef.current = session;
      activeSessionIdRef.current = session.id;
      setProgress(session.getProgress());
      attachSessionPromise(session, session.start(), autoActionMode, runConnectionFingerprint);
    },
    [
      apiBase,
      appendLog,
      attachSessionPromise,
      config,
      connectionFingerprint,
      connectionStatus,
      inspectionSettings,
      managementKey,
      mergeRealtimeAppliedIntoResult,
      scheduleRealtimeAutoActions,
      showNotification,
      t,
    ]
  );

  const handleRunInspection = useCallback(() => {
    if (runStatus === 'paused' && sessionRef.current) {
      setLogsCollapsed(false);
      sessionRef.current.resume();
      return;
    }

    startFreshInspection(false);
  }, [runStatus, startFreshInspection]);

  const handlePauseInspection = useCallback(() => {
    if (runStatus !== 'running') return;
    sessionRef.current?.pause();
  }, [runStatus]);

  const handleStopInspection = useCallback(() => {
    const currentSession = sessionRef.current;
    if (!currentSession) return;
    if (finishing || executing) return;

    appendLog('warning', t('monitoring.codex_inspection_stopped'));
    showNotification(t('monitoring.codex_inspection_stopped'), 'warning');
    finishAndExecuteRef.current = false;
    setFinishing(false);
    activeSessionIdRef.current = null;
    sessionRef.current = null;
    currentSession.stop();
    setRunStatus('idle');
    setProgress(createIdleProgressSnapshot());
    setResult(null);
    setResultConnectionFingerprint(null);
    setLogsCollapsed(false);
  }, [appendLog, executing, finishing, showNotification, t]);

  // Finish immediately: do not wait for in-flight probes; execute suggestions from completed results.
  const handleFinishInspection = useCallback(() => {
    const currentSession = sessionRef.current;
    if (!currentSession) return;
    if (executing || finishing) return;

    finishAndExecuteRef.current = true;
    setFinishing(true);
    setLogsCollapsed(false);
    appendLog('warning', t('monitoring.codex_inspection_finish_started'));
    showNotification(t('monitoring.codex_inspection_finish_started'), 'info');
    // Keep activeSessionId so attachSessionPromise can receive the partial result and execute actions.
    currentSession.finish();
    // Immediate local feedback: freeze progress from the settled session snapshot.
    setProgress(currentSession.getProgress());
  }, [appendLog, executing, finishing, showNotification, t]);

  const executeItems = useCallback(
    async (
      items: CodexInspectionResultItem[],
      options?: {
        resultOverride?: CodexInspectionRunResult | null;
        source?: ExecutionTriggerSource;
        connectionFingerprint?: string | null;
      }
    ) => {
      const baseResult = options?.resultOverride ?? result;
      const source = options?.source ?? 'manual';
      const isRealtime = source === 'realtime';
      if (!baseResult) return;
      const currentResultFingerprint = options?.connectionFingerprint ?? resultConnectionFingerprint;
      if (!connectionFingerprint || currentResultFingerprint !== connectionFingerprint) {
        if (!isRealtime) {
          showNotification(t('notification.connection_required'), 'warning');
        }
        return;
      }
      const targets = items.filter(isSuggestedAction);
      if (targets.length === 0) {
        if (!isRealtime) {
          showNotification(t('monitoring.codex_inspection_no_pending_actions'), 'info');
        }
        return;
      }

      // Realtime applies must not flip the global executing flag, otherwise Stop is blocked.
      if (!isRealtime) {
        setExecuting(true);
      }
      setLogsCollapsed(false);
      appendLog(
        'info',
        isRealtime
          ? t('monitoring.codex_inspection_realtime_execute_started', {
              count: targets.length,
              defaultValue: '实时执行 {{count}} 个建议动作',
            })
          : t('monitoring.codex_inspection_execute_started')
      );

      try {
        // Prefer the freshest probe snapshot so concurrent results are not lost.
        const currentResult = mergeRealtimeAppliedIntoResult(resultRef.current ?? baseResult);
        const execution = await executeCodexInspectionActions({
          settings: currentResult.settings,
          items: targets,
          previousFiles: currentResult.files,
          onLog: appendLog,
        });

        execution.outcomes.forEach((outcome) => {
          if (outcome.success) {
            realtimeAppliedKeysRef.current.add(outcome.fileName);
            realtimeClaimedKeysRef.current.add(outcome.fileName);
          } else if (isRealtime) {
            // Allow end-of-run auto-exec to retry failed realtime targets.
            realtimeClaimedKeysRef.current.delete(outcome.fileName);
          }
        });

        const failed = execution.outcomes.filter((item) => !item.success);
        if (!isRealtime) {
          if (failed.length > 0) {
            showNotification(
              `${t('monitoring.codex_inspection_execute_partial')}: ${failed
                .map(buildExecutionFailureMessage)
                .join('；')}`,
              'warning'
            );
          } else {
            showNotification(t('monitoring.codex_inspection_execute_success'), 'success');
          }
        }

        const latestBeforeApply = mergeRealtimeAppliedIntoResult(resultRef.current ?? currentResult);
        const nextResult = mergeRealtimeAppliedIntoResult(
          applyCodexInspectionExecutionResult(latestBeforeApply, execution)
        );
        setResult(nextResult);
        setResultConnectionFingerprint(currentResultFingerprint);

        if (source === 'auto') {
          const successCount = execution.outcomes.filter((item) => item.success).length;
          const failedCount = execution.outcomes.length - successCount;
          const remainingCount = nextResult.results.filter(isSuggestedAction).length;
          const summaryMessage =
            failedCount > 0 || remainingCount > 0
              ? t('monitoring.codex_inspection_auto_execute_summary_partial', {
                  total: targets.length,
                  success: successCount,
                  failed: failedCount,
                  remaining: remainingCount,
                })
              : t('monitoring.codex_inspection_auto_execute_summary_success', {
                  total: targets.length,
                  success: successCount,
                });
          appendLog(failedCount > 0 || remainingCount > 0 ? 'warning' : 'success', summaryMessage);
          showNotification(summaryMessage, failedCount > 0 || remainingCount > 0 ? 'warning' : 'success');
        } else if (isRealtime) {
          const successCount = execution.outcomes.filter((item) => item.success).length;
          const failedCount = execution.outcomes.length - successCount;
          appendLog(
            failedCount > 0 ? 'warning' : 'success',
            t('monitoring.codex_inspection_realtime_execute_batch_done', {
              total: targets.length,
              success: successCount,
              failed: failedCount,
              defaultValue: '实时执行完成：{{success}}/{{total}} 成功，失败 {{failed}}',
            })
          );
        }
      } finally {
        if (!isRealtime) {
          setExecuting(false);
        }
      }
    },
    [
      appendLog,
      connectionFingerprint,
      mergeRealtimeAppliedIntoResult,
      result,
      resultConnectionFingerprint,
      showNotification,
      t,
    ]
  );

  useEffect(() => {
    executeItemsRef.current = executeItems;
  }, [executeItems]);

  const inspectionResults = useMemo(() => (result ? result.results : []), [result]);

  const actionableResults = useMemo(
    () => inspectionResults.filter(isSuggestedAction),
    [inspectionResults]
  );

  const filteredResults = useMemo(
    () => filterByAction(inspectionResults, actionFilter),
    [inspectionResults, actionFilter]
  );

  const handleExecutePlanned = useCallback(() => {
    if (!result) return;

    const targets = actionableResults;
    const counts = countActions(targets);
    showConfirmation({
      title: t('monitoring.codex_inspection_execute_confirm_title'),
      message: t('monitoring.codex_inspection_execute_confirm_body', {
        total: targets.length,
        delete: counts.delete,
        disable: counts.disable,
        enable: counts.enable,
      }),
      confirmText: t('monitoring.codex_inspection_execute_now'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: () => executeItems(targets),
    });
  }, [actionableResults, executeItems, result, showConfirmation, t]);

  const handleExecuteSingle = useCallback(
    (item: CodexInspectionResultItem) => {
      const actionLabel = formatActionLabel(item.action, t);
      showConfirmation({
        title: t('monitoring.codex_inspection_execute_single_title'),
        message: t('monitoring.codex_inspection_execute_single_body', {
          account: item.displayAccount,
          action: actionLabel,
        }),
        confirmText: actionLabel,
        cancelText: t('common.cancel'),
        variant: item.action === 'delete' ? 'danger' : 'primary',
        onConfirm: () => executeItems([item]),
      });
    },
    [executeItems, showConfirmation, t]
  );

  const handleManualBatchAction = useCallback(
    (action: 'delete' | 'disable' | 'enable') => {
      if (!result) return;
      const targets = filteredResults;
      if (targets.length === 0) {
        showNotification(t('monitoring.codex_inspection_manual_no_targets'), 'info');
        return;
      }

      const actionLabel = formatActionLabel(action, t);
      showConfirmation({
        title: t('monitoring.codex_inspection_manual_confirm_title', {
          action: actionLabel,
          defaultValue: '手动{{action}}',
        }),
        message: t('monitoring.codex_inspection_manual_confirm_body', {
          count: targets.length,
          action: actionLabel,
          defaultValue: '将对当前筛选的 {{count}} 条记录执行「{{action}}」。确认继续吗？',
        }),
        confirmText: t('monitoring.codex_inspection_manual_confirm_action', {
          action: actionLabel,
          defaultValue: '确认{{action}}',
        }),
        cancelText: t('common.cancel'),
        variant: action === 'delete' ? 'danger' : 'primary',
        onConfirm: () =>
          executeItems(
            targets.map((item) => ({
              ...item,
              action,
              actionReason: t('monitoring.codex_inspection_manual_reason', {
                action: actionLabel,
                defaultValue: '手动{{action}}',
              }),
            }))
          ),
      });
    },
    [executeItems, filteredResults, result, showConfirmation, showNotification, t]
  );



  const manualUpdateTargetCount = useMemo(() => {
    const names = new Set<string>();
    filteredResults.forEach((item) => {
      if (item.fileName) names.add(item.fileName);
    });
    return names.size;
  }, [filteredResults]);

  const openManualUpdateModal = useCallback(() => {
    if (!result) return;
    if (filteredResults.length === 0) {
      showNotification(t('monitoring.codex_inspection_manual_no_targets'), 'info');
      return;
    }
    setUpdateDraft(createEmptyManualUpdateDraft(inspectionSettings.userAgent));
    setUpdateProgress(null);
    setIsUpdateModalOpen(true);
  }, [filteredResults.length, inspectionSettings.userAgent, result, showNotification, t]);

  const handleManualUpdateDraftChange = useCallback(
    <K extends keyof ManualUpdateDraft>(field: K, value: ManualUpdateDraft[K]) => {
      setUpdateDraft((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleManualUpdateExecute = useCallback(async () => {
    if (!result || updating) return;
    const targets = filteredResults;
    if (targets.length === 0) {
      showNotification(t('monitoring.codex_inspection_manual_no_targets'), 'info');
      return;
    }

    const fields: AuthFileFieldsPatch = {};
    const changedLabels: string[] = [];

    if (updateDraft.updateHeaders) {
      const parsedHeaders = parseManualUpdateHeadersJson(updateDraft.headersJson);
      if (!parsedHeaders.ok) {
        const errorKey =
          parsedHeaders.error === 'invalid_json'
            ? 'monitoring.codex_inspection_manual_update_error_headers_json'
            : parsedHeaders.error === 'not_object'
              ? 'monitoring.codex_inspection_manual_update_error_headers_object'
              : parsedHeaders.error === 'invalid_value'
                ? 'monitoring.codex_inspection_manual_update_error_headers_value'
                : 'monitoring.codex_inspection_manual_update_error_headers';
        const defaults: Record<string, string> = {
          'monitoring.codex_inspection_manual_update_error_headers': '请填写自定义请求头 JSON',
          'monitoring.codex_inspection_manual_update_error_headers_json': '自定义请求头必须是合法 JSON',
          'monitoring.codex_inspection_manual_update_error_headers_object':
            '自定义请求头必须是 JSON 对象，例如 {"User-Agent":"..."}',
          'monitoring.codex_inspection_manual_update_error_headers_value':
            '自定义请求头的值必须是字符串、数字或布尔值',
        };
        showNotification(t(errorKey, { defaultValue: defaults[errorKey] }), 'error');
        return;
      }
      fields.headers = parsedHeaders.headers;
      changedLabels.push(
        t('monitoring.codex_inspection_manual_update_field_headers', {
          defaultValue: '自定义请求头',
        })
      );
    }

    if (updateDraft.updatePriority) {
      const raw = updateDraft.priority.trim();
      if (!raw) {
        showNotification(
          t('monitoring.codex_inspection_manual_update_error_priority', {
            defaultValue: '请填写优先级',
          }),
          'error'
        );
        return;
      }
      const priority = Number(raw);
      if (!Number.isFinite(priority)) {
        showNotification(
          t('monitoring.codex_inspection_manual_update_error_priority_invalid', {
            defaultValue: '优先级必须是数字',
          }),
          'error'
        );
        return;
      }
      fields.priority = priority;
      changedLabels.push(t('monitoring.codex_inspection_manual_update_field_priority', { defaultValue: '优先级' }));
    }

    if (updateDraft.updateProxyUrl) {
      fields.proxy_url = updateDraft.proxyUrl.trim();
      changedLabels.push(t('monitoring.codex_inspection_manual_update_field_proxy', { defaultValue: '代理 URL' }));
    }

    if (changedLabels.length === 0) {
      showNotification(
        t('monitoring.codex_inspection_manual_update_error_none', {
          defaultValue: '请至少勾选一个要更新的字段',
        }),
        'error'
      );
      return;
    }

    // Dedupe by fileName — filtered rows may share accounts across models.
    const uniqueByFile = new Map<string, CodexInspectionResultItem>();
    targets.forEach((item) => {
      if (!item.fileName) return;
      if (!uniqueByFile.has(item.fileName)) uniqueByFile.set(item.fileName, item);
    });
    const uniqueTargets = Array.from(uniqueByFile.values());
    if (uniqueTargets.length === 0) {
      showNotification(t('monitoring.codex_inspection_manual_no_targets'), 'info');
      return;
    }

    setUpdating(true);
    setUpdateProgress({ done: 0, total: uniqueTargets.length });
    appendLog(
      'info',
      t('monitoring.codex_inspection_manual_update_started', {
        count: uniqueTargets.length,
        fields: changedLabels.join(', '),
        type: inspectionSettings.targetType,
        defaultValue: '开始手动更新 {{count}} 个账号文件（{{type}}）：{{fields}}',
      })
    );

    const workers = Math.max(1, Math.min(inspectionSettings.deleteWorkers || 4, 16));
    let cursor = 0;
    let done = 0;
    let success = 0;
    const failures: string[] = [];

    const runOne = async (item: CodexInspectionResultItem) => {
      try {
        await authFilesApi.patchFields(item.fileName, fields);
        success += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${item.fileName}: ${message}`);
      } finally {
        done += 1;
        setUpdateProgress({ done, total: uniqueTargets.length });
      }
    };

    const workerFns = Array.from({ length: Math.min(workers, uniqueTargets.length) }, async () => {
      while (cursor < uniqueTargets.length) {
        const index = cursor;
        cursor += 1;
        await runOne(uniqueTargets[index]);
      }
    });

    try {
      await Promise.all(workerFns);
      if (failures.length === 0) {
        const message = t('monitoring.codex_inspection_manual_update_success', {
          count: success,
          fields: changedLabels.join(', '),
          defaultValue: '已更新 {{count}} 个账号文件：{{fields}}',
        });
        appendLog('success', message);
        showNotification(message, 'success');
        setIsUpdateModalOpen(false);
      } else {
        const message = t('monitoring.codex_inspection_manual_update_partial', {
          success,
          failed: failures.length,
          total: uniqueTargets.length,
          defaultValue: '更新完成：成功 {{success}}，失败 {{failed}}，总计 {{total}}',
        });
        appendLog('warning', `${message}; ${failures.slice(0, 5).join('; ')}`);
        showNotification(message, 'warning');
      }
    } finally {
      setUpdating(false);
      setUpdateProgress(null);
    }
  }, [
    appendLog,
    filteredResults,
    inspectionSettings.deleteWorkers,
    inspectionSettings.targetType,
    result,
    showNotification,
    t,
    updateDraft,
    updating,
  ]);

  const handleResetRoutingCooldown = useCallback(
    async (item: CodexInspectionResultItem) => {
      if (!item.authIndex || resettingCooldownKey) return;
      setResettingCooldownKey(item.key);
      try {
        const resetResult = await resetAuthRoutingCooldown(item.authIndex);
        showNotification(
          t('monitoring.codex_inspection_reset_cooldown_success', {
            count: resetResult.models.length,
          }),
          'success'
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        showNotification(
          `${t('monitoring.codex_inspection_reset_cooldown_failed')}: ${buildCodexInspectionError(message)}`,
          'error'
        );
      } finally {
        setResettingCooldownKey('');
      }
    },
    [resettingCooldownKey, showNotification, t]
  );

  const summaryCards = useMemo<SummaryCard[]>(() => {
    const summarySource =
      runStatus === 'running' || runStatus === 'paused' ? progress.summary : result?.summary ?? null;
    const blank = '--';
    const dash = '—';
    // Account-pool card should reflect the live auth-file pool whenever available.
    // Fall back to the run summary only while probeStats is still loading.
    const probeSetCount =
      probeStats?.total ??
      (summarySource ? summarySource.probeSetCount : null);
    const enabledCount =
      probeStats?.enabled ??
      (summarySource ? summarySource.enabledCount : null);
    const disabledCount =
      probeStats?.disabled ??
      (summarySource ? summarySource.disabledCount : null);
    const sampledTotal = summarySource ? summarySource.sampledCount : null;
    const sampledCompleted =
      summarySource === null
        ? null
        : runStatus === 'running' || runStatus === 'paused'
          ? progress.completed
          : summarySource.sampledCount;
    const deleteCount = summarySource ? summarySource.deleteCount : null;
    const disableCount = summarySource ? summarySource.disableCount : null;
    const enableCount = summarySource ? summarySource.enableCount : null;
    const totalActions =
      summarySource !== null
        ? summarySource.deleteCount + summarySource.disableCount + summarySource.enableCount
        : null;

    const probeMeta = summarySource
      ? `${t('monitoring.codex_inspection_target_type')} ${inspectionSettings.targetType}`
      : probeStats
        ? t('monitoring.codex_inspection_target_type') + ` ${inspectionSettings.targetType}`
        : t('monitoring.codex_inspection_progress_idle');

    const sampledMeta = (() => {
      if (sampledTotal === null) {
        return t('monitoring.codex_inspection_sampled_meta_idle');
      }
      if (runStatus === 'running' || runStatus === 'paused') {
        return t('monitoring.codex_inspection_sampled_meta_running', {
          total: sampledTotal,
          percent: progress.percent,
        });
      }
      return t('monitoring.codex_inspection_sampled_meta_done', { total: sampledTotal });
    })();

    // Per-card account state: prefer live result rows for action cards; fall back to summary totals.
    const resultRows = result?.results ?? [];
    const probeAccountState =
      enabledCount !== null || disabledCount !== null
        ? { enabled: enabledCount ?? 0, disabled: disabledCount ?? 0 }
        : null;
    const sampledAccountState =
      resultRows.length > 0
        ? countAccountStates(resultRows)
        : probeAccountState && sampledTotal !== null
          ? probeAccountState
          : null;
    const actionableRows = resultRows.filter(isSuggestedAction);
    const deleteRows = resultRows.filter((item) => item.action === 'delete');
    const disableRows = resultRows.filter((item) => item.action === 'disable');
    const enableRows = resultRows.filter((item) => item.action === 'enable');
    // When a list filter is active, surface that filtered set on action-related cards' footers.
    const filteredAccountState =
      actionFilter !== 'all' ? countAccountStates(filteredResults) : null;

    return [
      {
        key: 'total-actions',
        label: t('monitoring.codex_inspection_action_total'),
        value: totalActions === null ? blank : String(totalActions),
        meta:
          totalActions !== null && totalActions > 0
            ? t('monitoring.codex_inspection_pending_actions') + ` ${totalActions}`
            : t('monitoring.codex_inspection_no_pending_actions'),
        tone: totalActions && totalActions > 0 ? 'warn' : 'good',
        accountState:
          filteredAccountState ??
          (actionableRows.length > 0
            ? countAccountStates(actionableRows)
            : totalActions !== null
              ? { enabled: 0, disabled: 0 }
              : null),
      },
      {
        key: 'probe-total',
        label: t('monitoring.codex_inspection_total_accounts'),
        value: probeSetCount === null ? blank : String(probeSetCount),
        meta: probeMeta,
        accountState: probeAccountState,
      },
      {
        key: 'sampled',
        label: t('monitoring.codex_inspection_sampled_accounts'),
        value: sampledCompleted === null ? blank : String(sampledCompleted),
        meta: sampledMeta,
        accountState: sampledAccountState,
      },
      {
        key: 'delete',
        label: t('monitoring.codex_inspection_delete_count'),
        value: deleteCount === null ? blank : String(deleteCount),
        meta:
          deleteCount && deleteCount > 0
            ? t('monitoring.codex_inspection_action_delete')
            : dash,
        tone: deleteCount && deleteCount > 0 ? 'bad' : undefined,
        accountState:
          actionFilter === 'delete' && filteredAccountState
            ? filteredAccountState
            : deleteRows.length > 0
              ? countAccountStates(deleteRows)
              : deleteCount !== null
                ? { enabled: 0, disabled: 0 }
                : null,
      },
      {
        key: 'disable',
        label: t('monitoring.codex_inspection_disable_count'),
        value: disableCount === null ? blank : String(disableCount),
        meta: t('monitoring.codex_inspection_action_disable'),
        tone: disableCount && disableCount > 0 ? 'warn' : undefined,
        accountState:
          actionFilter === 'disable' && filteredAccountState
            ? filteredAccountState
            : disableRows.length > 0
              ? countAccountStates(disableRows)
              : disableCount !== null
                ? { enabled: 0, disabled: 0 }
                : null,
      },
      {
        key: 'enable',
        label: t('monitoring.codex_inspection_enable_count'),
        value: enableCount === null ? blank : String(enableCount),
        meta: t('monitoring.codex_inspection_action_enable'),
        tone: enableCount && enableCount > 0 ? 'good' : undefined,
        accountState:
          actionFilter === 'enable' && filteredAccountState
            ? filteredAccountState
            : enableRows.length > 0
              ? countAccountStates(enableRows)
              : enableCount !== null
                ? { enabled: 0, disabled: 0 }
                : null,
      },
    ];
  }, [
    actionFilter,
    filteredResults,
    inspectionSettings.targetType,
    probeStats,
    progress.completed,
    progress.percent,
    progress.summary,
    result,
    runStatus,
    t,
  ]);

  const pendingActionCount = actionableResults.length;
  const progressLabel =
    progress.total > 0
      ? t('monitoring.codex_inspection_progress_status', {
          completed: progress.completed,
          total: progress.total,
          inFlight: progress.inFlight,
          pending: progress.pending,
          percent: progress.percent,
        })
      : t('monitoring.codex_inspection_progress_idle');
  const showProgressBar = (runStatus === 'running' || runStatus === 'paused') && !finishing;

  const statusToneMap: Record<RunStatus, StatusTone> = {
    idle: 'idle',
    running: 'info',
    paused: 'warn',
    success: 'good',
    error: 'bad',
  };

  const statusLabelMap: Record<RunStatus, string> = {
    idle: t('monitoring.codex_inspection_status_idle'),
    running: t('monitoring.codex_inspection_status_running'),
    paused: t('monitoring.codex_inspection_status_paused'),
    success: t('monitoring.codex_inspection_status_success'),
    error: t('monitoring.codex_inspection_status_error'),
  };

  const statusTone = finishing ? 'warn' : statusToneMap[runStatus];
  const statusLabel = finishing
    ? t('monitoring.codex_inspection_finishing')
    : statusLabelMap[runStatus];

  const lastFinishedLabel = result && result.finishedAt > 0
    ? `${t('monitoring.codex_inspection_last_finished_at')} · ${formatTime(result.finishedAt, i18n.language)}`
    : null;

  const openSettingsModal = useCallback(() => {
    setSettingsDraft(toSettingsDraft(inspectionSettings));
    setIsSettingsModalOpen(true);
  }, [inspectionSettings]);

  const handleSettingsDraftChange = useCallback(
    (field: InspectionSettingsDraftField, value: string) => {
      setSettingsDraft((previous) => ({
        ...previous,
        [field]: value,
      }));
    },
    []
  );

  const handleAutoActionModeChange = useCallback((value: CodexInspectionAutoActionMode) => {
    setSettingsDraft((previous) => ({
      ...previous,
      autoActionMode: value,
    }));
  }, []);

  const handleRealtimeAutoActionChange = useCallback(
    (field: keyof CodexInspectionRealtimeAutoActions, checked: boolean) => {
      setSettingsDraft((previous) => {
        const accountSource = normalizeInspectionAccountSource(
          previous.accountSource,
          'oauth'
        );
        // API Key accounts never allow delete.
        if (field === 'delete' && accountSource === 'api_key') {
          return {
            ...previous,
            realtimeAutoActions: {
              ...previous.realtimeAutoActions,
              delete: false,
            },
          };
        }
        return {
          ...previous,
          realtimeAutoActions: {
            ...previous.realtimeAutoActions,
            [field]: checked,
          },
        };
      });
    },
    []
  );

  const handleProbePromptModeChange = useCallback((mode: string) => {
    if (!(CODEX_INSPECTION_PROBE_PROMPT_MODES as readonly string[]).includes(mode)) return;
    setSettingsDraft((previous) => ({
      ...previous,
      probePromptMode: mode as CodexInspectionProbePromptMode,
    }));
  }, []);

  const parseNonNegativeInteger = useCallback(
    (value: string, label: string, min: number) => {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min) {
        throw new Error(t('monitoring.codex_inspection_settings_invalid_integer', { field: label, min }));
      }
      return parsed;
    },
    [t]
  );

  const handleSaveSettings = useCallback(() => {
    const accountSource = normalizeInspectionAccountSource(settingsDraft.accountSource, 'oauth');
    const rawTargetType = settingsDraft.targetType.trim().toLowerCase();
    if (!rawTargetType) {
      showNotification(t('monitoring.codex_inspection_settings_target_type_required'), 'error');
      return;
    }
    const targetType =
      accountSource === 'api_key'
        ? normalizeInspectionApiKeyFamily(rawTargetType, 'all')
        : rawTargetType;
    if (accountSource === 'oauth' && !isSupportedInspectionTargetType(targetType)) {
      showNotification(t('monitoring.codex_inspection_settings_target_type_unsupported'), 'error');
      return;
    }

    try {
      const nextSettings = saveCodexInspectionConfigurableSettings({
        accountSource,
        targetType,
        workers: parseNonNegativeInteger(
          settingsDraft.workers,
          t('monitoring.codex_inspection_settings_workers_label'),
          1
        ),
        deleteWorkers: parseNonNegativeInteger(
          settingsDraft.deleteWorkers,
          t('monitoring.codex_inspection_settings_delete_workers_label'),
          1
        ),
        timeout: parseNonNegativeInteger(
          settingsDraft.timeout,
          t('monitoring.codex_inspection_settings_timeout_label'),
          1
        ),
        retries: parseNonNegativeInteger(
          settingsDraft.retries,
          t('monitoring.codex_inspection_settings_retries_label'),
          0
        ),
        userAgent: settingsDraft.userAgent.trim(),
        probePromptMode: settingsDraft.probePromptMode,
        probeModel: settingsDraft.probeModel.trim(),
        providerFilter: settingsDraft.providerFilter.trim(),
        sampleSize: parseNonNegativeInteger(
          settingsDraft.sampleSize,
          t('monitoring.codex_inspection_settings_sample_size_label'),
          0
        ),
        usedPercentThreshold: (() => {
          const parsed = Number(settingsDraft.usedPercentThreshold.trim());
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
            throw new Error(
              t('monitoring.codex_inspection_settings_invalid_threshold', {
                field: t('monitoring.codex_inspection_settings_used_percent_threshold_label'),
              })
            );
          }
          return parsed;
        })(),
        autoActionMode: settingsDraft.autoActionMode,
        realtimeAutoActions: normalizeRealtimeAutoActions(
          settingsDraft.realtimeAutoActions,
          accountSource
        ),
      });

      setInspectionSettings(nextSettings);
      setSettingsDraft(toSettingsDraft(nextSettings));
      setIsSettingsModalOpen(false);
      showNotification(t('monitoring.codex_inspection_settings_saved'), 'success');
    } catch (error) {
      showNotification(error instanceof Error ? error.message : String(error || t('common.unknown_error')), 'error');
    }
  }, [parseNonNegativeInteger, settingsDraft, showNotification, t]);

  const handleResetSettings = useCallback(() => {
    clearCodexInspectionConfigurableSettings();
    const nextSettings = saveCodexInspectionConfigurableSettings(DEFAULT_CODEX_INSPECTION_SETTINGS);
    setInspectionSettings(nextSettings);
    setSettingsDraft(toSettingsDraft(nextSettings));
    showNotification(t('monitoring.codex_inspection_settings_reset'), 'success');
  }, [showNotification, t]);

  const handleClearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const handleJumpToLatest = useCallback(() => {
    if (logsCollapsed) {
      setLogsCollapsed(false);
      requestAnimationFrame(scrollLogsToBottom);
      return;
    }
    scrollLogsToBottom();
  }, [logsCollapsed, scrollLogsToBottom]);

  const httpStatusFilters = useMemo(
    () => collectHttpStatusFilters(inspectionResults),
    [inspectionResults]
  );

  const resultFilters = useMemo<ActionFilter[]>(
    () => [...STATIC_ACTION_FILTERS, ...httpStatusFilters],
    [httpStatusFilters]
  );

  const filterCounts = useMemo(() => {
    const counts = countActions(inspectionResults);
    const map: Record<string, number> = {
      all: actionableResults.length,
      delete: counts.delete,
      disable: counts.disable,
      enable: counts.enable,
    };
    httpStatusFilters.forEach((filter) => {
      map[filter] = filterByAction(inspectionResults, filter).length;
    });
    return map;
  }, [actionableResults, httpStatusFilters, inspectionResults]);

  // Drop stale HTTP-status tabs when the current results no longer include that code.
  useEffect(() => {
    if (!isHttpStatusFilter(actionFilter)) return;
    if (httpStatusFilters.includes(actionFilter)) return;
    setActionFilter('all');
  }, [actionFilter, httpStatusFilters]);

  const filterLabel = (filter: ActionFilter) => {
    switch (filter) {
      case 'delete':
        return t('monitoring.codex_inspection_filter_delete');
      case 'disable':
        return t('monitoring.codex_inspection_filter_disable');
      case 'enable':
        return t('monitoring.codex_inspection_filter_enable');
      case 'all':
        return t('monitoring.codex_inspection_filter_all');
      default: {
        if (filter === HTTP_UNKNOWN_FILTER) {
          return t('monitoring.codex_inspection_filter_http_unknown', {
            defaultValue: '无状态码',
          });
        }
        const statusCode = parseHttpStatusFilter(filter);
        return t('monitoring.codex_inspection_filter_http_status', {
          status: statusCode ?? '--',
          defaultValue: 'HTTP {{status}}',
        });
      }
    }
  };

  const isInspectionInFlight = runStatus === 'running' || runStatus === 'paused';
  // Keep action buttons visible while finishing so users see the loading state.
  const showControlButtons = isInspectionInFlight || finishing;
  const runButtonLabel =
    finishing
      ? t('monitoring.codex_inspection_finishing')
      : runStatus === 'paused'
        ? t('monitoring.codex_inspection_resume')
        : runStatus === 'running'
          ? t('monitoring.codex_inspection_running')
          : t('monitoring.codex_inspection_run');
  const autoActionModeLabel = formatAutoActionModeLabel(inspectionSettings.autoActionMode, t);

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('monitoring.codex_inspection_title')}</h1>
        <p className={styles.description}>{t('monitoring.codex_inspection_desc')}</p>
      </div>

      <Card className={`${styles.panel} ${styles.statusPanel}`}>
        <div className={styles.statusBar}>
          <div className={styles.statusInfo}>
            <span className={`${styles.statusBadge} ${styles[`tone-${statusTone}`]}`}>
              <span className={styles.statusDot} aria-hidden="true" />
              {statusLabel}
            </span>
            <div className={styles.statusMeta}>
              <span>{`${t('monitoring.codex_inspection_account_source', { defaultValue: '账号源' })}: ${t(
                `monitoring.codex_inspection_account_source_${inspectionSettings.accountSource}`,
                {
                  defaultValue:
                    inspectionSettings.accountSource === 'api_key' ? 'API Key' : 'OAuth',
                }
              )}`}</span>
              <span>{`${t('monitoring.codex_inspection_target_type')}: ${inspectionSettings.targetType}`}</span>
              {inspectionSettings.accountSource === 'api_key' && inspectionSettings.providerFilter ? (
                <span>{`${t('monitoring.codex_inspection_settings_provider_filter_label', {
                  defaultValue: '提供商过滤',
                })}: ${inspectionSettings.providerFilter}`}</span>
              ) : null}
              <span>{`${t('monitoring.codex_inspection_threshold')}: ${inspectionSettings.usedPercentThreshold}%`}</span>
              <span>{`${t('monitoring.codex_inspection_workers')}: ${inspectionSettings.workers}`}</span>
              <span>{`${t('monitoring.codex_inspection_sample_size')}: ${inspectionSettings.sampleSize || t('common.no')}`}</span>
              <span>{`${t('monitoring.codex_inspection_probe_prompt_mode', { defaultValue: '提示词' })}: ${t(
                `monitoring.codex_inspection_settings_probe_prompt_mode_${inspectionSettings.probePromptMode}`,
                {
                  defaultValue:
                    inspectionSettings.probePromptMode === 'math'
                      ? '随机数学题'
                      : inspectionSettings.probePromptMode === 'random'
                        ? '随机字符串'
                        : '固定文本',
                }
              )}`}</span>
              {inspectionSettings.autoActionMode !== 'none' ? (
                <span className={styles.statusMetaWarn}>
                  {`${t('monitoring.codex_inspection_settings_auto_action_mode_label')}: ${autoActionModeLabel}`}
                </span>
              ) : null}
              {inspectionSettings.autoActionMode !== 'none' &&
              (inspectionSettings.realtimeAutoActions.disable ||
                inspectionSettings.realtimeAutoActions.enable ||
                inspectionSettings.realtimeAutoActions.delete) ? (
                <span className={styles.statusMetaWarn}>
                  {`${t('monitoring.codex_inspection_settings_realtime_auto_label', {
                    defaultValue: '实时自动执行',
                  })}: ${[
                    inspectionSettings.realtimeAutoActions.disable
                      ? t('monitoring.codex_inspection_settings_realtime_disable', {
                          defaultValue: '实时禁用',
                        })
                      : null,
                    inspectionSettings.realtimeAutoActions.enable
                      ? t('monitoring.codex_inspection_settings_realtime_enable', {
                          defaultValue: '实时启用',
                        })
                      : null,
                    inspectionSettings.realtimeAutoActions.delete &&
                    inspectionSettings.accountSource !== 'api_key'
                      ? t('monitoring.codex_inspection_settings_realtime_delete', {
                          defaultValue: '实时删除',
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' / ')}`}
                </span>
              ) : null}
              {lastFinishedLabel ? <span>{lastFinishedLabel}</span> : null}
              {pendingActionCount > 0 ? (
                <span
                  className={styles.statusMetaWarn}
                >{`${t('monitoring.codex_inspection_pending_total')} ${pendingActionCount}`}</span>
              ) : null}
            </div>
          </div>

          <div className={styles.statusActions}>
            <Link to="/monitoring" className={styles.quickLink}>
              <IconExternalLink size={14} />
              <span>{t('monitoring.codex_inspection_back')}</span>
            </Link>
            <div className={styles.quickTargetType}>
              <span className={styles.quickTargetTypeLabel}>
                {t('monitoring.codex_inspection_account_source', { defaultValue: '账号源' })}
              </span>
              <Select
                value={inspectionSettings.accountSource}
                options={accountSourceOptions}
                onChange={handleQuickAccountSourceChange}
                ariaLabel={t('monitoring.codex_inspection_account_source', { defaultValue: '账号源' })}
                disabled={isInspectionInFlight || executing || finishing || updating}
                size="sm"
              />
            </div>
            <div className={styles.quickTargetType}>
              <span className={styles.quickTargetTypeLabel}>
                {t('monitoring.codex_inspection_target_type')}
              </span>
              <Select
                value={inspectionSettings.targetType}
                options={targetTypeOptions}
                onChange={handleQuickTargetTypeChange}
                ariaLabel={t('monitoring.codex_inspection_target_type')}
                disabled={isInspectionInFlight || executing || finishing || updating}
                size="sm"
              />
            </div>
            {probeStats ? (
              <span className={styles.probeStatsChip} title={t('monitoring.codex_inspection_refresh_stats_hint', { defaultValue: '当前类型账号统计' })}>
                {t('monitoring.codex_inspection_probe_stats_chip', {
                  total: probeStats.total,
                  enabled: probeStats.enabled,
                  disabled: probeStats.disabled,
                  defaultValue: '共 {{total}} · 启用 {{enabled}} · 禁用 {{disabled}}',
                })}
              </span>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleRefreshProbeStats()}
              loading={probeStatsRefreshing}
              disabled={
                probeStatsRefreshing ||
                isInspectionInFlight ||
                executing ||
                finishing ||
                connectionStatus !== 'connected'
              }
              title={t('monitoring.codex_inspection_refresh_stats_tip', {
                defaultValue: '刷新当前类型的账号数量、启用/禁用统计',
              })}
            >
              <IconRefreshCw size={14} aria-hidden="true" />
              {t('monitoring.codex_inspection_refresh_stats', { defaultValue: '刷新统计' })}
            </Button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={openSettingsModal}
              disabled={isInspectionInFlight || executing || finishing}
              aria-label={t('monitoring.codex_inspection_settings_button')}
              title={t('monitoring.codex_inspection_settings_button')}
            >
              <IconSettings size={16} />
            </button>
            <Button
              variant="primary"
              onClick={handleRunInspection}
              loading={runStatus === 'running' && !finishing}
              disabled={runStatus === 'running' || executing || finishing || connectionStatus !== 'connected'}
            >
              {runButtonLabel}
            </Button>
            {showControlButtons ? (
              <>
                <Button
                  variant="secondary"
                  onClick={handlePauseInspection}
                  disabled={runStatus !== 'running' || executing || finishing}
                  title={t('monitoring.codex_inspection_pause_tip')}
                  aria-label={t('monitoring.codex_inspection_pause_tip')}
                >
                  {t('monitoring.codex_inspection_pause')}
                </Button>
                <Button
                  className={styles.finishButton}
                  variant="secondary"
                  onClick={handleFinishInspection}
                  loading={finishing}
                  disabled={executing || finishing}
                  title={t('monitoring.codex_inspection_finish_tip')}
                  aria-label={t('monitoring.codex_inspection_finish_tip')}
                >
                  {finishing
                    ? t('monitoring.codex_inspection_finishing')
                    : t('monitoring.codex_inspection_finish')}
                </Button>
                <Button
                  variant="danger"
                  onClick={handleStopInspection}
                  disabled={executing || finishing}
                  title={t('monitoring.codex_inspection_stop_tip')}
                  aria-label={t('monitoring.codex_inspection_stop_tip')}
                >
                  {t('monitoring.codex_inspection_stop')}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {showProgressBar ? (
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <strong>{t('monitoring.codex_inspection_progress_title')}</strong>
              <span>{`${progress.percent}%`}</span>
            </div>
            <div className={styles.progressTrack}>
              <span
                className={styles.progressBar}
                style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
              />
            </div>
            <div className={styles.progressMeta}>
              <span>{progressLabel}</span>
              {runStatus === 'paused' ? <strong>{t('monitoring.codex_inspection_paused')}</strong> : null}
            </div>
          </div>
        ) : null}
      </Card>

      <section className={styles.summaryGrid}>
        {summaryCards.map((card) => (
          <Card
            key={card.key}
            className={[
              styles.summaryCard,
              card.tone ? styles[`tone-${card.tone}`] : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className={styles.summaryLabel}>{card.label}</span>
            <strong className={styles.summaryValue}>{card.value}</strong>
            {card.subs?.map((sub) => (
              <span
                key={sub.label}
                className={[
                  styles.summarySub,
                  sub.tone ? styles[`tone-${sub.tone}`] : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={styles.summarySubLabel}>{sub.label}</span>
                <span className={styles.summarySubValue}>{sub.value}</span>
              </span>
            ))}
            <span className={styles.summaryMeta}>{card.meta}</span>
            {card.accountState ? (
              <div className={styles.summaryAccountState} aria-label={card.label}>
                <span className={`${styles.summaryAccountStateItem} ${styles['tone-good']}`}>
                  <span className={styles.summaryAccountStateLabel}>
                    {t('monitoring.codex_inspection_state_enabled')}
                  </span>
                  <span className={styles.summaryAccountStateValue}>
                    {card.accountState.enabled}
                  </span>
                </span>
                <span className={`${styles.summaryAccountStateItem} ${styles['tone-warn']}`}>
                  <span className={styles.summaryAccountStateLabel}>
                    {t('monitoring.codex_inspection_state_disabled')}
                  </span>
                  <span className={styles.summaryAccountStateValue}>
                    {card.accountState.disabled}
                  </span>
                </span>
              </div>
            ) : (
              <div className={styles.summaryAccountStatePlaceholder} aria-hidden="true">
                <span className={styles.summaryAccountStateItem}>
                  <span className={styles.summaryAccountStateLabel}>
                    {t('monitoring.codex_inspection_state_enabled')}
                  </span>
                  <span className={styles.summaryAccountStateValue}>--</span>
                </span>
                <span className={styles.summaryAccountStateItem}>
                  <span className={styles.summaryAccountStateLabel}>
                    {t('monitoring.codex_inspection_state_disabled')}
                  </span>
                  <span className={styles.summaryAccountStateValue}>--</span>
                </span>
              </div>
            )}
          </Card>
        ))}
      </section>

      <Panel
        title={t('monitoring.codex_inspection_results_title')}
        subtitle={t('monitoring.codex_inspection_results_desc')}
        extra={
          <div className={styles.resultsHeaderActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={openManualUpdateModal}
              disabled={
                !result ||
                isInspectionInFlight ||
                executing ||
                finishing ||
                updating ||
                filteredResults.length === 0
              }
            >
              <IconPencil size={14} aria-hidden="true" />
              {t('monitoring.codex_inspection_manual_update', { defaultValue: '手动更新' })}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleManualBatchAction('delete')}
              disabled={
                !result ||
                isInspectionInFlight ||
                executing ||
                finishing ||
                updating ||
                filteredResults.length === 0 ||
                inspectionSettings.accountSource === 'api_key'
              }
              title={
                inspectionSettings.accountSource === 'api_key'
                  ? t('monitoring.codex_inspection_api_key_delete_disabled', {
                      defaultValue: 'API Key 账号禁止删除',
                    })
                  : undefined
              }
            >
              {t('monitoring.codex_inspection_manual_delete', { defaultValue: '手动删除' })}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleManualBatchAction('disable')}
              disabled={
                !result ||
                isInspectionInFlight ||
                executing ||
                finishing ||
                updating ||
                filteredResults.length === 0
              }
            >
              {t('monitoring.codex_inspection_manual_disable', { defaultValue: '手动禁用' })}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleManualBatchAction('enable')}
              disabled={
                !result ||
                isInspectionInFlight ||
                executing ||
                finishing ||
                updating ||
                filteredResults.length === 0
              }
            >
              {t('monitoring.codex_inspection_manual_enable', { defaultValue: '手动启用' })}
            </Button>
            <Button
              variant={pendingActionCount > 0 ? 'danger' : 'primary'}
              size="sm"
              onClick={handleExecutePlanned}
              loading={executing}
              disabled={!result || isInspectionInFlight || executing || pendingActionCount === 0}
            >
              {executing
                ? t('monitoring.codex_inspection_executing')
                : t('monitoring.codex_inspection_execute_now')}
            </Button>
          </div>
        }
      >
        {result ? (
          <>
            <div className={styles.filterRow}>
              <div className={styles.segmentedControl}>
                {resultFilters.map((filter) => {
                  const count = filterCounts[filter];
                  const isActive = actionFilter === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      className={`${styles.segmentButton} ${isActive ? styles.segmentButtonActive : ''}`}
                      onClick={() => setActionFilter(filter)}
                    >
                      <span>{filterLabel(filter)}</span>
                      <span className={styles.segmentCount}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <colgroup>
                  <col className={styles.accountColumn} />
                  <col className={styles.stateColumn} />
                  <col className={styles.httpColumn} />
                  <col className={styles.usageColumn} />
                  <col className={styles.actionColumn} />
                  <col className={styles.operationColumn} />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t('monitoring.account_label')}</th>
                    <th>{t('monitoring.codex_inspection_current_state')}</th>
                    <th>{t('monitoring.codex_inspection_http_status')}</th>
                    <th>{t('monitoring.codex_inspection_used_percent')}</th>
                    <th>{t('monitoring.codex_inspection_next_action')}</th>
                    <th>{t('common.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.length > 0 ? (
                    filteredResults.map((item) => (
                      <tr key={item.key}>
                        <td>
                          <div className={styles.primaryCell}>
                            <span className={styles.primaryAccount}>{item.displayAccount}</span>
                            <small className={styles.primaryFile}>
                              {item.fileName}
                              {item.authIndex ? (
                                <span className={styles.primaryIndex}>{` · #${item.authIndex}`}</span>
                              ) : null}
                            </small>
                            {item.actionReason ? (
                              <small className={styles.primaryReason}>{item.actionReason}</small>
                            ) : null}
                            {item.error ? (
                              <small className={styles.primaryError}>{item.error}</small>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`${styles.stateChip} ${
                              item.disabled ? styles.stateDisabled : styles.stateEnabled
                            }`}
                          >
                            {formatCurrentStateLabel(item, t)}
                          </span>
                        </td>
                        <td className={styles.monoCell}>
                          {item.statusCode === null ? '--' : item.statusCode}
                        </td>
                        <td className={styles.monoCell}>{formatPercent(item.usedPercent)}</td>
                        <td>
                          <span className={`${styles.actionBadge} ${actionToneClass[item.action]}`}>
                            {formatActionLabel(item.action, t)}
                          </span>
                        </td>
                        <td>
                          <div className={styles.rowActions}>
                            {isSuggestedAction(item) ? (
                              <Button
                                size="sm"
                                variant={item.action === 'delete' ? 'danger' : 'secondary'}
                                onClick={() => handleExecuteSingle(item)}
                                disabled={isInspectionInFlight || executing || Boolean(resettingCooldownKey)}
                              >
                                {formatActionLabel(item.action, t)}
                              </Button>
                            ) : (
                              <span className={styles.mutedText}>{t('monitoring.codex_inspection_no_action_needed')}</span>
                            )}
                            {item.authIndex ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleResetRoutingCooldown(item)}
                                disabled={isInspectionInFlight || executing || Boolean(resettingCooldownKey)}
                                loading={resettingCooldownKey === item.key}
                                title={t('monitoring.codex_inspection_reset_cooldown_hint')}
                              >
                                <IconRefreshCw size={14} />
                                {t('monitoring.codex_inspection_reset_cooldown')}
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>
                        <div className={styles.emptyBlockSmall}>
                          {t('monitoring.codex_inspection_no_filter_results')}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className={styles.emptyBlock}>{t('monitoring.codex_inspection_empty')}</div>
        )}
      </Panel>

      <Panel
        title={t('monitoring.codex_inspection_logs_title')}
        subtitle={t('monitoring.codex_inspection_logs_desc')}
        extra={
          <div className={styles.logActions}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={handleJumpToLatest}
              disabled={logs.length === 0}
              aria-label={t('monitoring.codex_inspection_logs_jump_latest')}
              title={t('monitoring.codex_inspection_logs_jump_latest')}
            >
              <IconRefreshCw size={14} />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={handleClearLogs}
              disabled={logs.length === 0}
              aria-label={t('monitoring.codex_inspection_logs_clear')}
              title={t('monitoring.codex_inspection_logs_clear')}
            >
              <IconTrash2 size={14} />
            </button>
            <button
              type="button"
              className={styles.foldButton}
              onClick={() => setLogsCollapsed((previous) => !previous)}
              disabled={logs.length === 0}
            >
              {logsCollapsed ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}
              <span>
                {logsCollapsed
                  ? t('monitoring.codex_inspection_expand_logs')
                  : t('monitoring.codex_inspection_fold_logs')}
              </span>
            </button>
          </div>
        }
      >
        {!logsCollapsed ? (
          <div ref={logListRef} className={styles.logList}>
            {logs.length > 0 ? (
              logs.map((entry) => (
                <div key={entry.id} className={`${styles.logRow} ${levelClassMap[entry.level]}`}>
                  <span className={styles.logTime}>{formatTimestamp(entry.timestamp, i18n.language)}</span>
                  <span className={styles.logMessage}>{entry.message}</span>
                </div>
              ))
            ) : (
              <div className={styles.emptyBlockSmall}>{t('monitoring.codex_inspection_logs_empty')}</div>
            )}
          </div>
        ) : (
          <div className={styles.logCollapsedBar}>
            <span>{t('monitoring.codex_inspection_logs_collapsed', { count: logs.length })}</span>
          </div>
        )}
      </Panel>


      <Modal
        open={isUpdateModalOpen}
        onClose={() => {
          if (updating) return;
          setIsUpdateModalOpen(false);
        }}
        title={t('monitoring.codex_inspection_manual_update_title', { defaultValue: '手动更新账号字段' })}
        width={640}
        closeDisabled={updating}
        footer={
          <div className={styles.updateModalFooter}>
            <span className={styles.updateModalFooterInfo}>
              {t('monitoring.codex_inspection_manual_update_scope', {
                count: manualUpdateTargetCount,
                type: inspectionSettings.targetType,
                defaultValue: '将更新当前面板（{{type}}）筛选结果中的 {{count}} 个账号文件',
              })}
            </span>
            <div className={styles.updateModalFooterButtons}>
              <Button
                variant="secondary"
                onClick={() => setIsUpdateModalOpen(false)}
                disabled={updating}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleManualUpdateExecute()}
                loading={updating}
                disabled={updating || filteredResults.length === 0}
              >
                {updating
                  ? t('monitoring.codex_inspection_manual_update_progress', {
                      done: updateProgress?.done ?? 0,
                      total: updateProgress?.total ?? filteredResults.length,
                      defaultValue: '更新中 {{done}}/{{total}}',
                    })
                  : t('monitoring.codex_inspection_manual_update_execute', {
                      defaultValue: '执行更新',
                    })}
              </Button>
            </div>
          </div>
        }
      >
        <div className={styles.updateModalBody}>
          <p className={styles.updateModalHint}>
            {t('monitoring.codex_inspection_manual_update_hint', {
              type: inspectionSettings.targetType,
              defaultValue:
                '仅修改当前账号类型（{{type}}）下、当前筛选列表中的认证文件。勾选需要写入的字段后执行。',
            })}
          </p>

          <div className={styles.updateFieldBlock}>
            <SelectionCheckbox
              checked={updateDraft.updateHeaders}
              onChange={(checked) => handleManualUpdateDraftChange('updateHeaders', checked)}
              disabled={updating}
              label={t('monitoring.codex_inspection_manual_update_field_headers', {
                defaultValue: '自定义请求头（headers）',
              })}
            />
            <div className={styles.updateFieldControl}>
              <label className={styles.updateFieldLabel} htmlFor="codex-inspection-manual-headers-json">
                {t('monitoring.codex_inspection_manual_update_headers_label', {
                  defaultValue: 'headers JSON',
                })}
              </label>
              <textarea
                id="codex-inspection-manual-headers-json"
                className={styles.headersJsonTextarea}
                value={updateDraft.headersJson}
                onChange={(event) => handleManualUpdateDraftChange('headersJson', event.target.value)}
                disabled={updating || !updateDraft.updateHeaders}
                rows={8}
                spellCheck={false}
                placeholder={
                  inspectionSettings.userAgent
                    ? JSON.stringify({ 'User-Agent': inspectionSettings.userAgent }, null, 2)
                    : '{\n  "User-Agent": "codex_cli_rs/0.76.0",\n  "X-Custom-Header": "value"\n}'
                }
              />
              <p className={styles.updateFieldHint}>
                {t('monitoring.codex_inspection_manual_update_headers_hint', {
                  defaultValue:
                    '输入 JSON 对象批量写入账号 headers。同名键会覆盖；空字符串会删除该请求头。',
                })}
              </p>
            </div>
          </div>

          <div className={styles.updateFieldBlock}>
            <SelectionCheckbox
              checked={updateDraft.updatePriority}
              onChange={(checked) => handleManualUpdateDraftChange('updatePriority', checked)}
              disabled={updating}
              label={t('monitoring.codex_inspection_manual_update_field_priority', {
                defaultValue: '优先级',
              })}
            />
            <Input
              label={t('monitoring.codex_inspection_manual_update_priority_label', {
                defaultValue: 'priority',
              })}
              type="number"
              value={updateDraft.priority}
              onChange={(event) => handleManualUpdateDraftChange('priority', event.target.value)}
              disabled={updating || !updateDraft.updatePriority}
              placeholder="0"
              step={1}
            />
          </div>

          <div className={styles.updateFieldBlock}>
            <SelectionCheckbox
              checked={updateDraft.updateProxyUrl}
              onChange={(checked) => handleManualUpdateDraftChange('updateProxyUrl', checked)}
              disabled={updating}
              label={t('monitoring.codex_inspection_manual_update_field_proxy', {
                defaultValue: '代理 URL',
              })}
            />
            <Input
              label={t('monitoring.codex_inspection_manual_update_proxy_label', {
                defaultValue: 'proxy_url',
              })}
              value={updateDraft.proxyUrl}
              onChange={(event) => handleManualUpdateDraftChange('proxyUrl', event.target.value)}
              disabled={updating || !updateDraft.updateProxyUrl}
              placeholder="socks5://127.0.0.1:1080"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        title={t('monitoring.codex_inspection_settings_title')}
        width={1040}
        className={styles.settingsModal}
      >
        <div className={styles.settingsBody}>
          <SettingsSection
            icon={<IconCrosshair size={18} />}
            title={t('monitoring.codex_inspection_settings_group_strategy')}
          >
            <div className={`${styles.settingsGrid} ${styles.settingsGridStrategy}`}>
              <div className={styles.settingsField}>
                <span className={styles.settingsFieldLabel}>
                  {t('monitoring.codex_inspection_account_source', { defaultValue: '账号源' })}
                </span>
                <Select
                  value={settingsDraft.accountSource}
                  options={INSPECTION_ACCOUNT_SOURCES.map((source) => ({
                    value: source,
                    label: t(`monitoring.codex_inspection_account_source_${source}`, {
                      defaultValue: source === 'api_key' ? 'API Key 提供商' : 'OAuth 认证文件',
                    }),
                  }))}
                  onChange={(value) =>
                    setSettingsDraft((previous) => {
                      const accountSource = normalizeInspectionAccountSource(value, previous.accountSource);
                      const targetType =
                        accountSource === 'api_key'
                          ? normalizeInspectionApiKeyFamily(previous.targetType, 'all')
                          : isSupportedInspectionTargetType(previous.targetType)
                            ? previous.targetType
                            : 'codex';
                      return {
                        ...previous,
                        accountSource,
                        targetType,
                        realtimeAutoActions: normalizeRealtimeAutoActions(
                          previous.realtimeAutoActions,
                          accountSource
                        ),
                      };
                    })
                  }
                  ariaLabel={t('monitoring.codex_inspection_account_source', { defaultValue: '账号源' })}
                />
              </div>
              <div className={styles.settingsField}>
                <span className={styles.settingsFieldLabel}>
                  {t('monitoring.codex_inspection_settings_target_type_label')}
                </span>
                <Select
                  value={settingsDraft.targetType}
                  options={
                    settingsDraft.accountSource === 'api_key'
                      ? INSPECTION_API_KEY_FAMILIES.map((family) => ({
                          value: family,
                          label: t(
                            `monitoring.codex_inspection_api_key_family_${family.replace('-', '_')}`,
                            {
                              defaultValue:
                                family === 'all'
                                  ? '全部 API Key'
                                  : family === 'openai-compat'
                                    ? 'OpenAI Compatible'
                                    : family,
                            }
                          ),
                        }))
                      : SUPPORTED_INSPECTION_TARGET_TYPES.map((type) => ({
                          value: type,
                          label: t(
                            `monitoring.codex_inspection_target_type_option_${type.replace('-', '_')}`,
                            { defaultValue: type }
                          ),
                        }))
                  }
                  onChange={(value) => handleSettingsDraftChange('targetType', value)}
                  ariaLabel={t('monitoring.codex_inspection_settings_target_type_label')}
                />
                <small className={styles.settingsFieldHint}>
                  {t('monitoring.codex_inspection_settings_target_type_hint')}
                </small>
              </div>
              <div className={styles.settingsField}>
                <Input
                  label={t('monitoring.codex_inspection_settings_used_percent_threshold_label')}
                  hint={t('monitoring.codex_inspection_settings_threshold_hint')}
                  type="number"
                  value={settingsDraft.usedPercentThreshold}
                  onChange={(event) => handleSettingsDraftChange('usedPercentThreshold', event.target.value)}
                  min={0}
                  max={100}
                  step={0.1}
                />
              </div>
              <div className={styles.settingsField}>
                <Input
                  label={t('monitoring.codex_inspection_settings_sample_size_label')}
                  hint={t('monitoring.codex_inspection_settings_sample_size_hint')}
                  type="number"
                  value={settingsDraft.sampleSize}
                  onChange={(event) => handleSettingsDraftChange('sampleSize', event.target.value)}
                  min={0}
                  step={1}
                />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            icon={<IconTimer size={18} />}
            title={t('monitoring.codex_inspection_settings_group_concurrency')}
          >
            <div className={`${styles.settingsGrid} ${styles.settingsGridConcurrency}`}>
              <div className={styles.settingsField}>
                <Input
                  label={t('monitoring.codex_inspection_settings_workers_label')}
                  type="number"
                  value={settingsDraft.workers}
                  onChange={(event) => handleSettingsDraftChange('workers', event.target.value)}
                  min={1}
                  step={1}
                />
              </div>
              <div className={styles.settingsField}>
                <Input
                  label={t('monitoring.codex_inspection_settings_delete_workers_label')}
                  type="number"
                  value={settingsDraft.deleteWorkers}
                  onChange={(event) => handleSettingsDraftChange('deleteWorkers', event.target.value)}
                  min={1}
                  step={1}
                />
              </div>
              <div className={styles.settingsField}>
                <Input
                  label={t('monitoring.codex_inspection_settings_timeout_label')}
                  type="number"
                  value={settingsDraft.timeout}
                  onChange={(event) => handleSettingsDraftChange('timeout', event.target.value)}
                  min={1}
                  step={100}
                />
              </div>
              <div className={styles.settingsField}>
                <Input
                  label={t('monitoring.codex_inspection_settings_retries_label')}
                  type="number"
                  value={settingsDraft.retries}
                  onChange={(event) => handleSettingsDraftChange('retries', event.target.value)}
                  min={0}
                  step={1}
                />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            icon={<IconBot size={18} />}
            title={t('monitoring.codex_inspection_settings_user_agent_label')}
          >
            <div className={styles.settingsGrid}>
              <div className={`${styles.settingsField} ${styles.settingsFieldWide}`}>
                <Input
                  label={t('monitoring.codex_inspection_settings_user_agent_label')}
                  value={settingsDraft.userAgent}
                  onChange={(event) => handleSettingsDraftChange('userAgent', event.target.value)}
                  placeholder={DEFAULT_CODEX_INSPECTION_SETTINGS.userAgent}
                />
              </div>
              <div className={`${styles.settingsField} ${styles.settingsFieldWide}`}>
                <span className={styles.settingsFieldLabel}>
                  {t('monitoring.codex_inspection_settings_probe_prompt_mode_label', {
                    defaultValue: '巡检提示词',
                  })}
                </span>
                <Select
                  value={settingsDraft.probePromptMode}
                  options={CODEX_INSPECTION_PROBE_PROMPT_MODES.map((mode) => ({
                    value: mode,
                    label: t(`monitoring.codex_inspection_settings_probe_prompt_mode_${mode}`, {
                      defaultValue:
                        mode === 'math'
                          ? '随机数学题'
                          : mode === 'random'
                            ? '随机字符串运算'
                            : '固定文本',
                    }),
                  }))}
                  onChange={handleProbePromptModeChange}
                  ariaLabel={t('monitoring.codex_inspection_settings_probe_prompt_mode_label', {
                    defaultValue: '巡检提示词',
                  })}
                />
                <small className={styles.settingsFieldHint}>
                  {t('monitoring.codex_inspection_settings_probe_prompt_mode_hint', {
                    defaultValue:
                      '用于 chat 类探测（如 xAI / API Key 回退）的用户提示词。默认随机数学题；HTTP 200 不输出返回体。',
                  })}
                </small>
              </div>
              <div className={`${styles.settingsField} ${styles.settingsFieldWide}`}>
                <Input
                  label={t('monitoring.codex_inspection_settings_probe_model_label', {
                    defaultValue: 'API Key 探测模型',
                  })}
                  value={settingsDraft.probeModel}
                  onChange={(event) => handleSettingsDraftChange('probeModel', event.target.value)}
                  placeholder={t('monitoring.codex_inspection_settings_probe_model_placeholder', {
                    defaultValue: '可选；chat 回退时使用，如 gpt-4o-mini',
                  })}
                  hint={t('monitoring.codex_inspection_settings_probe_model_hint', {
                    defaultValue:
                      '仅 API Key 源在 /models 不可用时的 chat 探测使用。留空则按 family 默认模型。',
                  })}
                />
              </div>
              <div className={`${styles.settingsField} ${styles.settingsFieldWide}`}>
                <Input
                  label={t('monitoring.codex_inspection_settings_provider_filter_label', {
                    defaultValue: 'API Key 提供商过滤',
                  })}
                  value={settingsDraft.providerFilter}
                  onChange={(event) =>
                    handleSettingsDraftChange('providerFilter', event.target.value)
                  }
                  placeholder={t('monitoring.codex_inspection_settings_provider_filter_placeholder', {
                    defaultValue: '可选；按 provider / label / base_url 子串过滤，如 kimi',
                  })}
                  hint={t('monitoring.codex_inspection_settings_provider_filter_hint', {
                    defaultValue: '仅 API Key 源生效，用于限定某一 OpenAI Compatible 实例或关键字。',
                  })}
                />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            icon={<IconSettings size={18} />}
            title={t('monitoring.codex_inspection_settings_group_auto')}
          >
            <div className={styles.settingsAutoContent}>
              <span className={styles.settingsAutoLabel}>
                {t('monitoring.codex_inspection_settings_auto_action_mode_label')}
              </span>
              <div className={styles.settingsAutoCards}>
                {(settingsDraft.accountSource === 'api_key'
                  ? CODEX_INSPECTION_AUTO_ACTION_MODES.filter(
                      (mode) => mode === 'none' || mode === 'disable'
                    )
                  : CODEX_INSPECTION_AUTO_ACTION_MODES
                ).map((mode) => {
                  const active = settingsDraft.autoActionMode === mode;
                  const toneClass =
                    mode === 'delete'
                      ? styles.settingsAutoOptionDelete
                      : mode === 'strategy6'
                        ? styles.settingsAutoOptionStrategy6
                        : mode === 'strategy5'
                          ? styles.settingsAutoOptionStrategy5
                          : mode === 'strategy4'
                            ? styles.settingsAutoOptionStrategy4
                            : mode === 'disable'
                        ? styles.settingsAutoOptionDisable
                        : styles.settingsAutoOptionNone;
                  const ModeIcon =
                    mode === 'delete'
                      ? IconTrash2
                      : mode === 'disable' || mode === 'strategy4' || mode === 'strategy5' || mode === 'strategy6'
                        ? IconShield
                        : IconCrosshair;

                  return (
                    <button
                      key={mode}
                      type="button"
                      className={[
                        styles.settingsAutoOption,
                        toneClass,
                        active ? styles.settingsAutoOptionActive : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => handleAutoActionModeChange(mode)}
                      aria-pressed={active}
                    >
                      <span className={styles.settingsAutoOptionIcon}>
                        <ModeIcon size={34} />
                      </span>
                      <span className={styles.settingsAutoOptionText}>
                        <strong>{formatAutoActionModeLabel(mode, t)}</strong>
                        <small>
                          {t(`monitoring.codex_inspection_settings_auto_action_mode_${mode}_desc`)}
                        </small>
                      </span>
                      <span className={styles.settingsAutoOptionCheck}>
                        {active ? <IconCheck size={14} /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className={styles.settingsAutoHint}>
                {t('monitoring.codex_inspection_settings_auto_action_mode_hint')}
              </p>
              {settingsDraft.autoActionMode !== 'none' ? (
                <p
                  className={[
                    styles.settingsAutoWarning,
                    settingsDraft.autoActionMode === 'delete'
                      ? styles.settingsAutoWarningDelete
                      : styles.settingsAutoWarningDisable,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {t(getAutoActionWarningKey(settingsDraft.autoActionMode))}
                </p>
              ) : null}

              <div className={styles.settingsRealtimeBlock}>
                <span className={styles.settingsAutoLabel}>
                  {t('monitoring.codex_inspection_settings_realtime_auto_label', {
                    defaultValue: '实时自动执行',
                  })}
                </span>
                <div className={styles.settingsRealtimeChecks}>
                  <SelectionCheckbox
                    checked={settingsDraft.realtimeAutoActions.disable}
                    onChange={(checked) => handleRealtimeAutoActionChange('disable', checked)}
                    disabled={settingsDraft.autoActionMode === 'none'}
                    label={t('monitoring.codex_inspection_settings_realtime_disable', {
                      defaultValue: '实时禁用',
                    })}
                  />
                  <SelectionCheckbox
                    checked={settingsDraft.realtimeAutoActions.enable}
                    onChange={(checked) => handleRealtimeAutoActionChange('enable', checked)}
                    disabled={settingsDraft.autoActionMode === 'none'}
                    label={t('monitoring.codex_inspection_settings_realtime_enable', {
                      defaultValue: '实时启用',
                    })}
                  />
                  <SelectionCheckbox
                    checked={
                      settingsDraft.accountSource === 'api_key'
                        ? false
                        : settingsDraft.realtimeAutoActions.delete
                    }
                    onChange={(checked) => handleRealtimeAutoActionChange('delete', checked)}
                    disabled={
                      settingsDraft.autoActionMode === 'none' ||
                      settingsDraft.accountSource === 'api_key'
                    }
                    label={t('monitoring.codex_inspection_settings_realtime_delete', {
                      defaultValue: '实时删除',
                    })}
                  />
                </div>
                <p className={styles.settingsAutoHint}>
                  {t('monitoring.codex_inspection_settings_realtime_auto_hint', {
                    defaultValue:
                      '巡检过程中一旦出现匹配建议动作，立即按勾选项执行，使禁用/启用更快生效。默认勾选实时禁用与启用；删除默认不勾选。需先选择非「什么都不做」的自动处理策略。API Key 源不支持实时删除。',
                  })}
                </p>
              </div>
            </div>
          </SettingsSection>
        </div>

        <div className={styles.settingsActionsBar}>
          <Button className={styles.settingsResetButton} variant="secondary" onClick={handleResetSettings}>
            {t('monitoring.codex_inspection_settings_reset_button')}
          </Button>
          <Button variant="secondary" onClick={() => setIsSettingsModalOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSaveSettings}>
            {t('common.save')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
