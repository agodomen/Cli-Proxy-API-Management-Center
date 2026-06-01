import { GlyphApi, GlyphData, GlyphKey, MicroIcon } from './MicroIcon';
import type { DebugWorkspace } from './types';
import styles from './DebugPage.module.scss';

interface EntryDockProps {
  workspace: DebugWorkspace;
  onWorkspaceChange: (workspace: DebugWorkspace) => void;
  labels: {
    sql: string;
    api: string;
    key: string;
    toolbar: string;
  };
}

export function EntryDock({ workspace, onWorkspaceChange, labels }: EntryDockProps) {
  return (
    <div className={styles.floatDock} role="toolbar" aria-label={labels.toolbar}>
      <div className={styles.floatCapsule}>
        <div className={styles.floatGroup} role="group">
          <button
            type="button"
            className={[
              styles.floatBtn,
              workspace === 'sql' ? styles.floatBtnActive : '',
              workspace === 'sql' ? styles.floatBtnBlue : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-pressed={workspace === 'sql'}
            title={labels.sql}
            onClick={() => onWorkspaceChange('sql')}
          >
            <MicroIcon tone={workspace === 'sql' ? 'blue' : 'neutral'} active={workspace === 'sql'} size={15}>
              <GlyphData />
            </MicroIcon>
            <span className={styles.floatBtnLabel}>{labels.sql}</span>
          </button>

          <button
            type="button"
            className={[
              styles.floatBtn,
              workspace === 'api' ? styles.floatBtnActive : '',
              workspace === 'api' ? styles.floatBtnBlue : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-pressed={workspace === 'api'}
            title={labels.api}
            onClick={() => onWorkspaceChange('api')}
          >
            <MicroIcon tone={workspace === 'api' ? 'blue' : 'neutral'} active={workspace === 'api'} size={15}>
              <GlyphApi />
            </MicroIcon>
            <span className={styles.floatBtnLabel}>{labels.api}</span>
          </button>

          <button
            type="button"
            className={[
              styles.floatBtn,
              workspace === 'key' ? styles.floatBtnActive : '',
              workspace === 'key' ? styles.floatBtnBlue : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-pressed={workspace === 'key'}
            title={labels.key}
            onClick={() => onWorkspaceChange('key')}
          >
            <MicroIcon tone={workspace === 'key' ? 'blue' : 'neutral'} active={workspace === 'key'} size={15}>
              <GlyphKey />
            </MicroIcon>
            <span className={styles.floatBtnLabel}>{labels.key}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
