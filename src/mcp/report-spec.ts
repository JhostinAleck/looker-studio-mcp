import type { z } from 'zod';

import { isQuerySource } from '@/contexts/reports/domain/Report.js';
import type {
  ComponentSnapshot,
  ReportSnapshot,
} from '@/contexts/reports/domain/ReportRepository.js';
import type { reportSpecSchema, specComponentSchema } from '@/mcp/schemas.js';

import type { BatchAction } from './tools/batch-actions.js';

export type ReportSpec = z.output<typeof reportSpecSchema>;
export type ReportSpecInput = z.input<typeof reportSpecSchema>;
type SpecComponent = z.input<typeof specComponentSchema>;

function componentSpec(c: ComponentSnapshot): SpecComponent {
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
        ...(chart.fields ? { fields: chart.fields } : {}),
        ...(chart.title ? { title: chart.title } : {}),
        ...(c.dataSource ? { data_source: c.dataSource } : {}),
        layout: c.layout,
        ...style,
      };
    }
    case 'text':
      return {
        component: 'text',
        text: c.text.text,
        ...(c.text.fontSize ? { font_size: c.text.fontSize } : {}),
        ...(c.text.color ? { color: c.text.color } : {}),
        ...(c.text.bold ? { bold: true } : {}),
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
        layout: c.layout,
        ...style,
      };
    case 'image':
      return c.url
        ? { component: 'image', image: c.url, layout: c.layout, ...style }
        : { component: 'other', panel: 'Image (uploaded file, no URL)', layout: c.layout };
    case 'line':
      return { component: 'line', from: c.from, to: c.to };
    case 'embed':
      return c.url
        ? { component: 'embed', url: c.url, layout: c.layout, ...style }
        : { component: 'other', panel: 'URL embed (no URL)', layout: c.layout };
    case 'other':
      return { component: 'other', panel: c.panel, layout: c.layout };
  }
}

// What export_report_spec returns: the snapshot in the tools' own argument names.
export function snapshotToSpec(snapshot: ReportSnapshot): ReportSpecInput {
  const theme = {
    ...(snapshot.theme ? { preset: snapshot.theme } : {}),
    ...(snapshot.canvas ? { canvas: snapshot.canvas } : {}),
  };
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
    pages: snapshot.pages.map((p) => ({
      name: p.name,
      components: p.components.map(componentSpec),
    })),
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
// data sources, calculated fields, pages (by name) and components (by their
// box on the page) are added.
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
  for (const field of spec.calculated_fields ?? [])
    actions.push({ tool: 'add_calculated_field', args: { ...field } });

  let pageCount = target.pages.length;
  for (const [i, page] of spec.pages.entries()) {
    let index = target.pages.indexOf(page.name) + 1;
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
      const box = 'layout' in args ? args.layout : undefined;
      if (box && existing.some((l) => sameBox(box, l))) continue;
      actions.push({ tool: COMPONENT_TOOL[kind], args: { ...args, page: index } });
    }
  }
  return { actions, notes };
}
