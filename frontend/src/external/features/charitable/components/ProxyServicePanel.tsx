import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/stores/useNotificationStore';
import {
  IconCheckCircle2,
  IconLoader2,
  IconRefreshCw,
  IconX,
} from '../../serviceProviders/ui/icons';
import {
  proxyServiceApi,
  type ProxyServiceConfig,
  type ProxyServiceResponse,
} from '@/external/services/api/proxyService';
import sharedStyles from '../CharitablePage.module.scss';
import styles from './ProxyServicePanel.module.scss';

interface ProxyServicePanelProps {
  baseUrl: string;
  managementKey?: string;
}

const ENCRYPTION_OPTIONS = [
  { value: 'none', key: 'none' },
  { value: 'aes-128-gcm', key: 'aes128gcm' },
  { value: 'aes-256-gcm', key: 'aes256gcm' },
  { value: 'chacha20-ietf-poly1305', key: 'chacha20' },
];

const PASSWORD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateRandomPassword(length = 24): string {
  const random = new Uint32Array(length);
  crypto.getRandomValues(random);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += PASSWORD_CHARS[random[i] % PASSWORD_CHARS.length];
  }
  return result;
}

export function ProxyServicePanel({ baseUrl: _baseUrl, managementKey: _managementKey }: ProxyServicePanelProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();

  const [data, setData] = useState<ProxyServiceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Form state
  const [listenAddr, setListenAddr] = useState('127.0.0.1');
  const [tcpPort, setTcpPort] = useState(0);
  const [udpPort, setUdpPort] = useState(0);
  const [password, setPassword] = useState('');
  const [encryption, setEncryption] = useState('none');
  const [autoRegister, setAutoRegister] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await proxyServiceApi.get();
      setData(resp);
      const cfg = resp.config;
      setListenAddr(cfg.listen_addr || '127.0.0.1');
      setTcpPort(cfg.tcp_port || 0);
      setUdpPort(cfg.udp_port || 0);
      setPassword(cfg.password || '');
      setEncryption(cfg.encryption_method || 'none');
      setAutoRegister(cfg.auto_register);
      setEnabled(cfg.enabled);
    } catch {
      showNotification(t('charitable.proxy.service.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification, t]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const handleSave = async () => {
    setActionLoading(true);
    try {
      const cfg: ProxyServiceConfig = {
        listen_addr: listenAddr.trim() || '127.0.0.1',
        tcp_port: tcpPort || 0,
        udp_port: udpPort || 0,
        password: password,
        encryption_method: encryption,
        auto_register: autoRegister,
        enabled,
      };
      const resp = await proxyServiceApi.update(cfg);
      setData(resp);
      showNotification(t('charitable.proxy.service.saveSuccess'), 'success');
    } catch {
      showNotification(t('charitable.proxy.service.saveFailed'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStart = async () => {
    setActionLoading(true);
    try {
      const resp = await proxyServiceApi.start();
      setData(resp);
      showNotification(t('charitable.proxy.service.startSuccess'), 'success');
    } catch {
      showNotification(t('charitable.proxy.service.startFailed'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    try {
      const resp = await proxyServiceApi.stop();
      setData(resp);
      showNotification(t('charitable.proxy.service.stopSuccess'), 'success');
    } catch {
      showNotification(t('charitable.proxy.service.stopFailed'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestart = async () => {
    setActionLoading(true);
    try {
      const resp = await proxyServiceApi.restart();
      setData(resp);
      showNotification(t('charitable.proxy.service.restartSuccess'), 'success');
    } catch {
      showNotification(t('charitable.proxy.service.restartFailed'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const status = data?.status;
  const isRunning = status?.running ?? false;

  return (
    <div className={styles.container}>
      {/* Status card */}
      <div className={`${styles.card} ${isRunning ? styles.cardRunning : styles.cardStopped}`}>
        <div className={styles.statusHeader}>
          <div className={styles.statusIcon}>
            {loading ? (
              <IconLoader2 size={20} className={styles.spin} />
            ) : isRunning ? (
              <IconCheckCircle2 size={20} />
            ) : (
              <IconX size={20} />
            )}
          </div>
          <div className={styles.statusInfo}>
            <span className={styles.statusLabel}>
              {isRunning
                ? t('charitable.proxy.service.statusRunning')
                : t('charitable.proxy.service.statusStopped')}
            </span>
            {status?.started_at && (
              <span className={styles.statusDetail}>
                {t('charitable.proxy.service.startedAt')}: {new Date(status.started_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className={styles.statusGrid}>
          <div className={styles.statusItem}>
            <span className={styles.statusItemLabel}>TCP</span>
            <span className={`${styles.statusBadge} ${status?.tcp?.running ? styles.badgeOk : styles.badgeErr}`}>
              {status?.tcp?.running ? t('charitable.proxy.service.componentRunning') : t('charitable.proxy.service.componentStopped')}
            </span>
            {status?.tcp?.error && (
              <span className={styles.statusError}>{status.tcp.error}</span>
            )}
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusItemLabel}>UDP</span>
            <span className={`${styles.statusBadge} ${status?.udp?.running ? styles.badgeOk : styles.badgeErr}`}>
              {status?.udp?.running ? t('charitable.proxy.service.componentRunning') : t('charitable.proxy.service.componentStopped')}
            </span>
            {status?.udp?.error && (
              <span className={styles.statusError}>{status.udp.error}</span>
            )}
          </div>
        </div>
        <div className={styles.actionRow}>
          <button
            className={sharedStyles.btnPrimary}
            onClick={() => void handleStart()}
            disabled={actionLoading || isRunning}
          >
            {actionLoading ? <IconLoader2 size={16} className={styles.spin} /> : <IconCheckCircle2 size={16} />}
            {t('charitable.proxy.service.start')}
          </button>
          <button
            className={sharedStyles.btnSecondary}
            onClick={() => void handleStop()}
            disabled={actionLoading || !isRunning}
          >
            {actionLoading ? <IconLoader2 size={16} className={styles.spin} /> : <IconX size={16} />}
            {t('charitable.proxy.service.stop')}
          </button>
          <button
            className={sharedStyles.btnSecondary}
            onClick={() => void handleRestart()}
            disabled={actionLoading || !isRunning}
          >
            {actionLoading ? <IconLoader2 size={16} className={styles.spin} /> : <IconRefreshCw size={16} />}
            {t('charitable.proxy.service.restart')}
          </button>
        </div>
      </div>

      {/* Config form */}
      <div className={styles.card}>
        <h3 className={styles.formTitle}>{t('charitable.proxy.service.configTitle')}</h3>
        <div className={styles.formGrid}>
          <label className={styles.formField}>
            <span className={styles.fieldLabel}>{t('charitable.proxy.service.listenAddr')}</span>
            <input
              className={styles.input}
              type="text"
              value={listenAddr}
              onChange={(e) => setListenAddr(e.target.value)}
              placeholder="127.0.0.1"
            />
            <span className={styles.fieldHint}>{t('charitable.proxy.service.listenAddrHint')}</span>
          </label>

          <label className={styles.formField}>
            <span className={styles.fieldLabel}>{t('charitable.proxy.service.tcpPort')}</span>
            <input
              className={styles.input}
              type="number"
              min={0}
              max={65535}
              value={tcpPort || ''}
              onChange={(e) => setTcpPort(Number(e.target.value) || 0)}
              placeholder="1080"
            />
          </label>

          <label className={styles.formField}>
            <span className={styles.fieldLabel}>{t('charitable.proxy.service.udpPort')}</span>
            <input
              className={styles.input}
              type="number"
              min={0}
              max={65535}
              value={udpPort || ''}
              onChange={(e) => setUdpPort(Number(e.target.value) || 0)}
              placeholder={t('charitable.proxy.service.udpPortPlaceholder')}
            />
            <span className={styles.fieldHint}>{t('charitable.proxy.service.udpPortHint')}</span>
          </label>

          <label className={styles.formField}>
            <span className={styles.fieldLabel}>{t('charitable.proxy.service.password')}</span>
            <div className={styles.passwordRow}>
              <input
                className={styles.input}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('charitable.proxy.service.passwordPlaceholder')}
              />
              <button
                type="button"
                className={styles.toggleBtn}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? t('charitable.proxy.service.hide') : t('charitable.proxy.service.show')}
              </button>
              <button
                type="button"
                className={styles.toggleBtn}
                onClick={() => {
                  setPassword(generateRandomPassword());
                  setShowPassword(true);
                }}
                title={t('charitable.proxy.service.generatePassword')}
              >
                <IconRefreshCw size={14} />
              </button>
            </div>
            <span className={styles.fieldHint}>{t('charitable.proxy.service.passwordHint')}</span>
          </label>

          <label className={styles.formField}>
            <span className={styles.fieldLabel}>{t('charitable.proxy.service.encryption')}</span>
            <select
              className={styles.select}
              value={encryption}
              onChange={(e) => setEncryption(e.target.value)}
            >
              {ENCRYPTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(`charitable.proxy.service.encryptionOptions.${opt.key}`)}
                </option>
              ))}
            </select>
            <span className={styles.fieldHint}>{t('charitable.proxy.service.encryptionHint')}</span>
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={autoRegister}
              onChange={(e) => setAutoRegister(e.target.checked)}
            />
            <span>{t('charitable.proxy.service.autoRegister')}</span>
            <span className={styles.fieldHint}>{t('charitable.proxy.service.autoRegisterHint')}</span>
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>{t('charitable.proxy.service.enabled')}</span>
            <span className={styles.fieldHint}>{t('charitable.proxy.service.enabledHint')}</span>
          </label>
        </div>

        <div className={styles.formActions}>
          <button
            className={sharedStyles.btnPrimary}
            onClick={() => void handleSave()}
            disabled={actionLoading || loading}
          >
            {actionLoading ? <IconLoader2 size={16} className={styles.spin} /> : null}
            {t('charitable.proxy.service.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
