import { createReport } from '@/contexts/reports/application/reportUseCases.js';
import { createReportSchema } from '@/mcp/schemas.js';
import {
  resolveProject,
  runWrite,
  text,
  type ToolResult,
  type WriteDeps,
} from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleCreateReport(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = createReportSchema.parse(raw);
  const source = {
    projectId: resolveProject(deps.defaultProject, input.project_id),
    datasetId: input.dataset_id,
    tableId: input.table_id,
  };
  const table = `${source.projectId}.${source.datasetId}.${source.tableId}`;
  return runWrite(
    deps,
    'create_report',
    { ...input },
    `create report "${input.name}" on ${table}`,
    async () => {
      const report = await createReport(deps.reportRepo, input.name, source);
      return text(
        `Report **${report.name}** created on \`${table}\`.\nId: \`${report.id}\`\n${report.url}`,
      );
    },
  );
}
