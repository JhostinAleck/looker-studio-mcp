import { listDatasets } from '@/contexts/bigquery/application/bigqueryUseCases.js';
import { listDatasetsSchema } from '@/mcp/schemas.js';
import { resolveProject, text, type ToolResult } from '@/mcp/tool-helpers.js';

import type { BigQueryToolDeps } from './bigquery-deps.js';

export async function handleListDatasets(
  deps: BigQueryToolDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = listDatasetsSchema.parse(raw);
  const project = resolveProject(deps.defaultProject, input.project_id);
  const datasets = await listDatasets(deps.bigQueryRepo, project);
  if (datasets.length === 0) return text(`No datasets in \`${project}\`.`);
  const lines = datasets.map((d) => `- \`${d.datasetId}\`${d.location ? ` (${d.location})` : ''}`);
  return text(`Datasets in \`${project}\`:\n${lines.join('\n')}`);
}
