import { DomainError } from '@/shared-kernel/errors/DomainError.js';

import { type BigQuerySource, describeSource } from './Report.js';

// Connectors a data source can come from. BigQuery sources carry no
// `connector` field, so every BigQuery call written before stays valid.
export const CONNECTORS = ['bigquery', 'google_sheets', 'postgresql', 'mysql'] as const;
export type Connector = (typeof CONNECTORS)[number];

export interface SheetsSource {
  connector: 'google_sheets';
  spreadsheetId: string;
  // Tab name, picked in the editor.
  worksheet?: string;
  // Tab id (the `gid` of its URL), which the Linking API needs.
  worksheetId?: string;
  hasHeader: boolean;
  includeHiddenAndFiltered: boolean;
  // A1 range such as A1:D20.
  range?: string;
  name?: string;
}

// PEM files on the local disk, uploaded to the connector's SSL settings.
export interface DatabaseSsl {
  serverCertificate?: string;
  clientCertificate?: string;
  clientKey?: string;
}

// Looker Studio's own PostgreSQL and MySQL connectors (Basic authentication).
// Exactly one of `table` and `sql`.
export interface DatabaseSource {
  connector: 'postgresql' | 'mysql';
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  ssl?: DatabaseSsl;
  table?: string;
  sql?: string;
  name?: string;
}

export type DataSource = BigQuerySource | SheetsSource | DatabaseSource;

export const CONNECTOR_LABEL: Record<Connector, string> = {
  bigquery: 'BigQuery',
  google_sheets: 'Google Sheets',
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
};

export class InvalidDataSourceError extends DomainError {
  readonly code = 'INVALID_DATA_SOURCE';
  constructor(readonly userMessage: string) {
    super(userMessage);
  }
}

export function connectorOf(source: DataSource): Connector {
  return 'connector' in source ? source.connector : 'bigquery';
}

export function isBigQuerySource(source: DataSource): source is BigQuerySource {
  return connectorOf(source) === 'bigquery';
}

export function isSheetsSource(source: DataSource): source is SheetsSource {
  return connectorOf(source) === 'google_sheets';
}

export function isDatabaseSource(source: DataSource): source is DatabaseSource {
  const c = connectorOf(source);
  return c === 'postgresql' || c === 'mysql';
}

// The name given to the data source, when there is one to set after connecting.
export function sourceName(source: DataSource): string | undefined {
  return 'name' in source ? source.name : undefined;
}

const SPREADSHEET_URL_RE = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/;
const SPREADSHEET_ID_RE = /^[A-Za-z0-9_-]{20,}$/;
const A1_RANGE_RE = /^[A-Za-z]{1,3}\d*(?::[A-Za-z]{1,3}\d*)?$/;

// Reads the spreadsheet id, and the tab id when the URL has one (#gid=123).
export function parseSpreadsheet(value: string): { spreadsheetId: string; worksheetId?: string } {
  const raw = value.trim();
  const fromUrl = SPREADSHEET_URL_RE.exec(raw)?.[1];
  const spreadsheetId = fromUrl ?? (SPREADSHEET_ID_RE.test(raw) ? raw : undefined);
  if (!spreadsheetId)
    throw new InvalidDataSourceError(
      `"${value}" is neither a Google Sheets URL nor a spreadsheet id.`,
    );
  const gid = fromUrl ? /[#?&]gid=(\d+)/.exec(raw)?.[1] : undefined;
  return { spreadsheetId, ...(gid ? { worksheetId: gid } : {}) };
}

export function validateSheetsSource(source: SheetsSource): SheetsSource {
  if (!source.worksheet?.trim() && !source.worksheetId)
    throw new InvalidDataSourceError(
      'A Google Sheets source needs worksheet (the tab name) or worksheet_id (its gid).',
    );
  if (source.worksheetId !== undefined && !/^\d+$/.test(source.worksheetId))
    throw new InvalidDataSourceError(
      `worksheet_id "${source.worksheetId}" is not a sheet gid (the number after #gid= in the URL).`,
    );
  if (source.range !== undefined && !A1_RANGE_RE.test(source.range.trim()))
    throw new InvalidDataSourceError(`range "${source.range}" is not an A1 range such as A1:D20.`);
  return source;
}

export function validateDatabaseSource(source: DatabaseSource): DatabaseSource {
  const label = CONNECTOR_LABEL[source.connector];
  for (const [field, value] of [
    ['host', source.host],
    ['database', source.database],
    ['user', source.user],
  ] as const) {
    if (!value?.trim()) throw new InvalidDataSourceError(`A ${label} source needs ${field}.`);
  }
  if (!source.password) throw new InvalidDataSourceError(`A ${label} source needs password.`);
  if (source.port !== undefined && !(Number.isInteger(source.port) && source.port > 0))
    throw new InvalidDataSourceError(`port ${source.port} is not a TCP port.`);
  if (!!source.table?.trim() === !!source.sql?.trim())
    throw new InvalidDataSourceError(
      `A ${label} source needs either table_id (a table) or sql (a custom query), not both.`,
    );
  const ssl = source.ssl;
  if (ssl && !!ssl.clientCertificate !== !!ssl.clientKey)
    throw new InvalidDataSourceError(
      'SSL client authentication needs both client_certificate and client_key.',
    );
  return source;
}

export function validateDataSource<T extends DataSource>(source: T): T {
  if (isSheetsSource(source)) validateSheetsSource(source);
  if (isDatabaseSource(source)) validateDatabaseSource(source);
  return source;
}

// Short label for logs, audit and tool replies. Never includes a password.
export function describeDataSource(source: DataSource): string {
  if (isSheetsSource(source)) {
    const tab = source.worksheet ?? `gid ${source.worksheetId}`;
    return `Google Sheets ${source.spreadsheetId} › ${tab}${source.range ? ` (${source.range})` : ''}`;
  }
  if (isDatabaseSource(source)) {
    const where = `${source.user}@${source.host}${source.port ? `:${source.port}` : ''}/${source.database}`;
    if (source.table) return `${CONNECTOR_LABEL[source.connector]} ${where} table ${source.table}`;
    const sql = (source.sql ?? '').replace(/\s+/g, ' ').trim();
    return `${CONNECTOR_LABEL[source.connector]} ${where} custom query: ${sql.length > 60 ? `${sql.slice(0, 57)}...` : sql}`;
  }
  return describeSource(source);
}
