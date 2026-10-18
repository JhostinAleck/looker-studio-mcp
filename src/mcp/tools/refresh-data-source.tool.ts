import { refreshDataSources } from '@/contexts/reports/application/reportUseCases.js';
import { refreshDataSourceSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleRefreshDataSource(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = refreshDataSourceSchema.parse(raw);
  const which = input.name ? `the data source ${input.name}` : 'all data sources';
  return runWrite(
    deps,
    'refresh_data_source',
    { ...input },
    `refresh the fields of ${which}`,
    async () => {
      const added = await refreshDataSources(deps.reportRepo, input.report_id, input.name);
      return text(
        added.length
          ? `Refreshed ${which}. New fields: ${added.join(', ')}.`
          : `Refreshed ${which}. No new fields.`,
      );
    },
  );
}
