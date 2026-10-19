import { manageFilter } from '@/contexts/reports/application/reportUseCases.js';
import { manageFilterSchema, toFilter } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleManageFilter(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = manageFilterSchema.parse(raw);
  const what = `${input.action} the filter "${input.name}"`;
  return runWrite(deps, 'manage_filter', { ...input }, what, async () => {
    await manageFilter(
      deps.reportRepo,
      input.report_id,
      input.action,
      input.name,
      input.filter ? toFilter(input.filter) : undefined,
    );
    return text(`Done: ${what}.`);
  });
}
