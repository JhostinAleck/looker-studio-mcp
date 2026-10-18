import { DomainError } from '@/shared-kernel/errors/DomainError.js';

export class InvalidIdentifierError extends DomainError {
  readonly code = 'INVALID_IDENTIFIER';
  readonly userMessage: string;

  constructor(kind: string, value: string) {
    super(`${kind} "${value}" is not a valid BigQuery identifier`);
    this.userMessage = `${kind} "${value}" may only use letters, numbers, underscores and (for projects) dashes.`;
  }
}

export class WriteQueryRejectedError extends DomainError {
  readonly code = 'WRITE_QUERY_REJECTED';
  readonly userMessage =
    'run_query only accepts a single SELECT (or WITH ... SELECT) statement. Use create_view to save SQL.';
}

const PROJECT_RE = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,1023}$/;

export function assertProjectId(value: string): string {
  if (!PROJECT_RE.test(value)) throw new InvalidIdentifierError('Project', value);
  return value;
}

export function assertName(kind: 'Dataset' | 'Table' | 'View', value: string): string {
  if (!NAME_RE.test(value)) throw new InvalidIdentifierError(kind, value);
  return value;
}

// Removes comments and string literals so keywords inside them do not count.
function stripNoise(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

// A single read-only statement: starts with SELECT or WITH, and no second statement.
export function isReadOnlyQuery(sql: string): boolean {
  const clean = stripNoise(sql).trim().replace(/;\s*$/, '');
  if (clean.includes(';')) return false;
  if (!/^(select|with)\b/i.test(clean)) return false;
  return !/\b(insert|update|delete|merge|create|drop|alter|truncate|grant|revoke|call|execute|export|load)\b/i.test(
    clean,
  );
}

export function quoteString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

export function viewDdl(
  ref: { projectId: string; datasetId: string; tableId: string },
  sql: string,
  description?: string,
): string {
  const name = `\`${assertProjectId(ref.projectId)}.${assertName('Dataset', ref.datasetId)}.${assertName('View', ref.tableId)}\``;
  const options = description ? `\nOPTIONS (description = ${quoteString(description)})` : '';
  return `CREATE OR REPLACE VIEW ${name}${options}\nAS\n${sql.trim().replace(/;\s*$/, '')}`;
}
