import {
  type DataSettings,
  InvalidChartError,
  type MetricSpec,
  validateDataSettings,
} from './Report.js';

// A community visualization comes from the gallery (by its card name) or from
// a manifest the user deployed ("Build your own visualization").
export type CommunityVizSource = { gallery: string } | { manifestPath: string };

export interface CommunityVizSpec extends DataSettings {
  source: CommunityVizSource;
  dimensions: string[];
  metrics: MetricSpec[];
  title?: string;
}

const MANIFEST_RE = /^gs:\/\/[a-z0-9][a-z0-9._-]*[a-z0-9](\/[^\s]*)?$/;

export function describeCommunityViz(source: CommunityVizSource): string {
  return 'gallery' in source
    ? `community visualization "${source.gallery}"`
    : `community visualization from ${source.manifestPath}`;
}

export function validateCommunityViz(spec: CommunityVizSpec): CommunityVizSpec {
  const source = spec.source;
  if ('gallery' in source) {
    if (!source.gallery.trim())
      throw new InvalidChartError('Name the community visualization as the gallery lists it.');
  } else {
    if (!MANIFEST_RE.test(source.manifestPath.trim()))
      throw new InvalidChartError(
        `manifest_path must be a Cloud Storage path such as gs://my-bucket/my-viz, got "${source.manifestPath}".`,
      );
  }
  if (spec.dimensions.some((d) => !d.trim()) || spec.metrics.some((m) => !m.field.trim()))
    throw new InvalidChartError('Field names cannot be empty.');
  validateDataSettings(spec);
  return spec;
}
