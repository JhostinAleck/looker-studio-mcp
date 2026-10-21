import { createReport } from '@/contexts/reports/application/reportUseCases.js';
import { describeSource } from '@/contexts/reports/domain/Report.js';
import { createReportSchema } from '@/mcp/schemas.js';
import {
  resolveSource,
  runWrite,
  text,
  type ToolResult,
  type WriteDeps,
} from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleCreateReport(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = createReportSchema.parse(raw);
  const source = resolveSource(deps.defaultProject, input);
  const table = describeSource(source);
  return runWrite(
    deps,
    'create_report',
    { ...input },
    `create report "${input.name}" on ${table}`,
    async () => {
      const report = await createReport(deps.reportRepo, input.name, source);
      return text(
        `Report **${report.name}** created on \`${table}\`.\nId: \`${report.id}\`\n${report.url}`,
      );
    },
  );
}
