import { shareReport } from '@/contexts/reports/application/reportUseCases.js';
import { shareReportSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleShareReport(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = shareReportSchema.parse(raw);
  return runWrite(
    deps,
    'share_report',
    { ...input },
    `share the report with ${input.email} as ${input.role}`,
    async () => {
      await shareReport(deps.reportRepo, input.report_id, input.email, input.role);
      return text(`Shared with ${input.email} as ${input.role}.`);
    },
  );
}
