import { renameReport } from '@/contexts/reports/application/reportUseCases.js';
import { renameReportSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleRenameReport(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = renameReportSchema.parse(raw);
  return runWrite(
    deps,
    'rename_report',
    { ...input },
    `rename the report to "${input.name}"`,
    async () => {
      await renameReport(deps.reportRepo, input.report_id, input.name);
      return text(`Report renamed to "${input.name}".`);
    },
  );
}
