import { listDataSources } from '@/contexts/reports/application/reportUseCases.js';
import type { DataSourceInfo } from '@/contexts/reports/domain/DataSource.js';
import { listDataSourcesSchema } from '@/mcp/schemas.js';
import { text, type ToolResult } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

const KIND: Record<DataSourceInfo['kind'], string> = {
  table: 'table/view',
  custom_query: 'custom query',
  other: 'other',
};

export function formatDataSource(s: DataSourceInfo): string {
  const lines = [`- **${s.name}** (${s.alias}) — ${s.connector}, ${KIND[s.kind]}, ${s.scope}`];
  if (s.table) lines.push(`  table: \`${s.table}\``);
  if (s.billingProject) lines.push(`  billing project: ${s.billingProject}`);
  if (s.sql) lines.push(`  sql:\n\`\`\`sql\n${s.sql}\n\`\`\``);
  lines.push(`  used in report: ${s.usedIn || '?'} · status: ${s.status || '?'}`);
  if (s.credentials || s.freshness)
    lines.push(
      `  data credentials: ${s.credentials ?? '?'} · data freshness: ${s.freshness ?? '?'}`,
    );
  for (const f of s.fields ?? [])
    lines.push(`  - \`${f.name}\` ${f.type}, ${f.kind}, aggregation ${f.aggregation}`);
  return lines.join('\n');
}

export async function handleListDataSources(
  deps: ReportToolDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = listDataSourcesSchema.parse(raw);
  const sources = await listDataSources(deps.reportRepo, input.report_id, {
    ...(input.data_source ? { ref: input.data_source } : {}),
    fields: input.fields,
  });
  if (sources.length === 0) return text('The report has no data sources.');
  return text(`Data sources:\n${sources.map(formatDataSource).join('\n')}`);
}
