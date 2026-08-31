import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { Sheet } from '../../serviceProviders/ui/Sheet';
import { batchDeleteProxiesByURLs } from '../api';
import styles from '../CharitablePage.module.scss';

interface ProxyURLDeleteSheetProps {
  open: boolean;
  baseUrl: string;
  managementKey?: string;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}

function parseURLs(content: string) {
  return Array.from(new Set(content.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)));
}

export function ProxyURLDeleteSheet({
  open,
  baseUrl,
  managementKey,
  onClose,
  onDeleted,
}: ProxyURLDeleteSheetProps) {
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const urls = parseURLs(content);
    if (!baseUrl || urls.length === 0 || submitting) return;
    showConfirmation({
      title: t('charitable.proxy.deleteByURL.confirmTitle'),
      message: t('charitable.proxy.deleteByURL.confirmMessage', { count: urls.length }),
      confirmText: t('charitable.confirm'),
      cancelText: t('charitable.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setSubmitting(true);
        try {
          const result = await batchDeleteProxiesByURLs(baseUrl, content, managementKey);
          showNotification(t('charitable.proxy.deleteByURL.summary', {
            matched: result.matched,
            deleted: result.deleted,
            missing: result.missing.length,
          }), result.missing.length > 0 ? 'warning' : 'success');
          setContent('');
          onClose();
          await onDeleted();
        } catch {
          showNotification(t('charitable.proxy.deleteByURL.failed'), 'error');
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('charitable.proxy.deleteByURL.title')}
      description={t('charitable.proxy.deleteByURL.description')}
      size="lg"
      footer={(
        <>
          <button type="submit" form="proxy-url-delete-form" className={styles.btnDanger} disabled={submitting || parseURLs(content).length === 0}>
            {t('charitable.proxy.deleteByURL.submit')}
          </button>
          <button type="button" className={styles.btnGhost} onClick={onClose} disabled={submitting}>
            {t('charitable.cancel')}
          </button>
        </>
      )}
    >
      <form id="proxy-url-delete-form" className={styles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.proxy.deleteByURL.content')}</label>
          <textarea
            className={styles.textarea}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t('charitable.proxy.deleteByURL.placeholder')}
            rows={18}
            spellCheck={false}
          />
          <span className={styles.fieldHint}>{t('charitable.proxy.deleteByURL.hint')}</span>
        </div>
      </form>
    </Sheet>
  );
}
