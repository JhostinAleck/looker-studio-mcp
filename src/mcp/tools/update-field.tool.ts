import { updateField } from '@/contexts/reports/application/reportUseCases.js';
import type { FieldChange } from '@/contexts/reports/domain/DataSource.js';
import { updateFieldSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleUpdateField(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = updateFieldSchema.parse(raw);
  const change: FieldChange = {
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.aggregation !== undefined ? { aggregation: input.aggregation } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
  };
  return runWrite(
    deps,
    'update_field',
    { ...input },
    `change ${Object.keys(change).join(', ') || 'nothing'} of the field ${input.field}`,
    async () => {
      const f = await updateField(
        deps.reportRepo,
        input.report_id,
        input.field,
        change,
        input.data_source,
      );
      return text(
        `Field \`${f.name}\` is now ${f.type}, ${f.kind}, default aggregation ${f.aggregation}.`,
      );
    },
  );
}
