import { DomainError } from '@/shared-kernel/errors/DomainError.js';

import { isQuerySource, type BigQuerySource } from './Report.js';
import {
  CONNECTOR_LABEL,
  type DataSource,
  InvalidDataSourceError,
  type SheetsSource,
  connectorOf,
  isSheetsSource,
} from './connectors.js';

// The Linking API documents no parameter for the connector's date range and
// viewer email options, so a link cannot turn them on.
export class LinkingQueryParametersError extends DomainError {
  readonly code = 'LINKING_QUERY_PARAMETERS';
  readonly userMessage =
    'The Linking API cannot enable date range or viewer email parameters. Create the report with create_report or add the source with add_data_source instead.';
}

export interface LinkingRequest {
  reportName: string;
  // Copy this report's layout; without it Looker Studio starts from a blank report.
  templateReportId?: string;
  // One entry per data source. `alias` must match the template's data source alias
  // (ds0, ds1, … shown in Resource › Manage report data sources).
  sources: Array<DataSource & { alias?: string; name?: string }>;
  mode?: 'edit' | 'view';
}

// Builds a Looker Studio Linking API URL that creates a copy of a report
// (or a blank one) already connected to BigQuery tables, custom queries or Google Sheets.
export function buildLinkingUrl(req: LinkingRequest): string {
  const params = new URLSearchParams();
  params.set('c.mode', req.mode ?? 'edit');
  if (req.templateReportId) params.set('c.reportId', req.templateReportId);
  params.set('r.reportName', req.reportName);
  req.sources.forEach((source, i) => {
    // Without a template, only the wildcard alias is valid.
    const alias = req.templateReportId ? (source.alias ?? `ds${i}`) : '*';
    const p = `ds.${alias}`;
    if (isSheetsSource(source)) {
      setSheetsParams(params, p, source);
      return;
    }
    if (connectorOf(source) !== 'bigquery')
      throw new InvalidDataSourceError(
        `The Linking API has no ${CONNECTOR_LABEL[connectorOf(source)]} connector: use create_report or add_data_source.`,
      );
    const bq = source as BigQuerySource & { name?: string };
    params.set(`${p}.connector`, 'bigQuery');
    params.set(`${p}.projectId`, bq.projectId);
    if (isQuerySource(bq)) {
      if (bq.dateRangeParams || bq.viewerEmailParam) throw new LinkingQueryParametersError();
      params.set(`${p}.type`, 'CUSTOM_QUERY');
      params.set(`${p}.sql`, bq.sql);
    } else {
      params.set(`${p}.type`, 'TABLE');
      params.set(`${p}.datasetId`, bq.datasetId);
      params.set(`${p}.tableId`, bq.tableId);
    }
    if (bq.name) params.set(`${p}.datasourceName`, bq.name);
  });
  return `https://lookerstudio.google.com/reporting/create?${params.toString()}`;
}

// ds.*.connector=googleSheets: the tab is addressed by its gid, not its name.
function setSheetsParams(params: URLSearchParams, p: string, source: SheetsSource): void {
  if (!source.worksheetId)
    throw new InvalidDataSourceError(
      'The Linking API addresses a Google Sheets tab by worksheet_id (the number after #gid= in its URL), not by name.',
    );
  params.set(`${p}.connector`, 'googleSheets');
  params.set(`${p}.spreadsheetId`, source.spreadsheetId);
  params.set(`${p}.worksheetId`, source.worksheetId);
  params.set(`${p}.hasHeader`, String(source.hasHeader));
  params.set(`${p}.includeHiddenCells`, String(source.includeHiddenAndFiltered));
  params.set(`${p}.includeFilteredCells`, String(source.includeHiddenAndFiltered));
  if (source.range) params.set(`${p}.range`, source.range);
  if (source.name) params.set(`${p}.datasourceName`, source.name);
}
