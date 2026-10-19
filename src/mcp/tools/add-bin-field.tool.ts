import { addBinField } from '@/contexts/reports/application/reportUseCases.js';
import { addBinFieldSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleAddBinField(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addBinFieldSchema.parse(raw);
  const bin = {
    name: input.name,
    field: input.field,
    size: input.size,
    ...(input.min !== undefined ? { min: input.min } : {}),
    ...(input.max !== undefined ? { max: input.max } : {}),
  };
  return runWrite(
    deps,
    'add_bin_field',
    { ...input },
    `add the bin field ${input.name}`,
    async () => {
      await addBinField(deps.reportRepo, input.report_id, bin, input.data_source);
      return text(`Added the field "${input.name}" binning ${input.field} by ${input.size}.`);
    },
  );
}
