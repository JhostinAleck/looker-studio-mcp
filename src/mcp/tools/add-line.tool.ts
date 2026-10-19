import { addLine } from '@/contexts/reports/application/reportUseCases.js';
import { addLineSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import { placedMessage } from './component-format.js';
import type { ReportToolDeps } from './reports-deps.js';

export async function handleAddLine(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addLineSchema.parse(raw);
  const line = {
    from: input.from,
    to: input.to,
    ...(input.color ? { color: input.color } : {}),
    ...(input.border_style ? { borderStyle: input.border_style } : {}),
    ...(input.start ? { start: input.start } : {}),
    ...(input.end ? { end: input.end } : {}),
  };
  const what = `a line from (${input.from.x}, ${input.from.y}) to (${input.to.x}, ${input.to.y})`;
  return runWrite(deps, 'add_line', { ...input }, `add ${what}`, async () => {
    const placed = await addLine(deps.reportRepo, input.report_id, line, {
      ...(input.style ? { style: input.style } : {}),
      ...(input.page ? { page: input.page } : {}),
    });
    return text(placedMessage(what, placed));
  });
}
