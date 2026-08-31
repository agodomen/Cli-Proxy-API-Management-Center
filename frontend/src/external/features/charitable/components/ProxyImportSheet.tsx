import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { Sheet } from '../../serviceProviders/ui/Sheet';
import { importProxies } from '../api';
import type { ProxyPrivacy } from '../proxyInfo';
import styles from '../CharitablePage.module.scss';

interface ProxyImportSheetProps {
  open: boolean;
  baseUrl: string;
  managementKey?: string;
  onClose: () => void;
  onImported: () => void | Promise<void>;
}

export function ProxyImportSheet({
  open,
  baseUrl,
  managementKey,
  onClose,
  onImported,
}: ProxyImportSheetProps) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [content, setContent] = useState('');
  const [privacy, setPrivacy] = useState<ProxyPrivacy>('public');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    try {
      const result = await importProxies(baseUrl, content, privacy, managementKey);
      showNotification(
        t('charitable.proxy.import.summary', {
          created: result.created,
          skipped: result.skipped,
          failed: result.failed,
        }),
        result.failed > 0 ? 'warning' : 'success',
      );
      if (result.created > 0) {
        setContent('');
        await onImported();
      }
      onClose();
    } catch {
      showNotification(t('charitable.proxy.import.failed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('charitable.proxy.import.title')}
      description={t('charitable.proxy.import.description')}
      size="lg"
      footer={(
        <>
          <button
            type="submit"
            form="proxy-import-form"
            className={styles.btnPrimary}
            disabled={submitting || !content.trim()}
          >
            {submitting ? t('charitable.proxy.import.importing') : t('charitable.proxy.import.submit')}
          </button>
          <button type="button" className={styles.btnGhost} onClick={onClose} disabled={submitting}>
            {t('charitable.cancel')}
          </button>
        </>
      )}
    >
      <form id="proxy-import-form" className={styles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.proxy.import.privacy')}</label>
          <div className={styles.proxyPrivacyGroup} role="radiogroup">
            {(['local', 'public', 'personal'] as ProxyPrivacy[]).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={privacy === value}
                className={`${styles.proxyPrivacyOption} ${privacy === value ? styles.proxyPrivacyOptionActive : ''}`}
                onClick={() => setPrivacy(value)}
              >
                {t(`charitable.proxy.privacy.${value}`)}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.proxy.import.content')}</label>
          <textarea
            className={styles.textarea}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t('charitable.proxy.import.placeholder')}
            rows={18}
            spellCheck={false}
          />
          <span className={styles.fieldHint}>{t('charitable.proxy.import.hint')}</span>
        </div>
      </form>
    </Sheet>
  );
}
