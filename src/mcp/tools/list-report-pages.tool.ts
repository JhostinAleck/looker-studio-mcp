import { listPages } from '@/contexts/reports/application/reportUseCases.js';
import { listReportPagesSchema } from '@/mcp/schemas.js';
import { text, type ToolResult } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleListReportPages(
  deps: ReportToolDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = listReportPagesSchema.parse(raw);
  const pages = await listPages(deps.reportRepo, input.report_id);
  return text(pages.map((p) => `${p.index}. ${p.name}`).join('\n') || 'The report has no pages.');
}
