import { addDataSource } from '@/contexts/reports/application/reportUseCases.js';
import { addDataSourceSchema } from '@/mcp/schemas.js';
import {
  resolveProject,
  runWrite,
  text,
  type ToolResult,
  type WriteDeps,
} from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleAddDataSource(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addDataSourceSchema.parse(raw);
  const source = {
    projectId: resolveProject(deps.defaultProject, input.project_id),
    datasetId: input.dataset_id,
    tableId: input.table_id,
  };
  const table = `${source.projectId}.${source.datasetId}.${source.tableId}`;
  return runWrite(deps, 'add_data_source', { ...input }, `add ${table} to the report`, async () => {
    await addDataSource(deps.reportRepo, input.report_id, source);
    return text(`Data source \`${source.tableId}\` (\`${table}\`) added to the report.`);
  });
}
