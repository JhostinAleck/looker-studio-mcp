import { DomainError } from '@/shared-kernel/errors/DomainError.js';

import { AGGREGATIONS, InvalidChartError } from './Report.js';

// A row of Resource › Manage added data sources.
export interface DataSourceRow {
  name: string;
  // ds0, ds1… unique in a report even when names repeat.
  alias: string;
  connector: string;
  // Embedded (lives in the report) or Reusable.
  scope: string;
  // "2 charts, 0 variables" as the panel shows it.
  usedIn: string;
  status: string;
}

export interface DataSourceField {
  name: string;
  // "Number", "Text", "Date"…
  type: string;
  aggregation: string;
  kind: 'dimension' | 'metric';
}

export interface DataSourceInfo extends DataSourceRow {
  charts: number;
  kind: 'table' | 'custom_query' | 'other';
  // project.dataset.table for a table or view.
  table?: string;
  sql?: string;
  billingProject?: string;
  credentials?: string;
  freshness?: string;
  fields?: DataSourceField[];
}

export const FRESHNESS = ['15 minutes', '1 hour', '4 hours', '12 hours'] as const;
export type Freshness = (typeof FRESHNESS)[number];

export const CREDENTIALS = ['owner', 'viewer'] as const;
export type Credentials = (typeof CREDENTIALS)[number];

export interface DataSourceChange {
  name?: string;
  // Custom queries only: the new SQL, applied with Reconnect.
  sql?: string;
  credentials?: Credentials;
  freshness?: Freshness;
}

export const FIELD_AGGREGATIONS = [...AGGREGATIONS, 'median', 'std_dev', 'variance'] as const;
export type FieldAggregation = (typeof FIELD_AGGREGATIONS)[number];

export interface FieldChange {
  // A type label of the field editor ("Number", "Text", "Date", "Percent", "Country"…)
  // or a menu path ("Numeric > Number", "Currency > EUR").
  type?: string;
  aggregation?: FieldAggregation;
  name?: string;
}

export class DataSourceNotFoundError extends DomainError {
  readonly code = 'DATA_SOURCE_NOT_FOUND';
  constructor(readonly userMessage: string) {
    super(userMessage);
  }
}

// Looker Studio removes a data source that charts use and leaves them broken.
export class DataSourceInUseError extends DomainError {
  readonly code = 'DATA_SOURCE_IN_USE';
  readonly userMessage: string;

  constructor(row: DataSourceRow) {
    super(`${row.name} is used: ${row.usedIn}`);
    this.userMessage = `Not removed: "${row.name}" (${row.alias}) is used in the report (${row.usedIn}); removing it would break those charts. Delete or repoint them first, or pass force: true.`;
  }
}

const ALIAS_RE = /^ds\d+$/i;

// A data source is addressed by alias (always unique) or by name; a name that
// several data sources share needs the alias.
export function findDataSource(rows: DataSourceRow[], ref: string): DataSourceRow {
  const wanted = ref.trim();
  const listed = () => rows.map((r) => `${r.name} (${r.alias})`).join(', ') || 'none';
  if (ALIAS_RE.test(wanted)) {
    const row = rows.find((r) => r.alias.toLowerCase() === wanted.toLowerCase());
    if (row) return row;
  }
  const named = rows.filter((r) => r.name === wanted);
  if (named.length === 1) return named[0]!;
  if (named.length > 1) {
    throw new DataSourceNotFoundError(
      `Several data sources are named "${wanted}" (${named.map((r) => r.alias).join(', ')}): pass the alias instead.`,
    );
  }
  throw new DataSourceNotFoundError(`No data source "${wanted}". The report has: ${listed()}.`);
}

// "1 chart, 0 variables" → 1.
export function chartsUsing(usedIn: string): number {
  const match = /(\d+)\s+charts?/i.exec(usedIn);
  return match ? Number(match[1]) : 0;
}

// Charts or variables (parameters, controls) still read it.
export function isUsed(usedIn: string): boolean {
  return [...usedIn.matchAll(/(\d+)/g)].some((m) => Number(m[1]) > 0);
}

// The BigQuery connector links each project, dataset and table to the Cloud
// console: …?project=p&p=p&d=dataset&t=table&page=table.
export function parseConsoleLink(href: string): {
  project?: string;
  dataset?: string;
  table?: string;
} {
  const query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);
  const out: { project?: string; dataset?: string; table?: string } = {};
  const project = params.get('p') ?? params.get('project');
  if (project) out.project = project;
  const dataset = params.get('d');
  if (dataset) out.dataset = dataset;
  const table = params.get('t');
  if (table) out.table = table;
  return out;
}

export function validateDataSourceChange(change: DataSourceChange): DataSourceChange {
  const { name, sql, credentials, freshness } = change;
  if (name === undefined && sql === undefined && !credentials && !freshness) {
    throw new InvalidChartError('Pass name, sql, credentials or freshness.');
  }
  if (name !== undefined && !name.trim())
    throw new InvalidChartError('The data source name cannot be empty.');
  if (sql !== undefined && !sql.trim()) throw new InvalidChartError('The SQL cannot be empty.');
  const out: DataSourceChange = {};
  if (name !== undefined) out.name = name.trim();
  if (sql !== undefined) out.sql = sql.trim();
  if (credentials) out.credentials = credentials;
  if (freshness) out.freshness = freshness;
  return out;
}

export function validateFieldChange(field: string, change: FieldChange): FieldChange {
  if (!field.trim()) throw new InvalidChartError('Name the field to change.');
  const { type, aggregation, name } = change;
  if (type === undefined && aggregation === undefined && name === undefined)
    throw new InvalidChartError('Pass type, aggregation or name.');
  if (type !== undefined && !type.trim())
    throw new InvalidChartError('The field type cannot be empty.');
  if (name !== undefined && !name.trim())
    throw new InvalidChartError('The new field name cannot be empty.');
  const out: FieldChange = {};
  if (type !== undefined) out.type = type.trim();
  if (aggregation !== undefined) out.aggregation = aggregation;
  if (name !== undefined) out.name = name.trim();
  return out;
}

// The Apply Connection Changes dialog lists one field per line under headings
// (New Fields, Missing Fields, Changed Semantic Configuration…), then Cancel and Apply.
export function parseConnectionChanges(text: string): string[] {
  const label: Record<string, string> = {
    'new fields': 'New fields',
    'removed fields': 'Removed fields',
    'missing fields': 'Missing fields',
    'changed fields': 'Changed fields',
    'changed semantic configuration': 'Fields with a new type',
  };
  const sections: Array<{ label: string; fields: string[] }> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(cancel|apply)$/i.test(line)) break;
    const heading = label[line.toLowerCase()];
    if (heading) sections.push({ label: heading, fields: [] });
    else sections.at(-1)?.fields.push(line);
  }
  return sections.filter((s) => s.fields.length).map((s) => `${s.label}: ${s.fields.join(', ')}`);
}

// "Numeric > Number" → ["Numeric", "Number"]; "Number" → ["Number"].
export function fieldTypePath(type: string): string[] {
  return type
    .split(/\s*[>›]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}
