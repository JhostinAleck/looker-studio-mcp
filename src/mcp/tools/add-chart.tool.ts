import { addChart } from '@/contexts/reports/application/reportUseCases.js';
import { addChartSchema, toDataSettings } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import { placedMessage, toLayout } from './component-format.js';
import type { ReportToolDeps } from './reports-deps.js';

export async function handleAddChart(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addChartSchema.parse(raw);
  const chart = {
    type: input.type,
    dimensions: input.dimensions,
    metrics: input.metrics.map((m) => ({
      field: m.field,
      ...(m.aggregation ? { aggregation: m.aggregation } : {}),
      ...(m.label ? { label: m.label } : {}),
    })),
    sortAscending: input.sort_ascending,
    ...(input.breakdown ? { breakdown: input.breakdown } : {}),
    ...(input.sort_by ? { sortBy: input.sort_by } : {}),
    ...(input.title ? { title: input.title } : {}),
    ...toDataSettings(input),
  };
  const of = chart.metrics.length ? ` of ${chart.metrics.map((m) => m.field).join(', ')}` : '';
  const what = `${input.type} chart${of}${input.dimensions.length ? ` by ${input.dimensions.join(', ')}` : ''}`;
  return runWrite(deps, 'add_chart', { ...input }, `add a ${what}`, async () => {
    const placed = await addChart(deps.reportRepo, input.report_id, chart, {
      ...(input.layout ? { layout: toLayout(input.layout) } : {}),
      ...(input.style ? { style: input.style } : {}),
      ...(input.page ? { page: input.page } : {}),
      ...(input.data_source ? { dataSource: input.data_source } : {}),
    });
    return text(placedMessage(`a ${what}`, placed));
  });
}
