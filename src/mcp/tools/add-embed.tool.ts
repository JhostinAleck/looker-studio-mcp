import { addEmbed } from '@/contexts/reports/application/reportUseCases.js';
import { addEmbedSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import { placedMessage, toLayout } from './component-format.js';
import type { ReportToolDeps } from './reports-deps.js';

export async function handleAddEmbed(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addEmbedSchema.parse(raw);
  const what = `an embed of ${input.url}`;
  return runWrite(deps, 'add_embed', { ...input }, `add ${what}`, async () => {
    const placed = await addEmbed(deps.reportRepo, input.report_id, input.url, {
      ...(input.layout ? { layout: toLayout(input.layout) } : {}),
      ...(input.style ? { style: input.style } : {}),
      ...(input.page ? { page: input.page } : {}),
    });
    return text(placedMessage(what, placed));
  });
}
