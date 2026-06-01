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
import type { DebugDatabase, DebugMode } from './types';
import styles from './DebugPage.module.scss';

type RunStatus = 'idle' | 'running' | 'ok' | 'error';

interface CapsuleToolbarProps {
  mode: DebugMode;
  onModeChange: (mode: DebugMode) => void;
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
    <div className={styles.floatGroup} role="group" aria-label={label}>
      {children}
    </div>
  );
}

function Divider() {
  return <span className={styles.floatDivider} aria-hidden="true" />;
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
  emphasize?: 'blue' | 'green' | 'red' | 'ink';
}) {
  const className = [
    styles.floatBtn,
    active ? styles.floatBtnActive : '',
    emphasize === 'blue' ? styles.floatBtnBlue : '',
    emphasize === 'green' ? styles.floatBtnGreen : '',
    emphasize === 'red' ? styles.floatBtnRed : '',
    emphasize === 'ink' ? styles.floatBtnInk : '',
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
      <MicroIcon tone={tone ?? 'neutral'} active={Boolean(active)} size={15} spinning={spinning}>
        {children}
      </MicroIcon>
      {label ? <span className={styles.floatBtnLabel}>{label}</span> : null}
    </button>
  );
}

export function CapsuleToolbar({
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
}: CapsuleToolbarProps) {
  const statusTone =
    status === 'ok'
      ? styles.statusOk
      : status === 'error'
        ? styles.statusErr
        : status === 'running'
          ? styles.statusRun
          : styles.statusIdle;

  return (
    <div className={styles.floatDock} role="toolbar" aria-label="debug capsule toolbar">
      <div className={styles.floatCapsule}>
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
          <span className={styles.floatDbShell} title={labels.database}>
            <MicroIcon tone="ink" size={14}>
              <GlyphDb />
            </MicroIcon>
            <select
              className={styles.floatSelect}
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
            tone="neutral"
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
          <EntryButton title={labels.format} onClick={onFormat} tone="neutral">
            <GlyphFormat />
          </EntryButton>
          <EntryButton title={labels.clear} onClick={onClear} tone="neutral">
            <GlyphClear />
          </EntryButton>
          <EntryButton title={labels.copy} onClick={onCopy} tone="neutral">
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

        <div className={styles.floatStatus}>
          <span className={statusTone}>{statusText}</span>
        </div>
      </div>
    </div>
  );
}
