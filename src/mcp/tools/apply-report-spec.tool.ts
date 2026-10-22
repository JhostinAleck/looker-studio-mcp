import {
  createReport,
  inOneVisit,
  listComponents,
  listDataSources,
  listPages,
} from '@/contexts/reports/application/reportUseCases.js';
import { parseReportId, reportUrl } from '@/contexts/reports/domain/Report.js';
import { type SpecTarget, dataSourceName, specToActions } from '@/mcp/report-spec.js';
import { applyReportSpecSchema } from '@/mcp/schemas.js';
import { resolveSource, runWrite, text, type ToolResult } from '@/mcp/tool-helpers.js';
import { DomainError } from '@/shared-kernel/errors/DomainError.js';

import { type BatchDeps, checkActions, formatResults, runActions } from './batch-actions.js';

class NoFirstSourceError extends DomainError {
  readonly code = 'SPEC_NO_SOURCE';
  readonly userMessage =
    'A new report needs a data source: the spec has no data_sources (pass report_id to update an existing report).';
}

// Stands in for the report while the actions are checked, before it exists.
const CHECK_ID = '00000000-0000-4000-8000-000000000000';

export async function handleApplyReportSpec(deps: BatchDeps, raw: unknown): Promise<ToolResult> {
  const input = applyReportSpecSchema.parse(raw);
  const spec = input.spec;
  const name = input.name ?? spec.name;
  const existing = input.report_id ? parseReportId(input.report_id) : undefined;
  const first = spec.data_sources[0];
  if (!existing && !first) throw new NoFirstSourceError();
  const source = first
    ? resolveSource(deps.defaultProject, {
        project_id: first.project_id,
        dataset_id: first.dataset_id,
        table_id: first.table_id,
        sql: first.sql,
        ...(first.sql && first.name ? { source_name: first.name } : {}),
      })
    : undefined;
  // Every action the spec can produce is checked before the browser opens.
  const all = specToActions(spec, { pages: [], layouts: [], dataSources: [], fresh: true });
  await checkActions(deps, existing ?? CHECK_ID, all.actions);

  const what = existing
    ? `add the missing parts of spec "${spec.name}" to report ${existing}`
    : `create report "${name}" from a spec (${spec.pages.length} pages)`;
  return runWrite(deps, 'apply_report_spec', { ...input }, what, async () => {
    const started = Date.now();
    const lines: string[] = [];
    let reportId = existing;
    if (!reportId) {
      const created = await createReport(deps.reportRepo, name, source!);
      reportId = created.id;
      lines.push(`Created **${name}**: \`${created.id}\`\n${created.url}`);
    } else lines.push(`Updated ${reportUrl(reportId)}`);
    const fresh = !existing;
    const { results, notes } = await inOneVisit(deps.reportRepo, reportId, async (id) => {
      let target: SpecTarget = {
        pages: ['Page 1'],
        layouts: [[]],
        dataSources: first ? [dataSourceName(first)] : [],
        fresh,
      };
      if (!fresh) {
        const pages = await listPages(deps.reportRepo, id);
        const layouts = [];
        for (const page of pages)
          layouts.push(
            (await listComponents(deps.reportRepo, id, page.index)).map((c) => c.layout),
          );
        target = {
          pages: pages.map((p) => p.name),
          layouts,
          dataSources: await listDataSources(deps.reportRepo, id),
          fresh,
        };
      }
      const plan = specToActions(spec, target);
      return {
        results: await runActions(deps, id, plan.actions, input.continue_on_error),
        notes: plan.notes,
      };
    });
    lines.push(
      results.length ? formatResults(results, Date.now() - started) : 'Nothing was missing.',
    );
    lines.push(...notes);
    const result = text(lines.join('\n'));
    return results.some((r) => r.status === 'error') ? { ...result, isError: true } : result;
  });
}
