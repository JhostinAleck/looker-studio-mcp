import type {
  Dataset,
  QueryRequest,
  QueryResult,
  Table,
  TableRef,
  TableSummary,
  ViewRequest,
} from './BigQuery.js';

export interface BigQueryRepository {
  listDatasets(projectId: string): Promise<Dataset[]>;
  listTables(projectId: string, datasetId: string): Promise<TableSummary[]>;
  getTable(ref: TableRef): Promise<Table>;
  query(request: QueryRequest): Promise<QueryResult>;
  createOrReplaceView(request: ViewRequest): Promise<void>;
  deleteTable(ref: TableRef): Promise<void>;
}
