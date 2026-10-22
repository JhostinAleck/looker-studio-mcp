import { removeDataSource } from '@/contexts/reports/application/reportUseCases.js';
import { removeDataSourceSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleRemoveDataSource(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = removeDataSourceSchema.parse(raw);
  return runWrite(
    deps,
    'remove_data_source',
    { ...input },
    `remove the data source ${input.data_source}${input.force ? ' even if charts use it' : ''}`,
    async () => {
      const row = await removeDataSource(
        deps.reportRepo,
        input.report_id,
        input.data_source,
        input.force,
      );
      const broken = /[1-9]\d* chart/.test(row.usedIn)
        ? ` It was used in ${row.usedIn}: those charts are broken now; delete them or pick another data source.`
        : '';
      return text(`Removed the data source ${row.name} (${row.alias}).${broken}`);
    },
  );
}
