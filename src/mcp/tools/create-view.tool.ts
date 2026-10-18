import { createView } from '@/contexts/bigquery/application/bigqueryUseCases.js';
import { createViewSchema } from '@/mcp/schemas.js';
import {
  formatBytes,
  resolveProject,
  runWrite,
  text,
  type ToolResult,
  type WriteDeps,
} from '@/mcp/tool-helpers.js';

import type { BigQueryToolDeps } from './bigquery-deps.js';

export async function handleCreateView(
  deps: BigQueryToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = createViewSchema.parse(raw);
  const projectId = resolveProject(deps.defaultProject, input.project_id);
  const name = `${projectId}.${input.dataset_id}.${input.view_id}`;
  return runWrite(
    deps,
    'create_view',
    { ...input, project_id: projectId },
    `create or replace view ${name}`,
    async () => {
      const { bytesProcessed } = await createView(
        deps.bigQueryRepo,
        {
          projectId,
          datasetId: input.dataset_id,
          tableId: input.view_id,
          sql: input.sql,
          ...(input.description ? { description: input.description } : {}),
        },
        deps.queryLimits,
      );
      return text(`View \`${name}\` saved. Reading it scans about ${formatBytes(bytesProcessed)}.`);
    },
  );
}
