import { addShape } from '@/contexts/reports/application/reportUseCases.js';
import { addShapeSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import { placedMessage, toLayout } from './component-format.js';
import type { ReportToolDeps } from './reports-deps.js';

export async function handleAddShape(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addShapeSchema.parse(raw);
  const spec = {
    shape: input.shape,
    ...(input.background ? { background: input.background } : {}),
    ...(input.border_color ? { borderColor: input.border_color } : {}),
    ...(input.border_radius !== undefined ? { borderRadius: input.border_radius } : {}),
  };
  const what = `a ${input.shape}`;
  return runWrite(deps, 'add_shape', { ...input }, `add ${what}`, async () => {
    const placed = await addShape(deps.reportRepo, input.report_id, spec, {
      ...(input.layout ? { layout: toLayout(input.layout) } : {}),
      ...(input.style ? { style: input.style } : {}),
      ...(input.page ? { page: input.page } : {}),
    });
    return text(placedMessage(what, placed));
  });
}
