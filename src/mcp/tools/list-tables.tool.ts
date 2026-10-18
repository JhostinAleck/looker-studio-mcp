import { listTables } from '@/contexts/bigquery/application/bigqueryUseCases.js';
import { listTablesSchema } from '@/mcp/schemas.js';
import { resolveProject, text, type ToolResult } from '@/mcp/tool-helpers.js';

import type { BigQueryToolDeps } from './bigquery-deps.js';

export async function handleListTables(deps: BigQueryToolDeps, raw: unknown): Promise<ToolResult> {
  const input = listTablesSchema.parse(raw);
  const project = resolveProject(deps.defaultProject, input.project_id);
  const tables = await listTables(deps.bigQueryRepo, project, input.dataset_id);
  if (tables.length === 0) return text(`\`${project}.${input.dataset_id}\` has no tables.`);
  const lines = tables.map((t) => `- \`${t.tableId}\` ${t.type.toLowerCase().replace('_', ' ')}`);
  return text(`Tables in \`${project}.${input.dataset_id}\`:\n${lines.join('\n')}`);
}
