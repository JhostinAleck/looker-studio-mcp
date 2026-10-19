import { arrangeComponents } from '@/contexts/reports/application/reportUseCases.js';
import { arrangeComponentsSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import { formatLayout } from './component-format.js';
import type { ReportToolDeps } from './reports-deps.js';

export async function handleArrangeComponents(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = arrangeComponentsSchema.parse(raw);
  const what = `${input.action.replace(/_/g, ' ')} components ${input.indexes.map((i) => `#${i}`).join(', ')}`;
  return runWrite(deps, 'arrange_components', { ...input }, what, async () => {
    const after = await arrangeComponents(
      deps.reportRepo,
      input.report_id,
      input.indexes,
      input.action,
      input.page,
    );
    return text(
      [`Done: ${what}.`, ...after.map((c) => `#${c.index} at ${formatLayout(c.layout)}`)].join(
        '\n',
      ),
    );
  });
}
