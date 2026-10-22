export interface DatasetRef {
  projectId: string;
  datasetId: string;
}

export interface TableRef extends DatasetRef {
  tableId: string;
}

export interface Dataset extends DatasetRef {
  location: string | null;
  description: string | null;
}

export type TableType = 'TABLE' | 'VIEW' | 'MATERIALIZED_VIEW' | 'EXTERNAL' | 'SNAPSHOT';

export interface Field {
  name: string;
  type: string;
  mode: 'NULLABLE' | 'REQUIRED' | 'REPEATED';
  description: string | null;
  fields: Field[];
}

export interface TableSummary extends TableRef {
  type: TableType;
}

export interface Table extends TableSummary {
  description: string | null;
  rowCount: number | null;
  schema: Field[];
  // SQL of a view, null for tables.
  viewQuery: string | null;
}

export type Row = Record<string, unknown>;

export interface QueryResult {
  schema: Field[];
  rows: Row[];
  totalRows: number;
  bytesProcessed: number;
  cacheHit: boolean;
  // More rows exist than were returned.
  truncated: boolean;
}

export interface QueryRequest {
  projectId: string;
  sql: string;
  location: string;
  maxRows: number;
  maxBytesBilled: number;
  // Validates the query and estimates bytes without running it.
  dryRun?: boolean;
  // Named STRING query parameters (@name in the SQL).
  parameters?: Record<string, string>;
}

export interface ViewRequest extends TableRef {
  sql: string;
  description?: string;
  location: string;
}
