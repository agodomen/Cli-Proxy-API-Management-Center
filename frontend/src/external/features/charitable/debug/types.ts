/** Top-level floating dock entry. */
export type DebugWorkspace = 'sql' | 'api' | 'key';

/** SQL workspace sub-mode. */
export type SqlMode = 'data' | 'stats';

/** @deprecated use SqlMode */
export type DebugMode = SqlMode;

export interface DebugDatabase {
  id: string;
  label: string;
  path: string;
  basename: string;
  primary: boolean;
  available: boolean;
  writable: boolean;
  tableCount: number;
  error?: string;
}

export interface SchemaColumn {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  default?: unknown;
}

export interface SchemaTable {
  name: string;
  type: 'table' | 'view' | string;
  columns: SchemaColumn[];
}

export interface SchemaResponse {
  databaseId: string;
  tables: SchemaTable[];
}

export interface QueryRequest {
  databaseId: string;
  sql: string;
  confirmWrite?: boolean;
  maxRows?: number;
}

export interface QueryResponse {
  databaseId: string;
  sql: string;
  kind: 'query' | 'exec' | string;
  columns?: string[];
  rows?: unknown[][];
  rowCount: number;
  truncated: boolean;
  rowsAffected?: number;
  durationMs: number;
  warnings?: string[];
}

export interface QueryErrorBody {
  error?: string;
  code?: string;
}

export interface HistoryItem {
  id: string;
  sql: string;
  databaseId: string;
  mode: DebugMode;
  at: number;
  ok: boolean;
}
