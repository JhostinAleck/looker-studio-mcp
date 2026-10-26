import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
  createReport,
  inOneVisit,
  listComponents,
  dataSourceNames,
  fieldNames,
  listPages,
} from '@/contexts/reports/application/reportUseCases.js';
import { parseReportId, reportUrl } from '@/contexts/reports/domain/Report.js';
import {
  type ReportSpec,
  type SpecTarget,
  dataSourceName,
  specToActions,
} from '@/mcp/report-spec.js';
import { applyReportSpecSchema, reportSpecSchema } from '@/mcp/schemas.js';
import { resolveSource, runWrite, text, type ToolResult } from '@/mcp/tool-helpers.js';
import { DomainError } from '@/shared-kernel/errors/DomainError.js';
import { expandPath } from '@/shared-kernel/path/expandPath.js';

import { type BatchDeps, checkActions, formatResults, runActions } from './batch-actions.js';

class NoFirstSourceError extends DomainError {
  readonly code = 'SPEC_NO_SOURCE';
  readonly userMessage =
    'A new report needs a data source: the spec has no data_sources (pass report_id to update an existing report).';
}

class SpecInputError extends DomainError {
  readonly code = 'SPEC_INPUT';
  constructor(readonly userMessage: string) {
    super(userMessage);
  }
}

// Stands in for the report while the actions are checked, before it exists.
const CHECK_ID = '00000000-0000-4000-8000-000000000000';

// The spec, and the folder its relative image paths start from.
function loadSpec(input: { spec?: ReportSpec | undefined; spec_path?: string | undefined }): {
  spec: ReportSpec;
  baseDir: string;
} {
  if (!!input.spec === !!input.spec_path)
    throw new SpecInputError('Pass the spec as `spec` or as a file in `spec_path` (one of them).');
  if (input.spec) return { spec: input.spec, baseDir: process.cwd() };
  const path = resolve(expandPath(input.spec_path!));
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new SpecInputError(`Could not read the spec file ${path}: ${(err as Error).message}`);
  }
  return { spec: reportSpecSchema.parse(raw), baseDir: dirname(path) };
}

// Image files exported next to a spec are named relative to it.
function withImagePaths(spec: ReportSpec, baseDir: string): ReportSpec {
  return {
    ...spec,
    pages: spec.pages.map((p) => ({
      ...p,
      components: p.components.map((c) =>
        c.component === 'image' && !/^(https:|data:)/i.test(c.image) && !isAbsolute(c.image)
          ? { ...c, image: resolve(baseDir, expandPath(c.image)) }
          : c,
      ),
    })),
  };
}

export async function handleApplyReportSpec(deps: BatchDeps, raw: unknown): Promise<ToolResult> {
  const input = applyReportSpecSchema.parse(raw);
  const loaded = loadSpec(input);
  const spec = withImagePaths(loaded.spec, loaded.baseDir);
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
  // The spec itself can carry images: the audit keeps its name.
  const audited = { ...input, spec: `<spec "${spec.name}", ${spec.pages.length} pages>` };
  return runWrite(deps, 'apply_report_spec', audited, what, async () => {
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
        const known = await fieldNames(deps.reportRepo, id);
        target = {
          pages: pages.map((p) => p.name),
          layouts,
          dataSources: await dataSourceNames(deps.reportRepo, id),
          fields: known.fields,
          blends: known.blends,
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
