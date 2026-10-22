import { removeDelivery } from '@/contexts/reports/application/reportUseCases.js';
import { removeDeliverySchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleRemoveDelivery(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = removeDeliverySchema.parse(raw);
  return runWrite(
    deps,
    'remove_delivery',
    { ...input },
    'delete the email delivery schedule of the report',
    async () => {
      const removed = await removeDelivery(deps.reportRepo, input.report_id);
      return text(removed ? 'Email delivery schedule deleted.' : 'The report had no schedule.');
    },
  );
}
