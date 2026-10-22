import { addDataSource } from '@/contexts/reports/application/reportUseCases.js';
import { describeDataSource } from '@/contexts/reports/domain/connectors.js';
import { addDataSourceSchema } from '@/mcp/schemas.js';
import {
  resolveSource,
  runWrite,
  text,
  type ToolResult,
  type WriteDeps,
} from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleAddDataSource(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addDataSourceSchema.parse(raw);
  const source = resolveSource(deps.defaultProject, input);
  const table = describeDataSource(source);
  return runWrite(deps, 'add_data_source', { ...input }, `add ${table} to the report`, async () => {
    await addDataSource(deps.reportRepo, input.report_id, source);
    return text(`Data source \`${table}\` added to the report.`);
  });
}
