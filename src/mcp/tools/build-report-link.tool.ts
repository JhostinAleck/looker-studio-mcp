import { buildLinkingUrl } from '@/contexts/reports/domain/linking.js';
import { buildReportLinkSchema } from '@/mcp/schemas.js';
import { resolveSource, text, type ToolResult } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';
import { checkQuerySource, type SourceCheckDeps } from './source-check.js';

export async function handleBuildReportLink(
  deps: Pick<ReportToolDeps, 'defaultProject'> & SourceCheckDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = buildReportLinkSchema.parse(raw);
  const sources = input.sources.map((s) => ({
    ...resolveSource(deps.defaultProject, s),
    ...(s.alias ? { alias: s.alias } : {}),
    ...(s.name ? { name: s.name } : {}),
  }));
  const url = buildLinkingUrl({
    reportName: input.report_name,
    ...(input.template_report_id ? { templateReportId: input.template_report_id } : {}),
    sources,
  });
  for (const source of sources) await checkQuerySource(deps, source);
  return text(`Open this link to create the report (Looker Studio asks to confirm):\n${url}`);
}
