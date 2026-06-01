import { Modal } from '@/components/ui/Modal';
import styles from '../CharitablePage.module.scss';

export interface TaskProgressView {
  phase: string;
  total: number;
  current: number;
  currentName: string;
  failures: Array<{ name: string; error: string }>;
  // sync fields
  created?: number;
  updated?: number;
  skipped?: number;
  unmatchedProvider?: number;
  providersCreated?: number;
  failed?: number;
  // push fields
  success?: number;
}

interface AuthFileSyncProgressModalProps {
  open: boolean;
  progress: TaskProgressView | null;
  onCancel: () => void;
  onClose: () => void;
  runningPhases?: string[];
  labels: {
    title: string;
    phase: (phase: string) => string;
    current: string;
    summary: string;
    cancel: string;
    close: string;
    failures: string;
    warnings?: string;
  };
}

function isWarningEntry(error: string) {
  const text = (error || '').toLowerCase();
  return text.startsWith('imported_without_provider') || text.includes('imported_without_provider');
}

export function AuthFileSyncProgressModal({
  open,
  progress,
  onCancel,
  onClose,
  runningPhases = ['listing', 'syncing', 'preparing', 'pushing'],
  labels,
}: AuthFileSyncProgressModalProps) {
  if (!progress) return null;

  const ratio = progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;
  const running = runningPhases.includes(progress.phase);
  const hardFailures = progress.failures.filter((item) => !isWarningEntry(item.error));
  const warnings = progress.failures.filter((item) => isWarningEntry(item.error));

  const summary = labels.summary
    .replace('{{created}}', String(progress.created ?? 0))
    .replace('{{updated}}', String(progress.updated ?? 0))
    .replace('{{failed}}', String(progress.failed ?? hardFailures.length))
    .replace('{{skipped}}', String(progress.skipped ?? 0))
    .replace('{{unmatched}}', String(progress.unmatchedProvider ?? 0))
    .replace('{{providers}}', String(progress.providersCreated ?? 0))
    .replace('{{success}}', String(progress.success ?? 0));

  return (
    <Modal
      open={open}
      title={labels.title}
      onClose={running ? onCancel : onClose}
      closeDisabled={running}
      width={640}
      footer={
        running ? (
          <button type="button" className={styles.btnSecondary} onClick={onCancel}>
            {labels.cancel}
          </button>
        ) : (
          <button type="button" className={styles.btnPrimary} onClick={onClose}>
            {labels.close}
          </button>
        )
      }
    >
      <div className={styles.syncProgress}>
        <div className={styles.syncProgressMeta}>
          <span>{labels.phase(progress.phase)}</span>
          <span>
            {progress.current} / {progress.total} ({ratio}%)
          </span>
        </div>
        <div className={styles.syncProgressBar} aria-hidden>
          <div className={styles.syncProgressFill} style={{ width: `${ratio}%` }} />
        </div>
        <div className={styles.syncProgressCurrent}>
          {labels.current}: {progress.currentName || '—'}
        </div>
        <div className={styles.syncProgressSummary}>{summary}</div>
        {hardFailures.length > 0 && (
          <div className={styles.syncProgressFailures}>
            <div className={styles.syncProgressFailuresTitle}>
              {labels.failures} ({hardFailures.length})
            </div>
            <ul>
              {hardFailures.map((item, index) => (
                <li key={`fail-${item.name}-${index}`}>
                  <strong>{item.name || '—'}</strong>
                  <span>{item.error}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className={`${styles.syncProgressFailures} ${styles.syncProgressWarnings}`}>
            <div className={styles.syncProgressFailuresTitle}>
              {(labels.warnings || labels.failures)} ({warnings.length})
            </div>
            <ul>
              {warnings.map((item, index) => (
                <li key={`warn-${item.name}-${index}`}>
                  <strong>{item.name || '—'}</strong>
                  <span>{item.error}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
