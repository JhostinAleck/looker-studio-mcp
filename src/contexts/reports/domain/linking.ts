import { DomainError } from '@/shared-kernel/errors/DomainError.js';

import { isQuerySource, type BigQuerySource } from './Report.js';

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
  sources: Array<BigQuerySource & { alias?: string; name?: string }>;
  mode?: 'edit' | 'view';
}

// Builds a Looker Studio Linking API URL that creates a copy of a report
// (or a blank one) already connected to BigQuery tables or custom queries.
export function buildLinkingUrl(req: LinkingRequest): string {
  const params = new URLSearchParams();
  params.set('c.mode', req.mode ?? 'edit');
  if (req.templateReportId) params.set('c.reportId', req.templateReportId);
  params.set('r.reportName', req.reportName);
  req.sources.forEach((source, i) => {
    // Without a template, only the wildcard alias is valid.
    const alias = req.templateReportId ? (source.alias ?? `ds${i}`) : '*';
    const p = `ds.${alias}`;
    params.set(`${p}.connector`, 'bigQuery');
    params.set(`${p}.projectId`, source.projectId);
    if (isQuerySource(source)) {
      if (source.dateRangeParams || source.viewerEmailParam)
        throw new LinkingQueryParametersError();
      params.set(`${p}.type`, 'CUSTOM_QUERY');
      params.set(`${p}.sql`, source.sql);
    } else {
      params.set(`${p}.type`, 'TABLE');
      params.set(`${p}.datasetId`, source.datasetId);
      params.set(`${p}.tableId`, source.tableId);
    }
    if (source.name) params.set(`${p}.datasourceName`, source.name);
  });
  return `https://lookerstudio.google.com/reporting/create?${params.toString()}`;
}
