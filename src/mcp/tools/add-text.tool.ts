import { addText } from '@/contexts/reports/application/reportUseCases.js';
import { addTextSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import { placedMessage, toLayout } from './component-format.js';
import type { ReportToolDeps } from './reports-deps.js';

export async function handleAddText(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addTextSchema.parse(raw);
  const spec = {
    text: input.text,
    bold: input.bold,
    ...(input.italic ? { italic: true } : {}),
    ...(input.underline ? { underline: true } : {}),
    ...(input.strikethrough ? { strikethrough: true } : {}),
    ...(input.font_size ? { fontSize: input.font_size } : {}),
    ...(input.color ? { color: input.color } : {}),
    ...(input.background ? { background: input.background } : {}),
    ...(input.align ? { align: input.align } : {}),
  };
  const what = `text "${input.text.slice(0, 40)}"`;
  return runWrite(deps, 'add_text', { ...input }, `add ${what}`, async () => {
    const placed = await addText(deps.reportRepo, input.report_id, spec, {
      ...(input.layout ? { layout: toLayout(input.layout) } : {}),
      ...(input.style ? { style: input.style } : {}),
      ...(input.page ? { page: input.page } : {}),
    });
    return text(placedMessage(what, placed));
  });
}
