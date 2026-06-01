import { useMemo, useState } from 'react';
import type { SchemaTable } from './types';
import styles from './DebugPage.module.scss';

interface SchemaBrowserProps {
  title: string;
  tables: SchemaTable[];
  selectedTable?: string;
  onSelectTable: (table: SchemaTable) => void;
  onInsertColumn: (table: string, column: string) => void;
  emptyText: string;
}

export function SchemaBrowser({
  title,
  tables,
  selectedTable,
  onSelectTable,
  onInsertColumn,
  emptyText,
}: SchemaBrowserProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const sorted = useMemo(
    () => [...tables].sort((a, b) => a.name.localeCompare(b.name)),
    [tables]
  );

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <span>{title}</span>
        <span>{sorted.length}</span>
      </div>
      <div className={styles.sidebarBody}>
        {!sorted.length ? <div className={styles.emptyState}>{emptyText}</div> : null}
        {sorted.map((table) => {
          const open = expanded[table.name] ?? table.name === selectedTable;
          const active = table.name === selectedTable;
          return (
            <div key={table.name} className={styles.tableItem}>
              <button
                type="button"
                className={active ? styles.tableBtnActive : styles.tableBtn}
                onClick={() => {
                  onSelectTable(table);
                  setExpanded((prev) => ({ ...prev, [table.name]: !open }));
                }}
              >
                <span>{table.name}</span>
                <span className={styles.tableBadge}>{table.type}</span>
              </button>
              {open ? (
                <div className={styles.columnList}>
                  {table.columns.map((col) => (
                    <button
                      key={`${table.name}.${col.name}`}
                      type="button"
                      className={styles.columnBtn}
                      onClick={() => onInsertColumn(table.name, col.name)}
                      title={col.type}
                    >
                      {col.name}
                      <span className={styles.columnType}>
                        {col.type || 'ANY'}
                        {col.primaryKey ? ' · PK' : ''}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
