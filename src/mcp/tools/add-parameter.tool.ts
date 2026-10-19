import { addParameter } from '@/contexts/reports/application/reportUseCases.js';
import { addParameterSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleAddParameter(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addParameterSchema.parse(raw);
  const parameter = {
    name: input.name,
    ...(input.id ? { id: input.id } : {}),
    ...(input.data_type ? { dataType: input.data_type } : {}),
    ...(input.values ? { values: input.values } : {}),
    ...(input.default_value !== undefined ? { defaultValue: input.default_value } : {}),
  };
  return runWrite(
    deps,
    'add_parameter',
    { ...input },
    `add the parameter ${input.name}`,
    async () => {
      await addParameter(deps.reportRepo, input.report_id, parameter, input.data_source);
      return text(
        `Added the parameter "${input.name}". Use it in calculated fields, or add a control on it so viewers can change it.`,
      );
    },
  );
}
