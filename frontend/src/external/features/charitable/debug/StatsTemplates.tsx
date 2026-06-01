import { STATS_TEMPLATES, type StatsTemplateId } from './sqlUtils';
import styles from './DebugPage.module.scss';

interface StatsTemplatesProps {
  activeId?: StatsTemplateId | null;
  onPick: (id: StatsTemplateId) => void;
  labels: Record<StatsTemplateId, string>;
}

export function StatsTemplates({ activeId, onPick, labels }: StatsTemplatesProps) {
  return (
    <div className={styles.statsStrip}>
      {STATS_TEMPLATES.map((item) => (
        <button
          key={item.id}
          type="button"
          className={activeId === item.id ? styles.statsChipActive : styles.statsChip}
          onClick={() => onPick(item.id)}
        >
          {labels[item.id]}
        </button>
      ))}
    </div>
  );
}
