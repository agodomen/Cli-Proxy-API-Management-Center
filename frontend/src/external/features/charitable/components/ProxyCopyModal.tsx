import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { IconCopy, IconLoader2 } from '../../serviceProviders/ui/icons';
import { copyToClipboard } from '../../serviceProviders/utils/clipboard';
import {
  buildProxyCopyContent,
  isProxyCopyFormatAvailable,
  PROXY_COPY_FORMATS,
  type ProxyCopyFormat,
} from '../proxyCopy';
import styles from './ProxyCopyModal.module.scss';

interface ProxyCopyModalProps {
  open: boolean;
  values: string[];
  onClose: () => void;
}

const FORMAT_BADGES: Record<ProxyCopyFormat, string> = {
  uri: 'URI',
  linux: 'Linux',
  cmd: 'CMD',
  powershell: 'PS',
  fish: 'Fish',
  nushell: 'Nu',
};

export function ProxyCopyModal({ open, values, onClose }: ProxyCopyModalProps) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [copyingFormat, setCopyingFormat] = useState<ProxyCopyFormat | null>(null);
  const normalizedValues = useMemo(
    () => values.map((value) => value.trim()).filter(Boolean),
    [values],
  );

  const handleCopy = async (format: ProxyCopyFormat) => {
    if (copyingFormat || !isProxyCopyFormatAvailable(format, normalizedValues)) return;
    setCopyingFormat(format);
    let copied = false;
    try {
      copied = await copyToClipboard(buildProxyCopyContent(format, normalizedValues));
    } finally {
      setCopyingFormat(null);
      onClose();
    }
    showNotification(
      copied
        ? t('charitable.proxy.copyDialog.success', {
            type: t(`charitable.proxy.copyDialog.formats.${format}.title`),
          })
        : t('charitable.proxy.copyDialog.failed'),
      copied ? 'success' : 'error',
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('charitable.proxy.copyDialog.title')}
      width={720}
      className={styles.proxyCopyModal}
    >
      <div className={styles.content}>
        <div className={styles.intro}>
          <p>{t('charitable.proxy.copyDialog.description', { count: normalizedValues.length })}</p>
          {normalizedValues.length > 1 ? (
            <p className={styles.batchHint}>{t('charitable.proxy.copyDialog.batchHint')}</p>
          ) : null}
        </div>

        <div className={styles.optionGrid}>
          {PROXY_COPY_FORMATS.map((format) => {
            const available = isProxyCopyFormatAvailable(format, normalizedValues);
            const content = available ? buildProxyCopyContent(format, normalizedValues) : '';
            const preview = content.split(/\r?\n/, 1)[0];
            const copying = copyingFormat === format;
            return (
              <button
                key={format}
                type="button"
                className={styles.option}
                onClick={() => void handleCopy(format)}
                disabled={!available || copyingFormat !== null}
              >
                <span className={styles.optionBadge}>{FORMAT_BADGES[format]}</span>
                <span className={styles.optionBody}>
                  <span className={styles.optionTitle}>
                    {t(`charitable.proxy.copyDialog.formats.${format}.title`)}
                  </span>
                  <span className={styles.optionDescription}>
                    {available
                      ? t(`charitable.proxy.copyDialog.formats.${format}.description`)
                      : t('charitable.proxy.copyDialog.singleOnly')}
                  </span>
                  {preview ? <code className={styles.optionPreview}>{preview}</code> : null}
                </span>
                <span className={styles.optionAction} aria-hidden="true">
                  {copying ? <IconLoader2 className={styles.spinner} size={18} /> : <IconCopy size={18} />}
                </span>
              </button>
            );
          })}
        </div>

        <div className={styles.footer}>
          <span>{t('charitable.proxy.copyDialog.closeHint')}</span>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            {t('charitable.proxy.copyDialog.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
