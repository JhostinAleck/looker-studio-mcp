import { copyReport } from '@/contexts/reports/application/reportUseCases.js';
import { describeSource } from '@/contexts/reports/domain/Report.js';
import { copyReportSchema } from '@/mcp/schemas.js';
import {
  resolveSource,
  runWrite,
  text,
  type ToolResult,
  type WriteDeps,
} from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleCopyReport(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = copyReportSchema.parse(raw);
  const replacements = input.data_sources.map(({ original, ...source }) => ({
    original,
    source: resolveSource(deps.defaultProject, source),
  }));
  const plan = replacements.map((r) => `${r.original} → ${describeSource(r.source)}`).join('; ');
  return runWrite(
    deps,
    'copy_report',
    { ...input },
    `copy the report as "${input.name}"${plan ? ` (${plan})` : ''}`,
    async () => {
      const copy = await copyReport(deps.reportRepo, input.report_id, input.name, replacements);
      const lines = [`Copy **${copy.name}** created.`, `Id: \`${copy.id}\``, copy.url];
      if (copy.replaced.length) lines.push(`Reconnected: ${copy.replaced.join('; ')}.`);
      return text(lines.join('\n'));
    },
  );
}
