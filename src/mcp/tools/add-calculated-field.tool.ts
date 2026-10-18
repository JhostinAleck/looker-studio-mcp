import { addCalculatedField } from '@/contexts/reports/application/reportUseCases.js';
import { addCalculatedFieldSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleAddCalculatedField(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addCalculatedFieldSchema.parse(raw);
  return runWrite(
    deps,
    'add_calculated_field',
    { ...input },
    `add the calculated field ${input.name}`,
    async () => {
      await addCalculatedField(
        deps.reportRepo,
        input.report_id,
        { name: input.name, formula: input.formula },
        input.data_source,
      );
      return text(
        `Added the field "${input.name}" = ${input.formula}. Use it by name in add_chart or add_control.`,
      );
    },
  );
}
