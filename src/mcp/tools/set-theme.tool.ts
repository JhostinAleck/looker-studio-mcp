import { setTheme } from '@/contexts/reports/application/reportUseCases.js';
import { setThemeSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleSetTheme(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = setThemeSchema.parse(raw);
  const theme = {
    ...(input.preset ? { preset: input.preset } : {}),
    ...(input.settings ? { settings: input.settings } : {}),
    ...(input.canvas ? { canvas: input.canvas } : {}),
    ...(input.layout ? { layout: input.layout } : {}),
  };
  return runWrite(deps, 'set_theme', { ...input }, 'change the report theme', async () => {
    await setTheme(deps.reportRepo, input.report_id, theme);
    return text('Theme applied. Use screenshot_report to check it.');
  });
}
