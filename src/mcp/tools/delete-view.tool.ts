import { deleteView } from '@/contexts/bigquery/application/bigqueryUseCases.js';
import { deleteViewSchema } from '@/mcp/schemas.js';
import {
  resolveProject,
  runWrite,
  text,
  type ToolResult,
  type WriteDeps,
} from '@/mcp/tool-helpers.js';

import type { BigQueryToolDeps } from './bigquery-deps.js';

export async function handleDeleteView(
  deps: BigQueryToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = deleteViewSchema.parse(raw);
  const projectId = resolveProject(deps.defaultProject, input.project_id);
  const ref = { projectId, datasetId: input.dataset_id, tableId: input.view_id };
  const name = `${projectId}.${input.dataset_id}.${input.view_id}`;
  // Only views: deleting tables would lose data that BigQuery cannot restore.
  const table = await deps.bigQueryRepo.getTable(ref);
  if (table.type !== 'VIEW')
    return text(`Not deleted: \`${name}\` is a ${table.type.toLowerCase()}, not a view.`);
  return runWrite(
    deps,
    'delete_view',
    { ...input, project_id: projectId },
    `delete view ${name}`,
    async () => {
      await deleteView(deps.bigQueryRepo, ref);
      return text(`View \`${name}\` deleted.`);
    },
  );
}
