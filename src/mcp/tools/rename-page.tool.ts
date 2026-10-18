import { renamePage } from '@/contexts/reports/application/reportUseCases.js';
import { renamePageSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleRenamePage(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = renamePageSchema.parse(raw);
  return runWrite(
    deps,
    'rename_page',
    { ...input },
    `rename page ${input.page} to "${input.name}"`,
    async () => {
      await renamePage(deps.reportRepo, input.report_id, input.page, input.name);
      return text(`Page ${input.page} is now "${input.name}".`);
    },
  );
}
