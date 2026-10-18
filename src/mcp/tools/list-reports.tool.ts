import { listReports } from '@/contexts/reports/application/reportUseCases.js';
import { listReportsSchema } from '@/mcp/schemas.js';
import { text, type ToolResult } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleListReports(deps: ReportToolDeps, raw: unknown): Promise<ToolResult> {
  const input = listReportsSchema.parse(raw);
  const reports = await listReports(deps.reportRepo, input.query);
  if (reports.length === 0)
    return text(input.query ? `No reports match "${input.query}".` : 'No reports yet.');
  return text(reports.map((r) => `- **${r.name}** — \`${r.id}\` — ${r.url}`).join('\n'));
}
