import { updateComponent } from '@/contexts/reports/application/reportUseCases.js';
import { toButton, toDataSettings, updateComponentSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import { formatComponent, toLayout } from './component-format.js';
import type { ReportToolDeps } from './reports-deps.js';

export async function handleUpdateComponent(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = updateComponentSchema.parse(raw);
  const change = {
    ...(input.layout ? { layout: toLayout(input.layout) } : {}),
    ...(input.style ? { style: input.style } : {}),
    ...(input.setup ? { setup: input.setup } : {}),
    ...(input.labels ? { labels: input.labels } : {}),
    ...(input.order ? { order: input.order } : {}),
    ...(input.report_level !== undefined ? { reportLevel: input.report_level } : {}),
    ...(input.chart_type ? { chartType: input.chart_type } : {}),
    ...(input.button ? { button: toButton(input.button) } : {}),
    ...(input.embed_url ? { embedUrl: input.embed_url } : {}),
    ...toDataSettings(input),
  };
  return runWrite(
    deps,
    'update_component',
    { ...input },
    `update component #${input.index}`,
    async () => {
      const c = await updateComponent(
        deps.reportRepo,
        input.report_id,
        input.index,
        change,
        input.page,
      );
      const lines = [`Updated: ${formatComponent(c)}.`];
      if (c.warnings?.length)
        lines.push(
          `Not applied (no such setting): ${c.warnings.join(', ')}. describe_component lists the real labels.`,
        );
      return text(lines.join('\n'));
    },
  );
}
