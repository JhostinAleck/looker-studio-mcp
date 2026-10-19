import { setScopeSettings } from '@/contexts/reports/application/reportUseCases.js';
import { setPageSettingsSchema, toFilter } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleSetPageSettings(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = setPageSettingsSchema.parse(raw);
  const settings = {
    ...(input.data_source ? { dataSource: input.data_source } : {}),
    ...(input.filters ? { filters: input.filters.map(toFilter) } : {}),
    ...(input.date_range_dimension ? { dateRangeDimension: input.date_range_dimension } : {}),
    ...(input.date_range ? { dateRange: input.date_range } : {}),
    ...(input.style ? { style: input.style } : {}),
  };
  const where = input.scope === 'page' ? `page ${input.page ?? 1}` : 'the whole report';
  return runWrite(
    deps,
    'set_page_settings',
    { ...input },
    `set the settings of ${where}`,
    async () => {
      const missing = await setScopeSettings(
        deps.reportRepo,
        input.report_id,
        input.scope,
        settings,
        input.page,
      );
      const lines = [`Updated the settings of ${where}.`];
      if (missing.length) lines.push(`Not applied: ${missing.join(', ')}.`);
      return text(lines.join('\n'));
    },
  );
}
