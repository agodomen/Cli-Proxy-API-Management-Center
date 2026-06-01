import styles from './DebugPage.module.scss';

interface SqlEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  placeholder?: string;
}

export function SqlEditor({ label, value, onChange, onRun, placeholder }: SqlEditorProps) {
  return (
    <div className={styles.editorPane}>
      <div className={styles.editorHeader}>
        <span>{label}</span>
        <span>Ctrl/⌘ + Enter</span>
      </div>
      <textarea
        className={styles.editor}
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            onRun();
          }
        }}
      />
    </div>
  );
}
