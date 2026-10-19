import { addGroupField } from '@/contexts/reports/application/reportUseCases.js';
import { addGroupFieldSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleAddGroupField(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addGroupFieldSchema.parse(raw);
  const group = {
    name: input.name,
    field: input.field,
    groups: input.groups.map((g) => ({
      name: g.name,
      condition: g.condition,
      values: g.values,
      ...(g.exclude ? { exclude: true } : {}),
    })),
    ...(input.other_group ? { otherGroup: input.other_group } : {}),
  };
  return runWrite(
    deps,
    'add_group_field',
    { ...input },
    `add the group field ${input.name}`,
    async () => {
      await addGroupField(deps.reportRepo, input.report_id, group, input.data_source);
      return text(
        `Added the field "${input.name}" grouping ${input.field}. Use it by name in charts.`,
      );
    },
  );
}
