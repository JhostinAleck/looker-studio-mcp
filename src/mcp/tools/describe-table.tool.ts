import { describeTable } from '@/contexts/bigquery/application/bigqueryUseCases.js';
import { describeTableSchema } from '@/mcp/schemas.js';
import { fieldsToMarkdown, resolveProject, text, type ToolResult } from '@/mcp/tool-helpers.js';

import type { BigQueryToolDeps } from './bigquery-deps.js';

export async function handleDescribeTable(
  deps: BigQueryToolDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = describeTableSchema.parse(raw);
  const table = await describeTable(deps.bigQueryRepo, {
    projectId: resolveProject(deps.defaultProject, input.project_id),
    datasetId: input.dataset_id,
    tableId: input.table_id,
  });
  const parts = [
    `## \`${table.projectId}.${table.datasetId}.${table.tableId}\` (${table.type.toLowerCase()})`,
    table.description ? table.description : null,
    table.rowCount !== null && table.type === 'TABLE' ? `Rows: ${table.rowCount}` : null,
    `### Fields\n${fieldsToMarkdown(table.schema) || '_none_'}`,
    table.viewQuery ? `### SQL\n\`\`\`sql\n${table.viewQuery}\n\`\`\`` : null,
  ];
  return text(parts.filter(Boolean).join('\n\n'));
}
