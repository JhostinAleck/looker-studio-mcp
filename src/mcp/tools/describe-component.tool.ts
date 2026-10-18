import { describeComponent } from '@/contexts/reports/application/reportUseCases.js';
import { describeComponentSchema } from '@/mcp/schemas.js';
import { text, type ToolResult } from '@/mcp/tool-helpers.js';

import { formatLayout, formatSettings } from './component-format.js';
import type { ReportToolDeps } from './reports-deps.js';

export async function handleDescribeComponent(
  deps: ReportToolDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = describeComponentSchema.parse(raw);
  const d = await describeComponent(deps.reportRepo, input.report_id, input.index, input.page);
  return text(
    [
      `# ${d.kind} (#${input.index})`,
      `Layout: ${formatLayout(d.layout)}`,
      '',
      '## Setup',
      formatSettings(d.setup),
      '',
      '## Style',
      formatSettings(d.style),
    ].join('\n'),
  );
}
