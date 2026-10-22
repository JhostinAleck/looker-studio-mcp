import { checkSourceQuery } from '@/contexts/bigquery/application/bigqueryUseCases.js';
import {
  isQuerySource,
  sampleQueryParameters,
  type BigQuerySource,
} from '@/contexts/reports/domain/Report.js';

import type { BigQueryToolDeps } from './bigquery-deps.js';

export type SourceCheckDeps = Pick<BigQueryToolDeps, 'bigQueryRepo' | 'queryLimits'>;

// A custom query is dry-run in BigQuery before Looker Studio sees it: the
// connector only shows a failing query as a dialog error the editor cannot read.
export async function checkQuerySource(
  deps: SourceCheckDeps,
  source: BigQuerySource,
): Promise<void> {
  if (!isQuerySource(source)) return;
  const parameters = sampleQueryParameters(source);
  await checkSourceQuery(
    deps.bigQueryRepo,
    {
      projectId: source.projectId,
      sql: source.sql,
      ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
    },
    deps.queryLimits,
  );
}
