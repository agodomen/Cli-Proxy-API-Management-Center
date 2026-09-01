import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { getDebugSchema, listDebugDatabases, runDebugQuery } from './debug/api';
import { ApiDebugPanel } from './debug/ApiDebugPanel';
import { EntryDock } from './debug/EntryDock';
import { KeyDebugPanel } from './debug/KeyDebugPanel';
import { ResultTable } from './debug/ResultTable';
import { SchemaBrowser } from './debug/SchemaBrowser';
import { SqlEditor } from './debug/SqlEditor';
import { SqlToolbar } from './debug/SqlToolbar';
import { StatsTemplates } from './debug/StatsTemplates';
import { WriteConfirmModal } from './debug/WriteConfirmModal';
import {
  buildCountSql,
  buildInsertColumn,
  buildSelectSql,
  buildTableCountsSql,
  downloadText,
  formatSqlLoose,
  isWriteSql,
  rowsToCsv,
  STATS_TEMPLATES,
  type StatsTemplateId,
} from './debug/sqlUtils';
import type {
  DebugDatabase,
  DebugWorkspace,
  QueryResponse,
  SchemaTable,
  SqlMode,
} from './debug/types';
import styles from './debug/DebugPage.module.scss';

const DEFAULT_SQL = `SELECT name AS table_name, type
FROM sqlite_master
WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
ORDER BY type, name
LIMIT 100;`;

function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string; code?: string } | undefined;
    if (data?.error) return data.error;
    if (data?.code) return data.code;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function DebugPage() {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore((s) => s.serviceBase);
  const managementKey = useAuthStore((s) => s.managementKey) ?? '';
  const showNotification = useNotificationStore((s) => s.showNotification);

  const [workspace, setWorkspace] = useState<DebugWorkspace>('sql');
  const [mode, setMode] = useState<SqlMode>('data');
  const [databases, setDatabases] = useState<DebugDatabase[]>([]);
  const [databaseId, setDatabaseId] = useState('primary');
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | undefined>();
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'running' | 'ok' | 'error'>('idle');
  const [writeOpen, setWriteOpen] = useState(false);
  const [activeStatsId, setActiveStatsId] = useState<StatsTemplateId | null>(null);

  const statusText = useMemo(() => {
    if (status === 'running') return t('charitable.debug.statusRunning');
    if (status === 'ok') {
      if (result?.kind === 'exec') {
        return t('charitable.debug.statusExecOk', { count: result.rowsAffected ?? 0 });
      }
      return t('charitable.debug.statusOk', {
        count: result?.rowCount ?? 0,
        ms: result?.durationMs ?? 0,
      });
    }
    if (status === 'error') return t('charitable.debug.statusError');
    return t('charitable.debug.statusIdle');
  }, [status, result, t]);

  const loadDatabases = useCallback(async () => {
    if (!baseUrl) {
      setDatabases([]);
      return;
    }
    try {
      const items = await listDebugDatabases(baseUrl, managementKey || undefined);
      setDatabases(items);
      setDatabaseId((current) => {
        if (items.some((item) => item.id === current && item.available)) {
          return current;
        }
        const first = items.find((item) => item.available) ?? items[0];
        return first?.id ?? current;
      });
    } catch (err) {
      showNotification(t('charitable.debug.loadDatabasesFailed'), 'error');
      setError(extractErrorMessage(err));
      setStatus('error');
    }
  }, [baseUrl, managementKey, showNotification, t]);

  const loadSchema = useCallback(async () => {
    if (!baseUrl || !databaseId) {
      setTables([]);
      return;
    }
    setSchemaLoading(true);
    try {
      const schema = await getDebugSchema(baseUrl, databaseId, managementKey || undefined);
      setTables(schema.tables ?? []);
    } catch (err) {
      setTables([]);
      showNotification(t('charitable.debug.loadSchemaFailed'), 'error');
      setError(extractErrorMessage(err));
      setStatus('error');
    } finally {
      setSchemaLoading(false);
    }
  }, [baseUrl, databaseId, managementKey, showNotification, t]);

  useEffect(() => {
    if (workspace !== 'sql') return;
    void loadDatabases();
  }, [workspace, loadDatabases]);

  useEffect(() => {
    if (workspace !== 'sql') return;
    void loadSchema();
  }, [workspace, loadSchema]);

  const execute = useCallback(
    async (confirmWrite: boolean) => {
      if (!baseUrl) {
        showNotification(t('charitable.debug.baseMissing'), 'error');
        return;
      }
      const trimmed = sql.trim();
      if (!trimmed) {
        showNotification(t('charitable.debug.emptySql'), 'error');
        return;
      }

      if (!confirmWrite && isWriteSql(trimmed)) {
        setWriteOpen(true);
        return;
      }

      setLoading(true);
      setStatus('running');
      setError(null);
      try {
        const next = await runDebugQuery(
          baseUrl,
          {
            databaseId,
            sql: trimmed,
            confirmWrite,
            maxRows: 500,
          },
          managementKey || undefined
        );
        setResult(next);
        setStatus('ok');
        showNotification(
          next.kind === 'exec'
            ? t('charitable.debug.execDone', { count: next.rowsAffected ?? 0 })
            : t('charitable.debug.queryDone', { count: next.rowCount }),
          'success'
        );
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.data?.code === 'write_confirmation_required') {
          setWriteOpen(true);
          setStatus('idle');
          return;
        }
        const message = extractErrorMessage(err);
        setResult(null);
        setError(message);
        setStatus('error');
        showNotification(t('charitable.debug.queryFailed'), 'error');
      } finally {
        setLoading(false);
      }
    },
    [baseUrl, sql, databaseId, managementKey, showNotification, t]
  );

  const handleSelectTable = (table: SchemaTable) => {
    setSelectedTable(table.name);
    if (mode === 'stats') {
      setSql(buildCountSql(table.name));
    } else {
      setSql(buildSelectSql(table.name));
    }
  };

  const handleInsertColumn = (_table: string, column: string) => {
    const snippet = buildInsertColumn(column);
    setSql((prev) => {
      if (!prev.trim()) return snippet;
      if (prev.endsWith(' ') || prev.endsWith('\n') || prev.endsWith(',') || prev.endsWith('(')) {
        return `${prev}${snippet}`;
      }
      return `${prev} ${snippet}`;
    });
  };

  const handleStatsPick = (id: StatsTemplateId) => {
    setActiveStatsId(id);
    if (id === 'table_counts') {
      setSql(buildTableCountsSql(tables.map((item) => item.name)));
      return;
    }
    const template = STATS_TEMPLATES.find((item) => item.id === id);
    if (template) setSql(template.sql);
  };

  const handleExport = () => {
    if (!result?.columns || !result.rows) return;
    const csv = rowsToCsv(result.columns, result.rows);
    downloadText(`debug-query-${Date.now()}.csv`, csv);
  };

  const handleCopy = async () => {
    try {
      const text =
        result?.kind === 'query' ? rowsToCsv(result.columns ?? [], result.rows ?? []) : sql;
      await navigator.clipboard.writeText(text);
      showNotification(t('charitable.debug.copied'), 'success');
    } catch {
      showNotification(t('charitable.debug.copyFailed'), 'error');
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{t('charitable.debug.title')}</h1>
          <p className={styles.subtitle}>
            {workspace === 'sql'
              ? t('charitable.debug.workspaceSqlDesc')
              : workspace === 'api'
                ? t('charitable.debug.workspaceApiDesc')
                : t('charitable.debug.workspaceKeyDesc')}
          </p>
        </div>
      </div>

      {workspace === 'sql' ? (
        <div className={styles.sqlWorkspace}>
          <SqlToolbar
            mode={mode}
            onModeChange={(next) => {
              setMode(next);
              setActiveStatsId(null);
            }}
            databases={databases}
            databaseId={databaseId}
            onDatabaseChange={setDatabaseId}
            onRefreshSchema={() => {
              void loadDatabases();
              void loadSchema();
            }}
            onRun={() => void execute(false)}
            onFormat={() => setSql((prev) => formatSqlLoose(prev))}
            onClear={() => {
              setSql('');
              setResult(null);
              setError(null);
              setStatus('idle');
            }}
            onCopy={() => void handleCopy()}
            onExport={handleExport}
            canExport={Boolean(result?.columns?.length && result.rows)}
            loading={loading || schemaLoading}
            status={status}
            statusText={statusText}
            labels={{
              dataQuery: t('charitable.debug.dataQuery'),
              statsQuery: t('charitable.debug.statsQuery'),
              run: t('charitable.debug.run'),
              format: t('charitable.debug.format'),
              clear: t('charitable.debug.clear'),
              copy: t('charitable.debug.copy'),
              exportCsv: t('charitable.debug.exportCsv'),
              refreshSchema: t('charitable.debug.refreshSchema'),
              database: t('charitable.debug.database'),
            }}
          />

          <div className={styles.body}>
            <SchemaBrowser
              title={t('charitable.debug.schema')}
              tables={tables}
              selectedTable={selectedTable}
              onSelectTable={handleSelectTable}
              onInsertColumn={handleInsertColumn}
              emptyText={
                baseUrl ? t('charitable.debug.schemaEmpty') : t('charitable.debug.baseMissing')
              }
            />

            <section className={styles.main}>
              {mode === 'stats' ? (
                <StatsTemplates
                  activeId={activeStatsId}
                  onPick={handleStatsPick}
                  labels={{
                    table_counts: t('charitable.debug.statsTemplates.table_counts'),
                    usage_by_model: t('charitable.debug.statsTemplates.usage_by_model'),
                    usage_by_provider: t('charitable.debug.statsTemplates.usage_by_provider'),
                    keys_status: t('charitable.debug.statsTemplates.keys_status'),
                    recent_usage: t('charitable.debug.statsTemplates.recent_usage'),
                  }}
                />
              ) : null}

              <SqlEditor
                label={t('charitable.debug.sql')}
                value={sql}
                onChange={setSql}
                onRun={() => void execute(false)}
                placeholder={t('charitable.debug.sqlPlaceholder')}
              />

              <ResultTable
                result={result}
                error={error}
                emptyText={t('charitable.debug.noRows')}
                labels={{
                  result: t('charitable.debug.result'),
                  rows: t('charitable.debug.rows'),
                  affected: t('charitable.debug.rowsAffected'),
                  duration: t('charitable.debug.duration'),
                  truncated: t('charitable.debug.truncated'),
                  execOk: t('charitable.debug.execOk'),
                }}
              />
            </section>
          </div>

          <WriteConfirmModal
            open={writeOpen}
            sql={sql}
            onClose={() => setWriteOpen(false)}
            onConfirm={() => {
              setWriteOpen(false);
              void execute(true);
            }}
            labels={{
              title: t('charitable.debug.writeConfirmTitle'),
              hint: t('charitable.debug.writeConfirmHint'),
              cancel: t('charitable.cancel'),
              confirm: t('charitable.debug.writeConfirmAction'),
            }}
          />
        </div>
      ) : workspace === 'api' ? (
        <div className={styles.apiWorkspace}>
          <ApiDebugPanel />
        </div>
      ) : (
        <div className={styles.apiWorkspace}>
          <KeyDebugPanel />
        </div>
      )}

      <EntryDock
        workspace={workspace}
        onWorkspaceChange={setWorkspace}
        labels={{
          sql: t('charitable.debug.sqlEntry'),
          api: t('charitable.debug.apiEntry'),
          key: t('charitable.debug.keyEntry'),
          toolbar: t('charitable.debug.entryToolbar'),
        }}
      />
    </div>
  );
}
