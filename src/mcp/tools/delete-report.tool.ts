import { deleteReport } from '@/contexts/reports/application/reportUseCases.js';
import { deleteReportSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleDeleteReport(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = deleteReportSchema.parse(raw);
  return runWrite(
    deps,
    'delete_report',
    { ...input },
    `move "${input.confirm_name}" to the trash`,
    async () => {
      await deleteReport(deps.reportRepo, input.report_id, input.confirm_name);
      return text(`"${input.confirm_name}" moved to the Looker Studio trash.`);
    },
  );
}
