import { managePage } from '@/contexts/reports/application/reportUseCases.js';
import { managePageSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleManagePage(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = managePageSchema.parse(raw);
  const what = `${input.action.replace(/_/g, ' ')} page ${input.page}`;
  return runWrite(deps, 'manage_page', { ...input }, what, async () => {
    const pages = await managePage(deps.reportRepo, input.report_id, input.page, input.action);
    return text(
      [`Done: ${what}. The pages now:`, ...pages.map((p) => `${p.index}. ${p.name}`)].join('\n'),
    );
  });
}
