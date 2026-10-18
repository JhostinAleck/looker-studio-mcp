import type { BigQuerySource } from './Report.js';

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
// (or a blank one) already connected to BigQuery tables.
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
    params.set(`${p}.type`, 'TABLE');
    params.set(`${p}.projectId`, source.projectId);
    params.set(`${p}.datasetId`, source.datasetId);
    params.set(`${p}.tableId`, source.tableId);
    if (source.name) params.set(`${p}.datasourceName`, source.name);
  });
  return `https://lookerstudio.google.com/reporting/create?${params.toString()}`;
}
