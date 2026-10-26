import { copyReport } from '@/contexts/reports/application/reportUseCases.js';
import { InvalidDataSourceError, isBigQuerySource } from '@/contexts/reports/domain/connectors.js';
import { describeSource } from '@/contexts/reports/domain/Report.js';
import type { DataSourceReplacement } from '@/contexts/reports/domain/reportOps.js';
import { copyReportSchema } from '@/mcp/schemas.js';
import {
  resolveSource,
  runWrite,
  text,
  type ToolResult,
  type WriteDeps,
} from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';
import { checkQuerySource, type SourceCheckDeps } from './source-check.js';

export async function handleCopyReport(
  deps: ReportToolDeps & WriteDeps & SourceCheckDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = copyReportSchema.parse(raw);
  const replacements: DataSourceReplacement[] = input.data_sources.map(
    ({ original, reusable, ...fields }) => {
      if (reusable) {
        if (fields.dataset_id || fields.table_id || fields.sql)
          throw new InvalidDataSourceError(
            `${original}: pass either reusable or a table/sql, not both.`,
          );
        return { original, reusable };
      }
      const source = resolveSource(deps.defaultProject, fields);
      // The copy's data source editor only reconnects to BigQuery.
      if (!isBigQuerySource(source))
        throw new InvalidDataSourceError('copy_report reconnects data sources to BigQuery only.');
      return { original, source };
    },
  );
  for (const r of replacements) if ('source' in r) await checkQuerySource(deps, r.source);
  const plan = replacements
    .map(
      (r) =>
        `${r.original} → ${'source' in r ? describeSource(r.source) : `reusable data source ${r.reusable}`}`,
    )
    .join('; ');
  return runWrite(
    deps,
    'copy_report',
    { ...input },
    `copy the report as "${input.name}"${plan ? ` (${plan})` : ''}`,
    async () => {
      const copy = await copyReport(deps.reportRepo, input.report_id, input.name, replacements);
      const lines = [`Copy **${copy.name}** created.`, `Id: \`${copy.id}\``, copy.url];
      if (copy.replaced.length) lines.push(`Replaced: ${copy.replaced.join('; ')}.`);
      return text(lines.join('\n'));
    },
  );
}
