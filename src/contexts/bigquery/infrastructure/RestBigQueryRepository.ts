import type { BigQueryRepository } from '@/contexts/bigquery/domain/BigQueryRepository.js';
import type {
  Dataset,
  Field,
  QueryRequest,
  QueryResult,
  Row,
  Table,
  TableRef,
  TableSummary,
  TableType,
  ViewRequest,
} from '@/contexts/bigquery/domain/BigQuery.js';
import { viewDdl } from '@/contexts/bigquery/domain/sql.js';
import type { GoogleApiClient } from '@/contexts/google-api/infrastructure/GoogleApiClient.js';

const BASE = 'https://bigquery.googleapis.com/bigquery/v2';

interface ApiField {
  name: string;
  type: string;
  mode?: string;
  description?: string;
  fields?: ApiField[];
}

interface ApiCell {
  v: unknown;
}

interface ApiQueryResponse {
  jobComplete?: boolean;
  jobReference?: { jobId: string; location?: string };
  schema?: { fields?: ApiField[] };
  rows?: Array<{ f: ApiCell[] }>;
  totalRows?: string;
  totalBytesProcessed?: string;
  cacheHit?: boolean;
}

const enc = encodeURIComponent;

function toField(f: ApiField): Field {
  return {
    name: f.name,
    type: f.type,
    mode: (f.mode as Field['mode'] | undefined) ?? 'NULLABLE',
    description: f.description ?? null,
    fields: (f.fields ?? []).map(toField),
  };
}

// BigQuery returns every cell as a string inside {f: [{v}]}; this restores the types.
export function decodeValue(field: Field, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (field.mode === 'REPEATED') {
    return (value as ApiCell[]).map((cell) => decodeValue({ ...field, mode: 'NULLABLE' }, cell.v));
  }
  switch (field.type) {
    case 'RECORD':
    case 'STRUCT':
      return decodeRow(field.fields, value as { f: ApiCell[] });
    case 'INTEGER':
    case 'INT64': {
      const n = Number(value);
      return Number.isSafeInteger(n) ? n : String(value);
    }
    case 'FLOAT':
    case 'FLOAT64':
    case 'NUMERIC':
    case 'BIGNUMERIC':
      return Number(value);
    case 'BOOLEAN':
    case 'BOOL':
      return value === 'true' || value === true;
    case 'TIMESTAMP':
      return new Date(Number(value) * 1000).toISOString();
    default:
      return value;
  }
}

export function decodeRow(schema: Field[], row: { f: ApiCell[] }): Row {
  const out: Row = {};
  schema.forEach((field, i) => {
    out[field.name] = decodeValue(field, row.f[i]?.v);
  });
  return out;
}

export class RestBigQueryRepository implements BigQueryRepository {
  constructor(private readonly api: GoogleApiClient) {}

  async listDatasets(projectId: string): Promise<Dataset[]> {
    const out: Dataset[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.api.get<{
        datasets?: Array<{ datasetReference: { datasetId: string }; location?: string }>;
        nextPageToken?: string;
      }>(
        `${BASE}/projects/${enc(projectId)}/datasets?all=false${pageToken ? `&pageToken=${enc(pageToken)}` : ''}`,
      );
      for (const d of res.datasets ?? []) {
        out.push({
          projectId,
          datasetId: d.datasetReference.datasetId,
          location: d.location ?? null,
          description: null,
        });
      }
      pageToken = res.nextPageToken;
    } while (pageToken);
    return out;
  }

  async listTables(projectId: string, datasetId: string): Promise<TableSummary[]> {
    const out: TableSummary[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.api.get<{
        tables?: Array<{ tableReference: { tableId: string }; type: TableType }>;
        nextPageToken?: string;
      }>(
        `${BASE}/projects/${enc(projectId)}/datasets/${enc(datasetId)}/tables?maxResults=1000${pageToken ? `&pageToken=${enc(pageToken)}` : ''}`,
      );
      for (const t of res.tables ?? []) {
        out.push({ projectId, datasetId, tableId: t.tableReference.tableId, type: t.type });
      }
      pageToken = res.nextPageToken;
    } while (pageToken);
    return out;
  }

  async getTable(ref: TableRef): Promise<Table> {
    const t = await this.api.get<{
      type: TableType;
      description?: string;
      numRows?: string;
      schema?: { fields?: ApiField[] };
      view?: { query?: string };
    }>(
      `${BASE}/projects/${enc(ref.projectId)}/datasets/${enc(ref.datasetId)}/tables/${enc(ref.tableId)}`,
    );
    return {
      ...ref,
      type: t.type,
      description: t.description ?? null,
      rowCount: t.numRows === undefined ? null : Number(t.numRows),
      schema: (t.schema?.fields ?? []).map(toField),
      viewQuery: t.view?.query ?? null,
    };
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    let res = await this.api.post<ApiQueryResponse>(
      `${BASE}/projects/${enc(request.projectId)}/queries`,
      {
        query: request.sql,
        useLegacySql: false,
        location: request.location,
        maxResults: request.maxRows,
        maximumBytesBilled: String(request.maxBytesBilled),
        timeoutMs: 30_000,
        dryRun: request.dryRun ?? false,
      },
    );
    // Long queries come back incomplete; poll the job until it finishes.
    while (!request.dryRun && res.jobComplete === false && res.jobReference) {
      const { jobId, location } = res.jobReference;
      res = await this.api.get<ApiQueryResponse>(
        `${BASE}/projects/${enc(request.projectId)}/queries/${enc(jobId)}?maxResults=${request.maxRows}&timeoutMs=30000${location ? `&location=${enc(location)}` : ''}`,
      );
    }
    const schema = (res.schema?.fields ?? []).map(toField);
    const rows = (res.rows ?? []).slice(0, request.maxRows).map((r) => decodeRow(schema, r));
    const totalRows = Number(res.totalRows ?? rows.length);
    return {
      schema,
      rows,
      totalRows,
      bytesProcessed: Number(res.totalBytesProcessed ?? 0),
      cacheHit: res.cacheHit ?? false,
      truncated: totalRows > rows.length,
    };
  }

  async createOrReplaceView(request: ViewRequest): Promise<void> {
    await this.api.post(`${BASE}/projects/${enc(request.projectId)}/queries`, {
      query: viewDdl(request, request.sql, request.description),
      useLegacySql: false,
      location: request.location,
    });
  }

  async deleteTable(ref: TableRef): Promise<void> {
    await this.api.delete(
      `${BASE}/projects/${enc(ref.projectId)}/datasets/${enc(ref.datasetId)}/tables/${enc(ref.tableId)}`,
    );
  }
}
