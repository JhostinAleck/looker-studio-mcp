import { scheduleDelivery } from '@/contexts/reports/application/reportUseCases.js';
import { scheduleDeliverySchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';
import { formatDelivery } from './list-deliveries.tool.js';

export async function handleScheduleDelivery(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = scheduleDeliverySchema.parse(raw);
  const schedule = {
    recipients: input.recipients,
    ...(input.start_date ? { startDate: input.start_date } : {}),
    ...(input.time ? { time: input.time } : {}),
    ...(input.repeat ? { repeat: input.repeat } : {}),
    ...(input.every
      ? {
          every: {
            interval: input.every.interval,
            unit: input.every.unit,
            ...(input.every.weekdays ? { weekdays: input.every.weekdays } : {}),
            ...(input.every.monthly_on ? { monthlyOn: input.every.monthly_on } : {}),
          },
        }
      : {}),
    ...(input.pages ? { pages: input.pages } : {}),
    ...(input.time_zone ? { timeZone: input.time_zone } : {}),
    ...(input.filters
      ? {
          filters: input.filters.map((f) => ({
            ...(f.page ? { page: f.page } : {}),
            ...(f.field ? { field: f.field } : {}),
            ...(f.index ? { index: f.index } : {}),
            ...(f.values ? { values: f.values } : {}),
            ...(f.date_range ? { dateRange: f.date_range } : {}),
          })),
        }
      : {}),
  };
  const who = ['the signed-in account', ...input.recipients].join(', ');
  return runWrite(
    deps,
    'schedule_delivery',
    { ...input },
    `schedule email delivery of the report to ${who}`,
    async () => {
      const info = await scheduleDelivery(deps.reportRepo, input.report_id, schedule);
      return text(`Email delivery scheduled.\n${formatDelivery(info)}`);
    },
  );
}
