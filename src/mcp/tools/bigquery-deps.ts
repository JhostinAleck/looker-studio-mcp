import type { QueryLimits } from '@/contexts/bigquery/application/bigqueryUseCases.js';
import type { BigQueryRepository } from '@/contexts/bigquery/domain/BigQueryRepository.js';

export interface BigQueryToolDeps {
  bigQueryRepo: BigQueryRepository;
  defaultProject: string | undefined;
  queryLimits: QueryLimits;
}
