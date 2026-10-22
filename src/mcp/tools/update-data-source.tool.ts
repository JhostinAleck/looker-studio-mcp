import { updateDataSource } from '@/contexts/reports/application/reportUseCases.js';
import type { DataSourceChange } from '@/contexts/reports/domain/DataSource.js';
import { updateDataSourceSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';
import { checkQuerySource, type SourceCheckDeps } from './source-check.js';

export async function handleUpdateDataSource(
  deps: ReportToolDeps & WriteDeps & SourceCheckDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = updateDataSourceSchema.parse(raw);
  const change: DataSourceChange = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.sql !== undefined ? { sql: input.sql } : {}),
    ...(input.credentials ? { credentials: input.credentials } : {}),
    ...(input.freshness ? { freshness: input.freshness } : {}),
  };
  // The data source's billing project is only known in the editor: dry-run in
  // the given or default project, so a broken query fails before Looker opens.
  const project = input.project_id ?? deps.defaultProject;
  if (change.sql && project) await checkQuerySource(deps, { projectId: project, sql: change.sql });
  const what = Object.keys(change).join(', ') || 'nothing';
  return runWrite(
    deps,
    'update_data_source',
    { ...input },
    `change ${what} of the data source ${input.data_source}`,
    async () => {
      const notes = await updateDataSource(
        deps.reportRepo,
        input.report_id,
        input.data_source,
        change,
      );
      const lines = [`Updated ${what} of the data source ${input.data_source}.`, ...notes];
      if (change.sql)
        lines.push(
          'Check the field types with list_data_sources (fields: true); fix them with update_field.',
        );
      return text(lines.join('\n'));
    },
  );
}
