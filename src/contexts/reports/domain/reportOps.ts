import type { BigQuerySource } from './Report.js';
import { InvalidChartError, validateDateRange } from './Report.js';

// Report-level operations of the Looker Studio editor: copies, link sharing,
// scheduled email delivery, version history and embedding.

// Make a copy: a data source of the original (by name) gets a new connection
// in the copy, or is swapped for a reusable data source of the account (by
// name, picked in the copy dialog itself).
export type DataSourceReplacement =
  { original: string; source: BigQuerySource } | { original: string; reusable: string };

export interface CopiedReport {
  id: string;
  name: string;
  url: string;
  // Data sources reconnected in the copy, as "original → new name".
  replaced: string[];
}

// Share › Link settings: Restricted (people added), Unlisted (anyone with the
// link) or Public (anyone on the internet can find it).
export const LINK_ACCESS = ['restricted', 'unlisted', 'public'] as const;
export type LinkAccess = (typeof LINK_ACCESS)[number];

export interface LinkSharing {
  access: LinkAccess;
  // What people with the link can do; Restricted has none.
  role?: 'viewer' | 'editor';
}

export const REPEATS = ['daily', 'weekly', 'monthly', 'weekdays', 'custom'] as const;
export type Repeat = (typeof REPEATS)[number];

export interface DeliverySchedule {
  // Extra recipients; the signed-in account always gets the email too.
  recipients: string[];
  // YYYY-MM-DD; Looker Studio defaults to today.
  startDate?: string;
  // HH:MM, 24 h, on the hour or half hour, in the report owner's time zone.
  time?: string;
  // weekly and monthly follow the start date (weekly on its weekday,
  // monthly on the same week and weekday of the month).
  repeat?: Repeat;
  // repeat: custom — every `interval` days, weeks or months. Weeks go out on
  // `weekdays` (the start date's weekday when omitted); months on the start
  // date's day of the month or on its weekday ("the last Tuesday").
  every?: {
    interval: number;
    unit: 'day' | 'week' | 'month';
    weekdays?: Weekday[];
    monthlyOn?: 'day' | 'weekday';
  };
  // Page names; all pages when omitted.
  pages?: string[];
  // IANA zone (e.g. "Europe/Madrid"). A schedule keeps the zone it was created
  // in, the browser's: setting one recreates the schedule in that zone.
  timeZone?: string;
  // The Filters tab: values of the report's filter controls for the email.
  filters?: DeliveryFilter[];
}

export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

// One filter control of the Filters tab, found by page and field (or the
// page's date range control). `index` picks among controls on the same field.
export interface DeliveryFilter {
  page?: string;
  field?: string;
  index?: number;
  // Drop-down and list controls: the values to keep (empty: all of them);
  // input boxes: one value (empty: cleared).
  values?: string[];
  // Date range controls: a preset ("Last 28 days") or YYYY-MM-DD..YYYY-MM-DD.
  dateRange?: string;
}

// What the Schedule delivery dialog shows for a scheduled report, by label
// (From, To, Pages, Start Date, Repeat, Time, Timezone).
export type DeliveryInfo = Record<string, string>;

export interface ReportVersion {
  // 1-based position in File › Version history; 1 is the current version.
  index: number;
  // The version's name, or its date and time when it has none.
  label: string;
  current: boolean;
  authors: string[];
}

export interface EmbedOptions {
  page?: number;
  width?: number;
  height?: number;
  showNavigation?: boolean;
}

export interface EmbedInfo {
  code: string;
  url: string;
  // True when this call turned embedding on.
  enabled: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The schedule date box takes "Oct 23, 2026".
export function scheduleDateLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const [year, month, day] = match ? match.slice(1).map(Number) : [];
  const date = match ? new Date(Date.UTC(year!, month! - 1, day)) : null;
  if (!date || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) {
    throw new InvalidChartError(`start_date must be a date as YYYY-MM-DD, not "${iso}".`);
  }
  return `${MONTHS[month! - 1]} ${day}, ${year}`;
}

// The schedule time list has half-hour slots labelled "9:30 AM".
export function scheduleTimeLabel(time: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hour = Number(match?.[1]);
  const minute = match?.[2];
  if (!match || hour > 23 || (minute !== '00' && minute !== '30')) {
    throw new InvalidChartError(
      `time must be HH:MM on the hour or half hour (e.g. 08:00, 17:30), not "${time}".`,
    );
  }
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${suffix}`;
}

// Repeat options are "Daily", "Weekly on Friday", "Monthly on the 4th Friday",
// "Every weekday (Monday to Friday)" and "Custom": matched by their start.
export const REPEAT_OPTION: Record<Repeat, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  weekdays: 'Every weekday',
  custom: 'Custom',
};

export function validateSchedule(schedule: DeliverySchedule): void {
  const bad = schedule.recipients.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad.length) throw new InvalidChartError(`Not email addresses: ${bad.join(', ')}.`);
  if (schedule.startDate !== undefined) scheduleDateLabel(schedule.startDate);
  if (schedule.time !== undefined) scheduleTimeLabel(schedule.time);
  if (schedule.every && schedule.repeat !== 'custom') {
    throw new InvalidChartError('every only applies to repeat: custom.');
  }
  if (schedule.repeat === 'custom') {
    const interval = schedule.every?.interval;
    if (!interval || !Number.isInteger(interval) || interval < 1) {
      throw new InvalidChartError('repeat: custom needs every.interval, a whole number from 1.');
    }
  }
  if (schedule.pages && !schedule.pages.length) {
    throw new InvalidChartError('pages needs at least one page name; omit it for all pages.');
  }
  const every = schedule.every;
  if (every?.weekdays && every.unit !== 'week')
    throw new InvalidChartError('weekdays only applies to every.unit: week.');
  if (every?.weekdays && !every.weekdays.length)
    throw new InvalidChartError('weekdays needs at least one day; omit it for the start date.');
  if (every?.monthlyOn && every.unit !== 'month')
    throw new InvalidChartError('monthly_on only applies to every.unit: month.');
  if (schedule.timeZone !== undefined) timeZoneOffset(schedule.timeZone);
  for (const filter of schedule.filters ?? []) validateDeliveryFilter(filter);
}

function validateDeliveryFilter(filter: DeliveryFilter): void {
  const field = filter.field?.trim();
  if (!field === (filter.dateRange === undefined)) {
    throw new InvalidChartError(
      'Each filter names a control field (with values) or sets date_range (the date range control), not both.',
    );
  }
  if (field && !filter.values) throw new InvalidChartError(`The filter on ${field} needs values.`);
  if (!field && filter.values)
    throw new InvalidChartError('values belong to a field filter, not a date range.');
  if (filter.dateRange !== undefined) validateDateRange(filter.dateRange);
  if (filter.index !== undefined && (!Number.isInteger(filter.index) || filter.index < 1))
    throw new InvalidChartError('A filter index is 1 or more.');
}

// The zone's current offset as Looker Studio's time zone labels write it
// ("GMT+05:30", "GMT-05:00", "GMT+00:00").
export function timeZoneOffset(timeZone: string, at: Date = new Date()): string {
  let name: string | undefined;
  try {
    name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
  } catch {
    throw new InvalidChartError(
      `time_zone must be an IANA time zone such as Europe/Madrid or America/New_York, not "${timeZone}".`,
    );
  }
  return !name || name === 'GMT' ? 'GMT+00:00' : name;
}

// A filter control of the schedule's Filters tab, as read from the dialog.
export interface DeliveryControl {
  page: string;
  // The field it filters ("" for a date range control).
  field: string;
  kind: 'list' | 'input' | 'date' | 'other';
  // What it shows: "feature: a, b (2)", "platform (Equals)", "Sep 28, 2026 - Oct 25, 2026".
  text: string;
  value?: string;
}

// The control a filter sets, and its position among its page's controls.
export function pickDeliveryControl(
  controls: DeliveryControl[],
  filter: DeliveryFilter,
): { page: string; position: number; control: DeliveryControl } {
  const what = filter.dateRange !== undefined ? 'date range control' : `control on ${filter.field}`;
  const listed = () =>
    controls
      .map((c) => `${c.page} › ${c.kind === 'date' ? 'date range' : c.field} (${c.kind})`)
      .join(', ') || 'none';
  const matches = controls
    .map((control, i) => ({ control, i }))
    .filter(({ control }) =>
      filter.dateRange !== undefined
        ? control.kind === 'date'
        : control.field.toLowerCase() === filter.field!.trim().toLowerCase(),
    )
    .filter(({ control }) => !filter.page || control.page === filter.page.trim());
  if (!matches.length) {
    throw new InvalidChartError(
      `No ${what}${filter.page ? ` on the page ${filter.page}` : ''} in the schedule's Filters tab (it has: ${listed()}).`,
    );
  }
  const pages = [...new Set(matches.map((m) => m.control.page))];
  if (pages.length > 1) {
    throw new InvalidChartError(`Several pages have a ${what} (${pages.join(', ')}): pass page.`);
  }
  if (matches.length > 1 && filter.index === undefined) {
    throw new InvalidChartError(
      `The page ${pages[0]} has ${matches.length} ${what}s (${matches.map((m) => m.control.kind).join(', ')}): pass index (1-${matches.length}).`,
    );
  }
  const chosen = matches[(filter.index ?? 1) - 1];
  if (!chosen) {
    throw new InvalidChartError(`index ${filter.index} is past the ${matches.length} ${what}s.`);
  }
  const position = controls.slice(0, chosen.i).filter((c) => c.page === chosen.control.page).length;
  return { page: chosen.control.page, position, control: chosen.control };
}

// A version by its 1-based index or its label (name or date as listed).
export function findVersion(
  versions: ReportVersion[],
  wanted: number | string,
): ReportVersion | undefined {
  if (typeof wanted === 'number') return versions.find((v) => v.index === wanted);
  const label = wanted.trim().toLowerCase();
  return (
    versions.find((v) => v.label.toLowerCase() === label) ??
    versions.find((v) => v.label.toLowerCase().includes(label))
  );
}
