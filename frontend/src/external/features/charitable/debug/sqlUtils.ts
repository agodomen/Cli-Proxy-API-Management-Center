const WRITE_HEAD =
  /^(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM|REINDEX|ANALYZE|TRUNCATE|ATTACH|DETACH)\b/i;
const READ_HEAD = /^(SELECT|WITH|VALUES|EXPLAIN|PRAGMA)\b/i;

/** Strip simple SQL comments for classification (not a full parser). */
export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim();
}

export function isWriteSql(sql: string): boolean {
  const stripped = stripSqlComments(sql);
  if (!stripped) return false;
  const head = stripped.replace(/^\(+/, '').trim();
  if (READ_HEAD.test(head)) {
    // mutating pragmas treated as write on frontend too
    if (/^PRAGMA\b/i.test(head)) {
      return /WRITABLE_SCHEMA|JOURNAL_MODE|USER_VERSION|APPLICATION_ID|SCHEMA_VERSION|WAL_CHECKPOINT|OPTIMIZE/i.test(
        head
      );
    }
    return false;
  }
  return WRITE_HEAD.test(head);
}

export function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

export function buildSelectSql(table: string, limit = 100): string {
  return `SELECT *\nFROM ${quoteIdent(table)}\nLIMIT ${limit};`;
}

export function buildCountSql(table: string): string {
  return `SELECT COUNT(*) AS n\nFROM ${quoteIdent(table)};`;
}

export function buildInsertColumn(column: string): string {
  return quoteIdent(column);
}

/** Very light pretty-print: normalize whitespace around keywords-ish blocks. */
export function formatSqlLoose(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ');
}

export function rowsToCsv(columns: string[], rows: unknown[][]): string {
  const escape = (value: unknown) => {
    if (value == null) return '';
    const text = String(value);
    if (/[",\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  const lines = [columns.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map(escape).join(','));
  }
  return lines.join('\n');
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type StatsTemplateId =
  | 'table_counts'
  | 'usage_by_model'
  | 'usage_by_provider'
  | 'keys_status'
  | 'recent_usage';

export interface StatsTemplate {
  id: StatsTemplateId;
  sql: string;
}

export const STATS_TEMPLATES: StatsTemplate[] = [
  {
    id: 'table_counts',
    // Placeholder — DebugPage rewrites this with buildTableCountsSql(tables).
    sql: `SELECT name AS table_name
FROM sqlite_master
WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
ORDER BY name;`,
  },
  {
    id: 'usage_by_model',
    sql: `SELECT model,
       COUNT(*) AS requests,
       SUM(total_tokens) AS total_tokens,
       SUM(failed) AS failed
FROM usage_events
GROUP BY model
ORDER BY requests DESC
LIMIT 50;`,
  },
  {
    id: 'usage_by_provider',
    sql: `SELECT COALESCE(provider, '(null)') AS provider,
       COUNT(*) AS requests,
       SUM(total_tokens) AS total_tokens
FROM usage_events
GROUP BY provider
ORDER BY requests DESC
LIMIT 50;`,
  },
  {
    id: 'keys_status',
    sql: `SELECT status, COUNT(*) AS n
FROM cpa_auth_detail
GROUP BY status
ORDER BY n DESC;`,
  },
  {
    id: 'recent_usage',
    sql: `SELECT id, timestamp, provider, model, total_tokens, failed, path
FROM usage_events
ORDER BY timestamp_ms DESC
LIMIT 100;`,
  },
];

/** Better table_counts SQL generated from known table names. */
export function buildTableCountsSql(tables: string[]): string {
  if (!tables.length) {
    return `SELECT name AS table_name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`;
  }
  const parts = tables.map(
    (name, index) =>
      `SELECT ${index === 0 ? '' : ''}${JSON.stringify(name)} AS table_name, (SELECT COUNT(*) FROM ${quoteIdent(name)}) AS n`
  );
  return `${parts.join('\nUNION ALL\n')}\nORDER BY n DESC;`;
}
