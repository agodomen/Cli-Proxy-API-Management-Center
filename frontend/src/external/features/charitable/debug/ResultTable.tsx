import styles from './DebugPage.module.scss';
import type { QueryResponse } from './types';

interface ResultTableProps {
  result: QueryResponse | null;
  error: string | null;
  emptyText: string;
  labels: {
    result: string;
    rows: string;
    affected: string;
    duration: string;
    truncated: string;
    execOk: string;
  };
}

export function ResultTable({ result, error, emptyText, labels }: ResultTableProps) {
  return (
    <div className={styles.resultPane}>
      <div className={styles.resultHeader}>
        <strong>{labels.result}</strong>
        {result ? (
          <div className={styles.resultMeta}>
            {result.kind === 'exec' ? (
              <span>
                {labels.affected}: {result.rowsAffected ?? 0}
              </span>
            ) : (
              <span>
                {labels.rows}: {result.rowCount}
              </span>
            )}
            <span>
              {labels.duration}: {result.durationMs}ms
            </span>
            {result.truncated ? <span>{labels.truncated}</span> : null}
          </div>
        ) : null}
      </div>

      {error ? <div className={styles.errorBox}>{error}</div> : null}

      {!error && !result ? <div className={styles.emptyState}>{emptyText}</div> : null}

      {!error && result?.kind === 'exec' ? (
        <div className={styles.emptyState}>{labels.execOk}</div>
      ) : null}

      {!error && result?.kind === 'query' ? (
        <div className={styles.resultBody}>
          {(result.rows?.length ?? 0) === 0 ? (
            <div className={styles.emptyState}>{emptyText}</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  {(result.columns ?? []).map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(result.rows ?? []).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} title={cell == null ? 'NULL' : String(cell)}>
                        {cell == null ? <span className={styles.nullCell}>NULL</span> : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </div>
  );
}
