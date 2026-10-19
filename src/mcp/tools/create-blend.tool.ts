import { createBlend } from '@/contexts/reports/application/reportUseCases.js';
import { createBlendSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleCreateBlend(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = createBlendSchema.parse(raw);
  const blend = {
    name: input.name,
    tables: input.tables.map((t) => ({
      dataSource: t.data_source,
      dimensions: t.dimensions,
      metrics: t.metrics,
    })),
    joins: input.joins.map((j) => ({ type: j.type, keys: j.keys })),
  };
  return runWrite(
    deps,
    'create_blend',
    { ...input },
    `create the blend ${input.name}`,
    async () => {
      await createBlend(deps.reportRepo, input.report_id, blend);
      return text(`Created the blend "${input.name}". Use it as the data_source of add_chart.`);
    },
  );
}
