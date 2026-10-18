import { runQuery } from '@/contexts/bigquery/application/bigqueryUseCases.js';
import { runQuerySchema } from '@/mcp/schemas.js';
import {
  formatBytes,
  resolveProject,
  rowsToMarkdown,
  text,
  type ToolResult,
} from '@/mcp/tool-helpers.js';

import type { BigQueryToolDeps } from './bigquery-deps.js';

export async function handleRunQuery(deps: BigQueryToolDeps, raw: unknown): Promise<ToolResult> {
  const input = runQuerySchema.parse(raw);
  const result = await runQuery(
    deps.bigQueryRepo,
    {
      projectId: resolveProject(deps.defaultProject, input.project_id),
      sql: input.sql,
      ...(input.max_rows ? { maxRows: input.max_rows } : {}),
      dryRun: input.dry_run,
    },
    deps.queryLimits,
  );
  if (input.dry_run)
    return text(`Valid query. It would scan ${formatBytes(result.bytesProcessed)}.`);
  const footer = [
    `${result.rows.length} of ${result.totalRows} rows`,
    `scanned ${formatBytes(result.bytesProcessed)}`,
    result.cacheHit ? 'cached' : null,
    result.truncated ? 'truncated: add LIMIT or aggregate' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return text(`${rowsToMarkdown(result)}\n\n_${footer}_`);
}
