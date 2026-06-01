import type { ReactNode } from 'react';
import {
  GlyphClear,
  GlyphCopy,
  GlyphData,
  GlyphDb,
  GlyphExport,
  GlyphFormat,
  GlyphRefresh,
  GlyphRun,
  GlyphSpinner,
  GlyphStats,
  MicroIcon,
  type MicroIconTone,
} from './MicroIcon';
import type { DebugDatabase, SqlMode } from './types';
import styles from './DebugPage.module.scss';

type RunStatus = 'idle' | 'running' | 'ok' | 'error';

interface SqlToolbarProps {
  mode: SqlMode;
  onModeChange: (mode: SqlMode) => void;
  databases: DebugDatabase[];
  databaseId: string;
  onDatabaseChange: (id: string) => void;
  onRefreshSchema: () => void;
  onRun: () => void;
  onFormat: () => void;
  onClear: () => void;
  onCopy: () => void;
  onExport: () => void;
  canExport: boolean;
  loading: boolean;
  status: RunStatus;
  statusText: string;
  labels: {
    dataQuery: string;
    statsQuery: string;
    run: string;
    format: string;
    clear: string;
    copy: string;
    exportCsv: string;
    refreshSchema: string;
    database: string;
  };
}

function Group({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className={styles.sqlToolGroup} role="group" aria-label={label}>
      {children}
    </div>
  );
}

function Divider() {
  return <span className={styles.sqlToolDivider} aria-hidden="true" />;
}

function EntryButton({
  active,
  tone,
  label,
  title,
  onClick,
  disabled,
  spinning,
  children,
  emphasize,
}: {
  active?: boolean;
  tone?: MicroIconTone;
  label?: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
  children: ReactNode;
  emphasize?: 'blue' | 'green' | 'red';
}) {
  const className = [
    styles.sqlToolBtn,
    active ? styles.sqlToolBtnActive : '',
    emphasize === 'blue' ? styles.sqlToolBtnBlue : '',
    emphasize === 'green' ? styles.sqlToolBtnGreen : '',
    emphasize === 'red' ? styles.sqlToolBtnRed : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
    >
      <MicroIcon tone={tone ?? 'neutral'} active={Boolean(active)} size={14} spinning={spinning}>
        {children}
      </MicroIcon>
      {label ? <span className={styles.sqlToolBtnLabel}>{label}</span> : null}
    </button>
  );
}

export function SqlToolbar({
  mode,
  onModeChange,
  databases,
  databaseId,
  onDatabaseChange,
  onRefreshSchema,
  onRun,
  onFormat,
  onClear,
  onCopy,
  onExport,
  canExport,
  loading,
  status,
  statusText,
  labels,
}: SqlToolbarProps) {
  const statusTone =
    status === 'ok'
      ? styles.statusOk
      : status === 'error'
        ? styles.statusErr
        : status === 'running'
          ? styles.statusRun
          : styles.statusIdle;

  return (
    <div className={styles.sqlToolbar} role="toolbar" aria-label="sql tools">
      <Group label={labels.dataQuery}>
        <EntryButton
          active={mode === 'data'}
          tone={mode === 'data' ? 'blue' : 'neutral'}
          emphasize={mode === 'data' ? 'blue' : undefined}
          label={labels.dataQuery}
          title={labels.dataQuery}
          onClick={() => onModeChange('data')}
        >
          <GlyphData />
        </EntryButton>
        <EntryButton
          active={mode === 'stats'}
          tone={mode === 'stats' ? 'blue' : 'neutral'}
          emphasize={mode === 'stats' ? 'blue' : undefined}
          label={labels.statsQuery}
          title={labels.statsQuery}
          onClick={() => onModeChange('stats')}
        >
          <GlyphStats />
        </EntryButton>
      </Group>

      <Divider />

      <Group label={labels.database}>
        <span className={styles.sqlDbShell} title={labels.database}>
          <MicroIcon tone="ink" size={13}>
            <GlyphDb />
          </MicroIcon>
          <select
            className={styles.sqlSelect}
            value={databaseId}
            onChange={(event) => onDatabaseChange(event.target.value)}
            aria-label={labels.database}
          >
            {databases.map((db) => (
              <option key={db.id} value={db.id} disabled={!db.available}>
                {db.label}
                {!db.available ? ' (!)' : ''}
                {db.primary ? ' ★' : ''}
              </option>
            ))}
          </select>
        </span>
        <EntryButton
          title={labels.refreshSchema}
          onClick={onRefreshSchema}
          disabled={loading}
          spinning={loading}
        >
          <GlyphRefresh />
        </EntryButton>
      </Group>

      <Divider />

      <Group label={labels.run}>
        <EntryButton
          title={labels.run}
          label={labels.run}
          onClick={onRun}
          disabled={loading}
          spinning={loading}
          tone="green"
          emphasize="green"
        >
          {loading ? <GlyphSpinner /> : <GlyphRun />}
        </EntryButton>
        <EntryButton title={labels.format} onClick={onFormat}>
          <GlyphFormat />
        </EntryButton>
        <EntryButton title={labels.clear} onClick={onClear}>
          <GlyphClear />
        </EntryButton>
        <EntryButton title={labels.copy} onClick={onCopy}>
          <GlyphCopy />
        </EntryButton>
      </Group>

      <Divider />

      <Group label={labels.exportCsv}>
        <EntryButton
          title={labels.exportCsv}
          label={labels.exportCsv}
          onClick={onExport}
          disabled={!canExport}
          tone="red"
          emphasize="red"
        >
          <GlyphExport />
        </EntryButton>
      </Group>

      <div className={styles.sqlStatus}>
        <span className={statusTone}>{statusText}</span>
      </div>
    </div>
  );
}
