import type { ComponentInfo, Layout, SettingInfo } from '@/contexts/reports/domain/Report.js';

export function formatLayout(l: Layout): string {
  return `x ${l.x}, y ${l.y}, ${l.width}x${l.height}`;
}

export function formatComponent(c: ComponentInfo): string {
  return `#${c.index} ${c.kind.replace(/ properties$/, '')} at ${formatLayout(c.layout)}`;
}

// Settings the panel did not have are reported, not silently dropped.
export function placedMessage(what: string, c: ComponentInfo): string {
  const lines = [`Added ${what} as ${formatComponent(c)}.`];
  if (c.warnings?.length)
    lines.push(
      `Not applied (no such setting): ${c.warnings.join(', ')}. describe_component lists the real labels.`,
    );
  lines.push('Use screenshot_report to check the design.');
  return lines.join('\n');
}

export function formatSettings(settings: SettingInfo[]): string {
  return settings.map((s) => `- ${s.label} (${s.kind}) = ${s.value}`).join('\n') || '(none)';
}

// Zod leaves absent keys as undefined; the domain wants them absent.
export function toLayout(l: {
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
}): Partial<Layout> {
  return Object.fromEntries(
    Object.entries(l).filter(([, v]) => v !== undefined),
  ) as Partial<Layout>;
}
