import { duplicateComponent } from '@/contexts/reports/application/reportUseCases.js';
import { duplicateComponentSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import { placedMessage, toLayout } from './component-format.js';
import type { ReportToolDeps } from './reports-deps.js';

export async function handleDuplicateComponent(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = duplicateComponentSchema.parse(raw);
  return runWrite(
    deps,
    'duplicate_component',
    { ...input },
    `duplicate component #${input.index}`,
    async () => {
      const copy = await duplicateComponent(
        deps.reportRepo,
        input.report_id,
        input.index,
        input.layout ? toLayout(input.layout) : undefined,
        input.page,
      );
      return text(placedMessage(`a copy of #${input.index}`, copy));
    },
  );
}
