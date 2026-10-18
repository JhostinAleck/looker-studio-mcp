import { addControl } from '@/contexts/reports/application/reportUseCases.js';
import { addControlSchema, toDataSettings } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import { placedMessage, toLayout } from './component-format.js';
import type { ReportToolDeps } from './reports-deps.js';

export async function handleAddControl(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addControlSchema.parse(raw);
  const control = {
    kind: input.kind,
    ...(input.field ? { field: input.field } : {}),
    ...(input.metric ? { metric: input.metric } : {}),
    ...toDataSettings(input),
  };
  const what = `a ${input.kind.replace(/_/g, ' ')} control${input.field ? ` on ${input.field}` : ''}`;
  return runWrite(deps, 'add_control', { ...input }, `add ${what}`, async () => {
    const placed = await addControl(deps.reportRepo, input.report_id, control, {
      ...(input.layout ? { layout: toLayout(input.layout) } : {}),
      ...(input.style ? { style: input.style } : {}),
      ...(input.page ? { page: input.page } : {}),
      ...(input.data_source ? { dataSource: input.data_source } : {}),
    });
    return text(placedMessage(what, placed));
  });
}
