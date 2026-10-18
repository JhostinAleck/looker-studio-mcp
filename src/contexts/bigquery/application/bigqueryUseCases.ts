import type { BigQueryRepository } from '@/contexts/bigquery/domain/BigQueryRepository.js';
import type {
  Dataset,
  QueryResult,
  Table,
  TableRef,
  TableSummary,
} from '@/contexts/bigquery/domain/BigQuery.js';
import {
  WriteQueryRejectedError,
  assertName,
  assertProjectId,
  isReadOnlyQuery,
} from '@/contexts/bigquery/domain/sql.js';

export interface QueryLimits {
  location: string;
  maxRows: number;
  maxBytesBilled: number;
}

export async function listDatasets(
  repo: BigQueryRepository,
  projectId: string,
): Promise<Dataset[]> {
  return repo.listDatasets(assertProjectId(projectId));
}

export async function listTables(
  repo: BigQueryRepository,
  projectId: string,
  datasetId: string,
): Promise<TableSummary[]> {
  return repo.listTables(assertProjectId(projectId), assertName('Dataset', datasetId));
}

export async function describeTable(repo: BigQueryRepository, ref: TableRef): Promise<Table> {
  return repo.getTable({
    projectId: assertProjectId(ref.projectId),
    datasetId: assertName('Dataset', ref.datasetId),
    tableId: assertName('Table', ref.tableId),
  });
}

export async function runQuery(
  repo: BigQueryRepository,
  input: { projectId: string; sql: string; maxRows?: number; dryRun?: boolean },
  limits: QueryLimits,
): Promise<QueryResult> {
  if (!isReadOnlyQuery(input.sql)) throw new WriteQueryRejectedError();
  return repo.query({
    projectId: assertProjectId(input.projectId),
    sql: input.sql,
    location: limits.location,
    maxRows: Math.min(input.maxRows ?? limits.maxRows, limits.maxRows),
    maxBytesBilled: limits.maxBytesBilled,
    ...(input.dryRun ? { dryRun: true } : {}),
  });
}

// Checks the view's SELECT with a dry run first, so a broken view is never saved.
export async function createView(
  repo: BigQueryRepository,
  input: TableRef & { sql: string; description?: string },
  limits: QueryLimits,
): Promise<{ bytesProcessed: number }> {
  const ref = {
    projectId: assertProjectId(input.projectId),
    datasetId: assertName('Dataset', input.datasetId),
    tableId: assertName('View', input.tableId),
  };
  const check = await runQuery(
    repo,
    { projectId: ref.projectId, sql: input.sql, dryRun: true },
    limits,
  );
  await repo.createOrReplaceView({
    ...ref,
    sql: input.sql,
    location: limits.location,
    ...(input.description ? { description: input.description } : {}),
  });
  return { bytesProcessed: check.bytesProcessed };
}

export async function deleteView(repo: BigQueryRepository, ref: TableRef): Promise<void> {
  return repo.deleteTable({
    projectId: assertProjectId(ref.projectId),
    datasetId: assertName('Dataset', ref.datasetId),
    tableId: assertName('View', ref.tableId),
  });
}
