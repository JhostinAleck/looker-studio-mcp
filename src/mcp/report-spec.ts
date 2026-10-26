import type { z } from 'zod';

import type { DataSettings, FilterSpec } from '@/contexts/reports/domain/Report.js';
import { isQuerySource } from '@/contexts/reports/domain/Report.js';
import type {
  ComponentSnapshot,
  ImageFile,
  ReportSnapshot,
  ScopeSettings,
} from '@/contexts/reports/domain/ReportRepository.js';
import type { reportSpecSchema, specComponentSchema } from '@/mcp/schemas.js';

import type { BatchAction } from './tools/batch-actions.js';

export type ReportSpec = z.output<typeof reportSpecSchema>;
export type ReportSpecInput = z.input<typeof reportSpecSchema>;
type SpecComponent = z.input<typeof specComponentSchema>;

// Where an exported image goes: a file path or data: URI for `image`, or
// undefined to keep the component as "other" (with the reason).
export type ImageSink = (
  file: ImageFile,
  where: { page: number; index: number },
) => { image: string } | { skipped: string };

// Without a sink images are left out.
const noImages: ImageSink = () => ({ skipped: 'pass `path` to export the image file' });

// The domain's filter in the tools' argument names (the same keys).
function filterArgs(f: FilterSpec): FilterSpec {
  return f;
}

// DataSettings in the tools' argument names.
function dataArgs(d: DataSettings): Record<string, unknown> {
  return {
    ...(d.fields && Object.keys(d.fields).length ? { fields: d.fields } : {}),
    ...(d.filters?.length ? { filters: d.filters.map(filterArgs) } : {}),
    ...(d.dateRange ? { date_range: d.dateRange } : {}),
    ...(d.comparison ? { comparison: d.comparison } : {}),
    ...(d.series?.length ? { series: d.series } : {}),
    ...(d.valueColors && Object.keys(d.valueColors).length ? { value_colors: d.valueColors } : {}),
    ...(d.sorts?.length ? { sorts: d.sorts } : {}),
    ...(d.referenceLines?.length ? { reference_lines: d.referenceLines } : {}),
    ...(d.referenceBands?.length ? { reference_bands: d.referenceBands } : {}),
    ...(d.conditionalFormats?.length
      ? {
          conditional_formats: d.conditionalFormats.map((f) => ({
            rules: f.rules,
            ...(f.applyTo ? { apply_to: f.applyTo } : {}),
            ...(f.fontColor ? { font_color: f.fontColor } : {}),
            ...(f.backgroundColor ? { background_color: f.backgroundColor } : {}),
          })),
        }
      : {}),
  };
}

function scopeArgs(s: ScopeSettings): Record<string, unknown> {
  return {
    ...(s.dataSource ? { data_source: s.dataSource } : {}),
    ...(s.filters?.length ? { filters: s.filters.map(filterArgs) } : {}),
    ...(s.dateRangeDimension ? { date_range_dimension: s.dateRangeDimension } : {}),
    ...(s.dateRange ? { date_range: s.dateRange } : {}),
    ...(s.style && Object.keys(s.style).length ? { style: s.style } : {}),
  };
}

function componentSpec(
  c: ComponentSnapshot,
  images: ImageSink,
  where: { page: number; index: number },
): SpecComponent {
  const style = 'style' in c && c.style ? { style: c.style } : {};
  switch (c.kind) {
    case 'chart': {
      const chart = c.chart;
      return {
        component: 'chart',
        type: chart.type,
        dimensions: chart.dimensions,
        metrics: chart.metrics.map((m) => ({
          field: m.field,
          ...(m.aggregation ? { aggregation: m.aggregation } : {}),
          ...(m.label ? { label: m.label } : {}),
        })),
        ...(chart.breakdown ? { breakdown: chart.breakdown } : {}),
        ...(chart.sortBy ? { sort_by: chart.sortBy, sort_ascending: !!chart.sortAscending } : {}),
        ...(chart.title ? { title: chart.title } : {}),
        ...(chart.labels && Object.keys(chart.labels).length ? { labels: chart.labels } : {}),
        ...(c.dataSource ? { data_source: c.dataSource } : {}),
        ...dataArgs(chart),
        layout: c.layout,
        ...style,
      } as SpecComponent;
    }
    case 'text':
      return {
        component: 'text',
        text: c.text.text,
        ...(c.text.fontSize ? { font_size: c.text.fontSize } : {}),
        ...(c.text.color ? { color: c.text.color } : {}),
        ...(c.text.bold ? { bold: true } : {}),
        ...(c.text.italic ? { italic: true } : {}),
        ...(c.text.underline ? { underline: true } : {}),
        ...(c.text.strikethrough ? { strikethrough: true } : {}),
        ...(c.text.background ? { background: c.text.background } : {}),
        ...(c.text.align ? { align: c.text.align } : {}),
        layout: c.layout,
        ...style,
      };
    case 'shape':
      return {
        component: 'shape',
        shape: c.shape.shape,
        ...(c.shape.background ? { background: c.shape.background } : {}),
        ...(c.shape.borderColor ? { border_color: c.shape.borderColor } : {}),
        ...(c.shape.borderRadius ? { border_radius: c.shape.borderRadius } : {}),
        layout: c.layout,
        ...style,
      };
    case 'control':
      return {
        component: 'control',
        kind: c.control,
        ...(c.field ? { field: c.field } : {}),
        ...(c.metric ? { metric: c.metric } : {}),
        ...(c.dataSource ? { data_source: c.dataSource } : {}),
        ...(c.data ? dataArgs(c.data) : {}),
        layout: c.layout,
        ...style,
      } as SpecComponent;
    case 'image': {
      const alt = c.altText ? { alt_text: c.altText } : {};
      if (c.url) return { component: 'image', image: c.url, ...alt, layout: c.layout, ...style };
      const sunk = c.file ? images(c.file, where) : { skipped: 'its file could not be read' };
      return 'image' in sunk
        ? { component: 'image', image: sunk.image, ...alt, layout: c.layout, ...style }
        : {
            component: 'other',
            panel: `Image ${c.file?.name ?? ''} (${sunk.skipped})`.replace('  ', ' '),
            layout: c.layout,
          };
    }
    case 'line':
      return {
        component: 'line',
        from: c.from,
        to: c.to,
        ...(c.color ? { color: c.color } : {}),
        ...(c.borderStyle ? { border_style: c.borderStyle } : {}),
        ...style,
      };
    case 'embed':
      return c.url
        ? { component: 'embed', url: c.url, layout: c.layout, ...style }
        : { component: 'other', panel: 'URL embed (no URL)', layout: c.layout };
    case 'other':
      return { component: 'other', panel: c.panel, layout: c.layout };
  }
}

// What export_report_spec returns: the snapshot in the tools' own argument names.
export function snapshotToSpec(
  snapshot: ReportSnapshot,
  images: ImageSink = noImages,
): ReportSpecInput {
  const theme = {
    ...(snapshot.theme ? { preset: snapshot.theme } : {}),
    ...(snapshot.canvas ? { canvas: snapshot.canvas } : {}),
  };
  const fields = snapshot.fields ?? [];
  // Field definitions name their data source only when the report has several.
  const several = snapshot.dataSources.length > 1;
  const on = (dataSource: string) => (several ? { data_source: dataSource } : {});
  const parameters = fields.flatMap((f) =>
    f.parameters.map((p) => ({
      name: p.name,
      ...(p.id ? { id: p.id } : {}),
      ...(p.dataType ? { data_type: p.dataType } : {}),
      ...(p.values ? { values: p.values } : {}),
      ...(p.defaultValue !== undefined ? { default_value: p.defaultValue } : {}),
      ...on(f.dataSource),
    })),
  );
  const calculated = fields.flatMap((f) =>
    f.calculatedFields.map((c) => ({ ...c, ...on(f.dataSource) })),
  );
  const groups = fields.flatMap((f) =>
    f.groups.map((g) => ({
      name: g.name,
      field: g.field,
      groups: g.groups.map((x) => ({
        name: x.name,
        condition: x.condition,
        values: x.values,
        ...(x.exclude ? { exclude: true } : {}),
      })),
      ...(g.otherGroup ? { other_group: g.otherGroup } : {}),
      ...on(f.dataSource),
    })),
  );
  const bins = fields.flatMap((f) => f.bins.map((b) => ({ ...b, ...on(f.dataSource) })));
  const report = snapshot.settings ? scopeArgs({ ...snapshot.settings, style: {} }) : {};
  return {
    version: 1,
    name: snapshot.name,
    ...(Object.keys(theme).length ? { theme } : {}),
    data_sources: snapshot.dataSources.flatMap((d): ReportSpecInput['data_sources'] & object => {
      if (!d.source) return [];
      const s = d.source;
      return isQuerySource(s)
        ? [{ name: d.name, project_id: s.projectId, sql: s.sql }]
        : [{ name: d.name, project_id: s.projectId, dataset_id: s.datasetId, table_id: s.tableId }];
    }),
    ...(parameters.length ? { parameters } : {}),
    ...(calculated.length ? { calculated_fields: calculated } : {}),
    ...(groups.length ? { group_fields: groups } : {}),
    ...(bins.length ? { bin_fields: bins } : {}),
    ...(snapshot.blends?.length
      ? {
          blends: snapshot.blends.map((b) => ({
            name: b.name,
            tables: b.tables.map((t) => ({
              data_source: t.dataSource,
              dimensions: t.dimensions,
              metrics: t.metrics,
            })),
            joins: b.joins.map((j) => ({ ...(j.type ? { type: j.type } : {}), keys: j.keys })),
          })),
        }
      : {}),
    ...(Object.keys(report).length ? { report_settings: report } : {}),
    pages: snapshot.pages.map((p, i) => {
      const settings = p.settings ? scopeArgs(p.settings) : {};
      return {
        name: p.name,
        ...(Object.keys(settings).length ? { settings } : {}),
        components: p.components.map((c, index) =>
          componentSpec(c, images, { page: i + 1, index }),
        ),
      };
    }),
  };
}

const COMPONENT_TOOL: Record<Exclude<SpecComponent['component'], 'other'>, string> = {
  chart: 'add_chart',
  text: 'add_text',
  shape: 'add_shape',
  control: 'add_control',
  image: 'add_image',
  line: 'add_line',
  embed: 'add_embed',
};

// What the target report already has. A new report has one empty page and
// the spec's first data source.
export interface SpecTarget {
  pages: string[];
  // Component boxes per existing page, in page order.
  layouts: Array<Array<{ x: number; y: number; width: number; height: number }>>;
  dataSources: string[];
  // Field and parameter names per data source, and blend names.
  fields?: Record<string, string[]>;
  blends?: string[];
  // A new report: its first page takes the name of the spec's first page.
  fresh: boolean;
}

export function dataSourceName(d: ReportSpec['data_sources'][number]): string {
  return d.name ?? d.table_id ?? 'custom query';
}

function sameBox(
  a: {
    x?: number | undefined;
    y?: number | undefined;
    width?: number | undefined;
    height?: number | undefined;
  },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  const near = (u: number | undefined, v: number) => u === undefined || Math.abs(u - v) <= 4;
  return near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
}

// The apply_actions list that builds the spec on top of `target`, and notes
// on what it leaves out. Nothing in the target is changed or removed: missing
// data sources, fields, parameters and blends (by name), pages (by name) and
// components (by their box on the page) are added. Page settings are applied
// to the pages this adds, report settings to a new report.
export function specToActions(
  spec: ReportSpec,
  target: SpecTarget,
): { actions: BatchAction[]; notes: string[] } {
  const actions: BatchAction[] = [];
  const notes: string[] = [];
  if (spec.theme && Object.keys(spec.theme).length)
    actions.push({ tool: 'set_theme', args: { ...spec.theme } });
  for (const source of spec.data_sources) {
    if (target.dataSources.includes(dataSourceName(source))) continue;
    actions.push({
      tool: 'add_data_source',
      args: source.sql
        ? {
            project_id: source.project_id,
            sql: source.sql,
            ...(source.name ? { source_name: source.name } : {}),
          }
        : {
            project_id: source.project_id,
            dataset_id: source.dataset_id,
            table_id: source.table_id,
          },
    });
  }
  // A field without data_source belongs to the report's only data source.
  const only = spec.data_sources.length === 1 ? dataSourceName(spec.data_sources[0]!) : undefined;
  const has = (field: { name: string; data_source?: string | undefined }) => {
    const source = field.data_source ?? only;
    return !!source && !!target.fields?.[source]?.includes(field.name);
  };
  // Parameters first: formulas can use them; groups and bins can use calculated fields.
  const fieldActions: Array<[string, Array<{ name: string; data_source?: string | undefined }>]> = [
    ['add_parameter', spec.parameters ?? []],
    ['add_calculated_field', spec.calculated_fields ?? []],
    ['add_group_field', spec.group_fields ?? []],
    ['add_bin_field', spec.bin_fields ?? []],
  ];
  for (const [tool, fields] of fieldActions)
    for (const field of fields) if (!has(field)) actions.push({ tool, args: { ...field } });
  for (const blend of spec.blends ?? [])
    if (!target.blends?.includes(blend.name))
      actions.push({ tool: 'create_blend', args: { ...blend } });

  let pageCount = target.pages.length;
  for (const [i, page] of spec.pages.entries()) {
    let index = target.pages.indexOf(page.name) + 1;
    const added = index === 0;
    if (index === 0 && i === 0 && target.fresh) {
      actions.push({ tool: 'rename_page', args: { page: 1, name: page.name } });
      index = 1;
    } else if (index === 0) {
      actions.push({ tool: 'add_page', args: { name: page.name } });
      index = ++pageCount;
    }
    const existing = target.layouts[index - 1] ?? [];
    for (const [n, component] of page.components.entries()) {
      const where = `page "${page.name}" component ${n}`;
      if (component.component === 'other') {
        notes.push(`${where} (${component.panel}) cannot be rebuilt; skipped.`);
        continue;
      }
      const { component: kind, ...args } = component;
      // A line's box runs from one end to the other.
      const box =
        'layout' in args
          ? args.layout
          : 'from' in args
            ? {
                x: Math.min(args.from.x, args.to.x),
                y: Math.min(args.from.y, args.to.y),
                width: Math.abs(args.to.x - args.from.x),
                height: Math.abs(args.to.y - args.from.y),
              }
            : undefined;
      if (box && existing.some((l) => sameBox(box, l))) continue;
      actions.push({ tool: COMPONENT_TOOL[kind], args: { ...args, page: index } });
    }
    // After the components: page filters need a chart with data on the page.
    if (page.settings && Object.keys(page.settings).length) {
      if (added || target.fresh)
        actions.push({
          tool: 'set_page_settings',
          args: { ...page.settings, scope: 'page', page: index },
        });
      else notes.push(`page "${page.name}" exists: its settings were left as they are.`);
    }
  }
  if (spec.report_settings && Object.keys(spec.report_settings).length) {
    if (target.fresh)
      actions.push({
        tool: 'set_page_settings',
        args: { ...spec.report_settings, scope: 'report' },
      });
    else notes.push('The report settings were left as they are (applied to new reports only).');
  }
  return { actions, notes };
}
