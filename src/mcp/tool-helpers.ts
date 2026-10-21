import { randomUUID } from 'node:crypto';

import type { Field, QueryResult } from '@/contexts/bigquery/domain/BigQuery.js';
import type { BigQuerySource } from '@/contexts/reports/domain/Report.js';
import type { AuditLogger } from '@/shared-kernel/audit/AuditLogger.js';
import { DomainError } from '@/shared-kernel/errors/DomainError.js';
import type { WritesGate } from '@/shared-kernel/writes/WritesGate.js';

export interface ToolResult {
  [key: string]: unknown;
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  >;
  isError?: boolean;
}

export function text(body: string): ToolResult {
  return { content: [{ type: 'text', text: body }] };
}

export function errorMessage(err: unknown): string {
  return err instanceof DomainError
    ? err.userMessage
    : err instanceof Error
      ? err.message
      : String(err);
}

export function errorResult(err: unknown): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true };
}

export class MissingProjectError extends DomainError {
  readonly code = 'MISSING_PROJECT';
  readonly userMessage =
    'No Google Cloud project: pass project_id or set project_id in ~/.looker-studio-mcp/config.yaml.';
}

export class InvalidSourceError extends DomainError {
  readonly code = 'INVALID_SOURCE';
  readonly userMessage =
    'Give a data source as either sql (custom query) or dataset_id and table_id, not both.';
}

interface SourceInput {
  project_id?: string | undefined;
  dataset_id?: string | undefined;
  table_id?: string | undefined;
  sql?: string | undefined;
  source_name?: string | undefined;
}

// Turns the tool fields into a table or custom query source.
export function resolveSource(
  defaultProject: string | undefined,
  input: SourceInput,
): BigQuerySource {
  const projectId = resolveProject(defaultProject, input.project_id);
  const sql = input.sql?.trim();
  if (sql) {
    if (input.dataset_id || input.table_id) throw new InvalidSourceError();
    return { projectId, sql, ...(input.source_name ? { name: input.source_name } : {}) };
  }
  if (!input.dataset_id || !input.table_id || input.source_name) throw new InvalidSourceError();
  return { projectId, datasetId: input.dataset_id, tableId: input.table_id };
}

export function resolveProject(
  defaultProject: string | undefined,
  given: string | undefined,
): string {
  const project = given ?? defaultProject;
  if (!project) throw new MissingProjectError();
  return project;
}

export interface WriteDeps {
  writesGate: WritesGate;
  auditLogger: AuditLogger;
}

// Every write is audited first; in dry-run mode it only reports what it would do.
export async function runWrite(
  deps: WriteDeps,
  tool: string,
  args: Record<string, unknown>,
  describe: string,
  work: () => Promise<ToolResult>,
): Promise<ToolResult> {
  deps.auditLogger.recordWriteAttempt({ correlationId: randomUUID(), tool, args });
  if (deps.writesGate.isDryRun) return text(`Dry run: would ${describe}. Nothing was changed.`);
  return work();
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return raw.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function rowsToMarkdown(result: QueryResult): string {
  const columns = result.schema.map((f) => f.name);
  if (result.rows.length === 0) return '_No rows._';
  const header = `| ${columns.join(' | ')} |\n|${columns.map(() => '---').join('|')}|`;
  const body = result.rows
    .map((row) => `| ${columns.map((c) => cell(row[c])).join(' | ')} |`)
    .join('\n');
  return `${header}\n${body}`;
}

export function fieldsToMarkdown(fields: Field[], indent = ''): string {
  return fields
    .map((f) => {
      const line = `${indent}- \`${f.name}\` ${f.type}${f.mode === 'NULLABLE' ? '' : ` ${f.mode}`}${f.description ? ` — ${f.description}` : ''}`;
      return f.fields.length > 0 ? `${line}\n${fieldsToMarkdown(f.fields, `${indent}  `)}` : line;
    })
    .join('\n');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
