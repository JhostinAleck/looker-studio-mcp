import { buildLinkingUrl } from '@/contexts/reports/domain/linking.js';
import { buildReportLinkSchema } from '@/mcp/schemas.js';
import { resolveSource, text, type ToolResult } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export function handleBuildReportLink(
  deps: Pick<ReportToolDeps, 'defaultProject'>,
  raw: unknown,
): ToolResult {
  const input = buildReportLinkSchema.parse(raw);
  const url = buildLinkingUrl({
    reportName: input.report_name,
    ...(input.template_report_id ? { templateReportId: input.template_report_id } : {}),
    sources: input.sources.map((s) => ({
      ...resolveSource(deps.defaultProject, s),
      ...(s.alias ? { alias: s.alias } : {}),
      ...(s.name ? { name: s.name } : {}),
    })),
  });
  return text(`Open this link to create the report (Looker Studio asks to confirm):\n${url}`);
}
