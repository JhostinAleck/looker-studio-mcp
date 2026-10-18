import { addPage } from '@/contexts/reports/application/reportUseCases.js';
import { addPageSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleAddPage(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addPageSchema.parse(raw);
  return runWrite(deps, 'add_page', { ...input }, `add page "${input.name}"`, async () => {
    const page = await addPage(deps.reportRepo, input.report_id, input.name);
    return text(`Page ${page.index} "${page.name}" added.`);
  });
}
