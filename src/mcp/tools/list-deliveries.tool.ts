import { getDelivery } from '@/contexts/reports/application/reportUseCases.js';
import type { DeliveryInfo } from '@/contexts/reports/domain/reportOps.js';
import { listDeliveriesSchema } from '@/mcp/schemas.js';
import { text, type ToolResult } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export function formatDelivery(info: DeliveryInfo): string {
  return Object.entries(info)
    .map(([label, value]) => `- ${label}: ${value}`)
    .join('\n');
}

export async function handleListDeliveries(
  deps: ReportToolDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = listDeliveriesSchema.parse(raw);
  const info = await getDelivery(deps.reportRepo, input.report_id);
  return text(
    info
      ? `The report is scheduled for email delivery:\n${formatDelivery(info)}`
      : 'The report has no email delivery schedule.',
  );
}
