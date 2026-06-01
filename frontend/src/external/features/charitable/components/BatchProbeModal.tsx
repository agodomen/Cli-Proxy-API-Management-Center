import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  BatchProbeProgress,
  ProbeAutoActionMode,
  ProbeStrategy,
} from '../keyProbeService';
import { FOCUSABLE_SELECTOR, lockScroll, unlockScroll } from '../../serviceProviders/ui/scrollLock';
import styles from '../CharitablePage.module.scss';

export interface BatchProbeModalProps {
  open: boolean;
  running: boolean;
  targetCount: number;
  concurrency: number;
  strategy: ProbeStrategy;
  timeoutMs: number;
  userAgent: string;
  autoAction: ProbeAutoActionMode;
  progress: BatchProbeProgress | null;
  onConcurrencyChange: (value: number) => void;
  onStrategyChange: (value: ProbeStrategy) => void;
  onTimeoutMsChange: (value: number) => void;
  onUserAgentChange: (value: string) => void;
  onAutoActionChange: (value: ProbeAutoActionMode) => void;
  onStart: () => void;
  onCancel: () => void;
  onClose: () => void;
  labels: {
    title: string;
    targetCount: string;
    concurrency: string;
    concurrencyCustom?: string;
    concurrencyHint?: string;
    strategy: string;
    strategyHint: string;
    strategyOptions: Record<ProbeStrategy, string>;
    timeout: string;
    timeoutHint: string;
    userAgent: string;
    userAgentHint: string;
    userAgentPlaceholder: string;
    userAgentDefault?: string;
    userAgentCustom?: string;
    userAgentPresets?: Array<{ id: string; label: string; value: string }>;
    autoAction: string;
    autoActionHint: string;
    autoActionOptions: Record<ProbeAutoActionMode, string>;
    start: string;
    cancel: string;
    close: string;
    preparing: string;
    probing: string;
    persisting: string;
    done: string;
    cancelled: string;
    current: string;
    summary: string;
    log: string;
    emptyLog: string;
    autoScroll: string;
  };
}

const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 64;
const CLOSE_ANIMATION_DURATION = 280;

function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) return MIN_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.trunc(value)));
}

export function BatchProbeModal(props: BatchProbeModalProps) {
  const {
    open, running, targetCount, concurrency, strategy, timeoutMs, userAgent, autoAction, progress,
    onConcurrencyChange, onStrategyChange, onTimeoutMsChange, onUserAgentChange, onAutoActionChange,
    onStart, onCancel, onClose, labels,
  } = props;

  const titleId = useId();
  const logRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const phaseText = useMemo(() => {
    const phase = progress?.phase;
    if (phase === 'preparing') return labels.preparing;
    if (phase === 'probing') return labels.probing;
    if (phase === 'persisting') return labels.persisting;
    if (phase === 'cancelled') return labels.cancelled;
    if (phase === 'done') return labels.done;
    return labels.preparing;
  }, [labels, progress?.phase]);

  const ratio = progress && progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;
  const userAgentPresets = labels.userAgentPresets || [];
  const matchedPreset = userAgentPresets.find((item) => item.value === userAgent);
  const userAgentSelectValue = !userAgent ? '' : matchedPreset ? matchedPreset.value : '__custom__';

  useEffect(() => {
    if (!autoScroll || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [autoScroll, progress?.logs.length, progress?.currentName]);

  const getFocusables = () => {
    if (!panelRef.current) return [] as HTMLElement[];
    return Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1
    );
  };

  const startClose = (notifyParent: boolean) => {
    if (closeTimerRef.current !== null) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setIsVisible(false);
      setIsClosing(false);
      closeTimerRef.current = null;
      if (notifyParent) onClose();
    }, CLOSE_ANIMATION_DURATION);
  };

  useEffect(() => {
    let cancelled = false;
    if (open) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      queueMicrotask(() => {
        if (!cancelled) {
          setIsVisible(true);
          setIsClosing(false);
        }
      });
    } else if (isVisible) {
      queueMicrotask(() => {
        if (!cancelled) startClose(false);
      });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const shouldLockScroll = open || isVisible;
  useEffect(() => {
    if (!shouldLockScroll) return;
    lockScroll();
    return () => unlockScroll();
  }, [shouldLockScroll]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      const first = getFocusables()[0];
      (first ?? closeBtnRef.current ?? panelRef.current)?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open || isVisible) return;
    previouslyFocusedRef.current?.focus();
    previouslyFocusedRef.current = null;
  }, [isVisible, open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (running) onCancel();
        else startClose(true);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = getFocusables();
      if (focusables.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === firstEl || active === panelRef.current) {
          event.preventDefault();
          lastEl.focus();
        }
        return;
      }
      if (active === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, running, onCancel]);

  if (!open && !isVisible) return null;

  const stateClass = isClosing ? styles.batchProbeDrawerExiting : isVisible ? styles.batchProbeDrawerEntering : '';
  const finished = Boolean(progress && (progress.phase === 'done' || progress.phase === 'cancelled'));
  const footer = running ? (
    <button type="button" className={styles.btnSecondary} onClick={onCancel}>{labels.cancel}</button>
  ) : finished ? (
    <button type="button" className={styles.btnPrimary} onClick={() => startClose(true)}>{labels.close}</button>
  ) : (
    <>
      <button type="button" className={styles.btnSecondary} onClick={() => startClose(true)}>{labels.close}</button>
      <button type="button" className={styles.btnPrimary} onClick={onStart} disabled={targetCount <= 0}>{labels.start}</button>
    </>
  );

  const content = (
    <div className={`${styles.batchProbeDrawerOverlay} ${stateClass}`.trim()} role="presentation" onMouseDown={(event) => {
      if (running) return;
      if (event.target === event.currentTarget) startClose(true);
    }}>
      <div ref={panelRef} className={`${styles.batchProbeDrawer} ${styles.batchProbeDrawerWide} ${stateClass}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.batchProbeDrawerHandle} aria-hidden />
        <div className={styles.batchProbeDrawerHeader}>
          <h2 id={titleId} className={styles.batchProbeDrawerTitle}>{labels.title}</h2>
          <button ref={closeBtnRef} type="button" className={styles.batchProbeDrawerClose} onClick={running ? onCancel : () => startClose(true)} aria-label={running ? labels.cancel : labels.close}>×</button>
        </div>
        <div className={styles.batchProbeDrawerBody}>
          <div className={styles.batchProbeModal}>
            <div className={styles.batchProbeControls}>
              <div className={styles.batchProbeField}>
                <label>{labels.targetCount}</label>
                <div className={styles.batchProbeValue}>{targetCount}</div>
              </div>
              <div className={styles.batchProbeField}>
                <label htmlFor="batch-probe-concurrency">{labels.concurrency}</label>
                <input id="batch-probe-concurrency" type="number" min={MIN_CONCURRENCY} max={MAX_CONCURRENCY} step={1} className={styles.input} value={concurrency} disabled={running} onChange={(event) => onConcurrencyChange(clampConcurrency(Number(event.target.value)))} />
              </div>
              <div className={styles.batchProbeField}>
                <label htmlFor="batch-probe-timeout">{labels.timeout}</label>
                <input id="batch-probe-timeout" type="number" min={0} step={1000} className={styles.input} value={timeoutMs} disabled={running} onChange={(event) => {
                  const next = Number(event.target.value);
                  onTimeoutMsChange(Number.isFinite(next) ? Math.max(0, Math.trunc(next)) : 0);
                }} />
                <div className={styles.batchProbeFieldHint}>{labels.timeoutHint}</div>
              </div>
              <div className={styles.batchProbeField}>
                <label htmlFor="batch-probe-strategy">{labels.strategy}</label>
                <select id="batch-probe-strategy" className={styles.filterSelect} value={strategy} disabled={running} onChange={(event) => onStrategyChange(event.target.value as ProbeStrategy)}>
                  {(Object.keys(labels.strategyOptions) as ProbeStrategy[]).map((key) => (
                    <option key={key} value={key}>{labels.strategyOptions[key]}</option>
                  ))}
                </select>
                <div className={styles.batchProbeFieldHint}>{labels.strategyHint}</div>
              </div>
              <div className={styles.batchProbeField}>
                <label htmlFor="batch-probe-user-agent">{labels.userAgent}</label>
                <div className={styles.batchProbeUaRow}>
                  <select id="batch-probe-user-agent-preset" className={styles.filterSelect} disabled={running} value={userAgentSelectValue} onChange={(event) => {
                    const value = event.target.value;
                    if (value === '__custom__') return;
                    onUserAgentChange(value);
                  }}>
                    <option value="">{labels.userAgentDefault || 'Default'}</option>
                    {userAgentPresets.map((item) => (
                      <option key={item.id} value={item.value}>{item.label}</option>
                    ))}
                    <option value="__custom__">{labels.userAgentCustom || 'Custom'}</option>
                  </select>
                  <input id="batch-probe-user-agent" type="text" className={styles.input} value={userAgent} disabled={running} placeholder={labels.userAgentPlaceholder} onChange={(event) => onUserAgentChange(event.target.value)} />
                </div>
                <div className={styles.batchProbeFieldHint}>{labels.userAgentHint}</div>
              </div>
              <div className={`${styles.batchProbeField} ${styles.batchProbeFieldWide}`}>
                <label htmlFor="batch-probe-auto-action">{labels.autoAction}</label>
                <select id="batch-probe-auto-action" className={styles.filterSelect} value={autoAction} disabled={running} onChange={(event) => onAutoActionChange(event.target.value as ProbeAutoActionMode)}>
                  {(Object.keys(labels.autoActionOptions) as ProbeAutoActionMode[]).map((key) => (
                    <option key={key} value={key}>{labels.autoActionOptions[key]}</option>
                  ))}
                </select>
                <div className={styles.batchProbeFieldHint}>{labels.autoActionHint}</div>
              </div>
            </div>

            <div className={styles.syncProgress}>
              <div className={styles.syncProgressMeta}>
                <span>{phaseText}</span>
                <span>{progress?.current ?? 0} / {progress?.total ?? targetCount} ({ratio}%)</span>
              </div>
              <div className={styles.syncProgressBar} aria-hidden>
                <div className={styles.syncProgressFill} style={{ width: `${ratio}%` }} />
              </div>
              <div className={styles.syncProgressCurrent}>{labels.current}: {progress?.currentName || '—'}</div>
              <div className={styles.syncProgressSummary}>
                {labels.summary
                  .replace('{{success}}', String(progress?.success ?? 0))
                  .replace('{{failed}}', String(progress?.failed ?? 0))
                  .replace('{{skipped}}', String(progress?.skipped ?? 0))}
              </div>
            </div>

            <div className={styles.batchProbeLogHeader}>
              <span>{labels.log}</span>
              <label className={styles.batchProbeAutoScroll}>
                <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
                {labels.autoScroll}
              </label>
            </div>
            <div ref={logRef} className={styles.batchProbeLog} onScroll={(event) => {
              const el = event.currentTarget;
              const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              if (!nearBottom && autoScroll) setAutoScroll(false);
            }}>
              {(progress?.logs.length ?? 0) === 0 ? (
                <div className={styles.batchProbeLogEmpty}>{labels.emptyLog}</div>
              ) : (
                progress?.logs.map((item, index) => (
                  <div key={`${item.keyId}-${index}`} className={`${styles.batchProbeLogItem} ${styles[`batchProbeLog_${item.result}`] || ''}`}>
                    <strong>{item.name}</strong>
                    <span>
                      {item.result}
                      {item.statusCode ? ` · HTTP ${item.statusCode}` : ''}
                      {item.message ? ` · ${item.message}` : ''}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <div className={styles.batchProbeDrawerFooter}>{footer}</div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
}
