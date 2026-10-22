import { getEmbed } from '@/contexts/reports/application/reportUseCases.js';
import { getEmbedCodeSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleGetEmbedCode(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = getEmbedCodeSchema.parse(raw);
  const opts = {
    ...(input.page ? { page: input.page } : {}),
    ...(input.width ? { width: input.width } : {}),
    ...(input.height ? { height: input.height } : {}),
    ...(input.show_navigation !== undefined ? { showNavigation: input.show_navigation } : {}),
  };
  return runWrite(
    deps,
    'get_embed_code',
    { ...input },
    'turn embedding on (if off) and read the embed code',
    async () => {
      const embed = await getEmbed(deps.reportRepo, input.report_id, opts);
      return text(
        [
          embed.enabled ? 'Embedding turned on.' : 'Embedding is on.',
          `Embed URL: ${embed.url}`,
          'Embed code:',
          '```html',
          embed.code,
          '```',
        ].join('\n'),
      );
    },
  );
}
