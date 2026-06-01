import { Modal } from '@/components/ui/Modal';
import styles from './DebugPage.module.scss';

interface WriteConfirmModalProps {
  open: boolean;
  sql: string;
  onClose: () => void;
  onConfirm: () => void;
  labels: {
    title: string;
    hint: string;
    cancel: string;
    confirm: string;
  };
}

export function WriteConfirmModal({ open, sql, onClose, onConfirm, labels }: WriteConfirmModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={labels.title}
      width={560}
      footer={
        <div className={styles.footerActions}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            {labels.cancel}
          </button>
          <button type="button" className={styles.btnDanger} onClick={onConfirm}>
            {labels.confirm}
          </button>
        </div>
      }
    >
      <pre className={styles.writePreview}>{sql}</pre>
      <p className={styles.writeHint}>{labels.hint}</p>
    </Modal>
  );
}
