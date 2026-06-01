import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { HeaderEntry } from '@/utils/headers';
import { IconPlus, IconTrash2 } from '@/external/features/serviceProviders/ui/icons';
import styles from './HeadersEditor.module.scss';

export interface HeaderPreset {
  id: string;
  label: string;
  userAgent: string;
  title?: string;
}

export interface HeadersEditorProps {
  entries: HeaderEntry[];
  onChange: (entries: HeaderEntry[]) => void;
  disabled?: boolean;
  presets?: HeaderPreset[];
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  keyLabel?: string;
  valueLabel?: string;
  showLabels?: boolean;
}

const emptyHeader = (): HeaderEntry => ({ key: '', value: '' });

export function applyUserAgentPreset(
  entries: HeaderEntry[],
  userAgent: string
): HeaderEntry[] {
  const headers = entries.length ? [...entries] : [emptyHeader()];
  const existingIdx = headers.findIndex((h) => h.key.trim().toLowerCase() === 'user-agent');
  if (existingIdx >= 0) {
    headers[existingIdx] = { key: 'User-Agent', value: userAgent };
    return headers;
  }
  const emptyIdx = headers.findIndex((h) => !h.key.trim() && !h.value.trim());
  if (emptyIdx >= 0) {
    headers[emptyIdx] = { key: 'User-Agent', value: userAgent };
    return headers;
  }
  return [...headers, { key: 'User-Agent', value: userAgent }];
}

export function HeadersEditor({
  entries,
  onChange,
  disabled = false,
  presets = [],
  keyPlaceholder = 'X-Custom-Header',
  valuePlaceholder = 'value',
  addLabel,
  keyLabel = 'Key',
  valueLabel = 'Value',
  showLabels = true,
}: HeadersEditorProps) {
  const { t } = useTranslation();
  const currentEntries = useMemo(
    () => (entries.length ? entries : [emptyHeader()]),
    [entries]
  );

  const updateEntry = (index: number, patch: Partial<HeaderEntry>) => {
    onChange(currentEntries.map((entry, idx) => (idx === index ? { ...entry, ...patch } : entry)));
  };

  const addEntry = () => {
    onChange([...currentEntries, emptyHeader()]);
  };

  const removeEntry = (index: number) => {
    const next = currentEntries.filter((_, idx) => idx !== index);
    onChange(next.length ? next : [emptyHeader()]);
  };

  return (
    <div className={styles.entriesList}>
      {currentEntries.map((header, idx) => (
        <div key={idx} className={styles.fieldRow}>
          <div className={styles.field}>
            {showLabels ? <label className={styles.label}>{keyLabel}</label> : null}
            <input
              className={styles.input}
              value={header.key}
              onChange={(e) => updateEntry(idx, { key: e.target.value })}
              placeholder={keyPlaceholder}
              disabled={disabled}
            />
          </div>
          <div className={styles.field}>
            {showLabels ? <label className={styles.label}>{valueLabel}</label> : null}
            <input
              className={styles.input}
              value={header.value}
              onChange={(e) => updateEntry(idx, { value: e.target.value })}
              placeholder={valuePlaceholder}
              disabled={disabled}
            />
          </div>
          <button
            type="button"
            className={styles.removeBtn}
            disabled={disabled || currentEntries.length <= 1}
            onClick={() => removeEntry(idx)}
            aria-label={`Remove header #${idx + 1}`}
          >
            <IconTrash2 size={12} />
          </button>
        </div>
      ))}
      <div className={styles.addBtnRow}>
        <button type="button" className={styles.addBtn} onClick={addEntry} disabled={disabled}>
          <IconPlus size={12} /> {addLabel || t('providersPage.form.addHeader', 'Add header')}
        </button>
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={styles.presetBtn}
            onClick={() => onChange(applyUserAgentPreset(currentEntries, preset.userAgent))}
            disabled={disabled || !preset.userAgent.trim()}
            title={preset.title || `User-Agent: ${preset.userAgent}`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
