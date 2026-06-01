/**
 * Standalone model discovery panel — extracted from BaseProviderForm so both
 * ServiceProvidersPage and KeysPage (probe) can share it.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconLoader2, IconRefreshCw, IconSearch } from './icons';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import type { ModelInfo } from '@/utils/models';
import styles from './ModelDiscoveryPanel.module.scss';

export interface ModelDiscoveryPanelProps {
  loading: boolean;
  models: ModelInfo[];
  hasFetched: boolean;
  existingNames: Set<string>;
  mutating?: boolean;
  onApply: (picked: ModelInfo[]) => void;
  onReload: () => void;
  onClose: () => void;
}

export function ModelDiscoveryPanel({
  loading,
  models,
  hasFetched,
  existingNames,
  mutating,
  onApply,
  onReload,
  onClose,
}: ModelDiscoveryPanelProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.alias ?? '').toLowerCase().includes(q)
    );
  }, [models, search]);

  const selectable = useMemo(
    () => filtered.filter((m) => !existingNames.has(m.name)),
    [filtered, existingNames]
  );

  const allSelectableChecked =
    selectable.length > 0 && selectable.every((m) => selected.has(m.name));

  // Sync selection when models change (e.g. after fetch).
  useMemo(() => {
    setSelected((prev) => {
      const next = new Set<string>();
      prev.forEach((name) => {
        if (models.some((m) => m.name === name) && !existingNames.has(name)) {
          next.add(name);
        }
      });
      return next;
    });
  }, [models, existingNames]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelectableChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectable.map((m) => m.name)));
    }
  };

  const handleApply = () => {
    const picked = models.filter((m) => selected.has(m.name) && !existingNames.has(m.name));
    if (!picked.length) return;
    onApply(picked);
    setSelected(new Set());
  };

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon} aria-hidden="true">
            <IconSearch size={14} />
          </span>
          <input
            type="search"
            className={styles.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('providersPage.discovery.searchPlaceholder')}
          />
        </div>
        <button
          type="button"
          className={styles.reloadBtn}
          onClick={onReload}
          disabled={loading}
          aria-label={t('providersPage.discovery.reload')}
        >
          {loading ? <IconLoader2 size={14} /> : <IconRefreshCw size={14} />}
          <span>{t('providersPage.discovery.reload')}</span>
        </button>
      </div>

      {loading && !models.length ? (
        <div className={styles.empty}>{t('providersPage.discovery.loading')}</div>
      ) : hasFetched && !models.length ? (
        <div className={styles.empty}>{t('providersPage.discovery.empty')}</div>
      ) : models.length ? (
        <>
          <div className={styles.batchRow}>
            <SelectionCheckbox
              checked={allSelectableChecked}
              onChange={toggleAll}
              disabled={selectable.length === 0}
              label={
                <span className={styles.batchLabel}>
                  {allSelectableChecked
                    ? t('providersPage.discovery.clearAll')
                    : t('providersPage.discovery.selectAll')}
                </span>
              }
            />
            <span className={styles.count}>
              {t('providersPage.discovery.selectedCount', {
                selected: selected.size,
                total: selectable.length,
              })}
            </span>
          </div>
          <ul className={styles.list}>
            {filtered.map((m) => {
              const existing = existingNames.has(m.name);
              return (
                <li
                  key={m.name}
                  className={
                    existing ? `${styles.item} ${styles.itemExisting}` : styles.item
                  }
                >
                  {existing ? (
                    <>
                      <span className={styles.name}>{m.name}</span>
                      <span className={styles.existingTag}>
                        {t('providersPage.discovery.alreadyAdded')}
                      </span>
                    </>
                  ) : (
                    <SelectionCheckbox
                      checked={selected.has(m.name)}
                      onChange={() => toggle(m.name)}
                      label={<span className={styles.name}>{m.name}</span>}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className={styles.empty}>{t('providersPage.discovery.notLoaded')}</div>
      )}

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          disabled={mutating}
        >
          {t('providersPage.discovery.close')}
        </button>
        <button
          type="button"
          className={styles.applyBtn}
          onClick={handleApply}
          disabled={mutating || selected.size === 0}
        >
          {t('providersPage.discovery.apply', { count: selected.size })}
        </button>
      </div>
    </div>
  );
}
