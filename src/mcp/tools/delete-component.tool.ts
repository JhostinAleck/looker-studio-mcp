import { deleteComponent } from '@/contexts/reports/application/reportUseCases.js';
import { deleteComponentSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleDeleteComponent(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = deleteComponentSchema.parse(raw);
  return runWrite(
    deps,
    'delete_component',
    { ...input },
    `delete component #${input.index}`,
    async () => {
      await deleteComponent(deps.reportRepo, input.report_id, input.index, input.page);
      return text(`Deleted component #${input.index}. The indexes after it moved down by one.`);
    },
  );
}
