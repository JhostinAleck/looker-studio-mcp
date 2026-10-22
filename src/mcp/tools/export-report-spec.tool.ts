import { readReport } from '@/contexts/reports/application/reportUseCases.js';
import { snapshotToSpec } from '@/mcp/report-spec.js';
import { exportReportSpecSchema } from '@/mcp/schemas.js';
import { text, type ToolResult } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleExportReportSpec(
  deps: ReportToolDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = exportReportSpecSchema.parse(raw);
  const spec = snapshotToSpec(await readReport(deps.reportRepo, input.report_id, input.style));
  const skipped = spec.pages.flatMap((p) =>
    (p.components ?? []).filter((c) => c.component === 'other'),
  );
  const lines = [
    'Report spec (apply_report_spec takes it as `spec`; docs/report-spec.md describes it):',
    '```json',
    JSON.stringify(spec, null, 2),
    '```',
  ];
  if (skipped.length)
    lines.push(
      `${skipped.length} component(s) are kept as "other" and would be skipped by apply_report_spec.`,
    );
  return text(lines.join('\n'));
}
